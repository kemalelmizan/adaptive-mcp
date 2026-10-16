/**
 * @adaptivemcp/opencode-plugin — a real OpenCode plugin that feeds the
 * Adaptive MCP adaptation loop. Supports both host generations:
 *
 * **V2 (OpenCode ≥ 2.0)** — the default export is a dual-shape definition
 * `{ id, setup, server }`: the loader validates `id` + `setup` and ignores
 * `server()`. `setup(ctx)` registers the host's tool hooks and returns a
 * cleanup function:
 * - `ctx.tool.hook("execute.before")` → `MiddlewareChain.runBefore`
 * - `ctx.tool.hook("execute.after")`  → `TelemetryRecorder.complete`/`fail`
 *   + `MiddlewareChain.runAfter` (V2 reports per-call failures as
 *   `status: "error"`, which V1 had no hook for)
 * - returned cleanup → registrations disposed + final flush + store close
 *
 * **V1 (OpenCode 1.x)** — `server()` returns the classic hooks object:
 * - `tool.execute.before` → `MiddlewareChain.runBefore`
 * - `tool.execute.after`  → `TelemetryRecorder.complete` + `MiddlewareChain.runAfter`
 * - `event` (session.*)   → session id tracking for telemetry
 * - `dispose`             → final evaluation/sync flush + store close
 *
 * This is a thin adapter at the edge: no core package depends on it, and it
 * mirrors OpenCode's hook types structurally instead of depending on
 * `@opencode-ai/plugin` (see `types.ts`).
 *
 * Scope notes:
 * - The store is constructed lazily inside `setup()`/`server()`, never at
 *   module scope: host options (`ctx.options` / `server(input, options)`) only
 *   exist at call time, and constructing at import time made plugin load fail
 *   wholesale when a previous host run had been terminated while the store was
 *   open (stale `*.db-shm`/`*.db-wal` sidecars → `ERR_SQLITE_ERROR: disk I/O
 *   error`). Recovery: delete the stale sidecars (and the db file if it is
 *   unrecoverable) — SQLite cannot reconcile sidecars whose owner db is gone.
 * - V1 has no per-tool error hook; failures must be recorded through
 *   `recordToolFailure()` by a host/event integration. V2 supplies
 *   `execute.after` with `status: "error"` and records them natively.
 *   A non-zero `shell` exit also arrives as `status: "completed"`, so the exit
 *   code is classified separately (see `treatNonZeroExitAsFailure`).
 * - There is no parent/child tool linkage, so execution-graph tracking is not
 *   wired here; `TelemetryRecorder.complete`/`fail` stats still flow normally.
 * - OpenCode does not put the server in the hook payload, but names MCP tools
 *   `<server>_<tool>`; the adapter reads `ctx.mcp.list()` (V2) so a call whose
 *   prefix is a connected server is attributed to it (`serverName`).
 * - V2 delivers `sessionID` on every tool event, so this adapter tracks the
 *   session from tool events; it does not subscribe to `ctx.event`.
 */

import { MemoryStore } from "@adaptivemcp/memory";
import { TelemetryRecorder, MemoryBackedTelemetryStore } from "@adaptivemcp/telemetry";
import { Evaluator } from "@adaptivemcp/evaluation";
import { ExtensionController } from "@adaptivemcp/extension";
import { Router } from "@adaptivemcp/routing";
import { Orchestrator } from "@adaptivemcp/orchestration";
import { ApprovalGate } from "@adaptivemcp/approval";
import { MiddlewareChain } from "@adaptivemcp/middleware";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type {
  AdaptivePluginOptions,
  OpenCodeEvent,
  OpenCodeHooks,
  OpenCodePlugin,
  OpenCodePluginDefinition,
  OpenCodePluginInput,
  OpenCodeToolExecuteAfterInput,
  OpenCodeToolExecuteAfterOutput,
  OpenCodeToolExecuteBeforeInput,
  OpenCodeToolExecuteBeforeOutput,
  OpenCodeV2Cleanup,
  OpenCodeV2Registration,
  OpenCodeV2SetupContext,
  OpenCodeV2ToolExecuteAfterEvent,
  OpenCodeV2ToolExecuteBeforeEvent,
  OpenCodeV2ToolResult,
} from "./types.js";

interface PendingCall {
  startedAt: number;
  sessionId?: string;
}

/**
 * The default store directory: `adaptivemcp/` under the XDG data home
 * (`$XDG_DATA_HOME` or `~/.local/share`). Used when no `dbPath` is configured,
 * so the plugin persists learned metadata out of the box.
 */
function defaultDataDir(): string {
  const base = process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share");
  return join(base, "adaptivemcp");
}

/**
 * Wires the Adaptive MCP components into an OpenCode plugin. Use `hooks()` for
 * V1 hosts or `setup(ctx)` for V2 hosts; obtain an instance via
 * `createAdaptivePlugin()` (V1 function shape) or `createOpenCodePlugin()`
 * (dual shape, lazy construction).
 */
export class AdaptiveMcpPlugin {
  readonly memory: MemoryStore;
  readonly telemetry: TelemetryRecorder;
  readonly evaluator: Evaluator;
  readonly extension: ExtensionController;
  readonly router: Router;
  readonly orchestrator: Orchestrator;
  readonly approval: ApprovalGate;
  readonly middleware: MiddlewareChain;

  private readonly persistDebounceMs: number;
  private readonly exitPolicy: "off" | "non-zero" | "gte2";
  private readonly pending = new Map<string, PendingCall>();
  private sessionId?: string;
  private timer?: ReturnType<typeof setTimeout>;
  private disposed = false;
  /** V2 setup context, retained to read the host's MCP server list. */
  private hostCtx?: OpenCodeV2SetupContext;
  /** Cached MCP server names (empty results are not cached, so a later connect is picked up). */
  private mcpServerNames?: string[];
  /** V2 hooks already registered on a host context (guards double setup). */
  private registeredV2 = false;
  /** Live V2 hook registrations (empty until `setup(ctx)` runs). */
  private v2Registrations: OpenCodeV2Registration[] = [];

  constructor(options: AdaptivePluginOptions = {}) {
    this.persistDebounceMs = options.persistDebounceMs ?? 250;
    this.exitPolicy = options.treatNonZeroExitAsFailure ?? "non-zero";
    const dbPath = options.dbPath ?? join(defaultDataDir(), "adaptive.db");
    const yamlPath =
      options.yamlPath ??
      (dbPath === ":memory:" ? undefined : join(dirname(dbPath), "tools-metadata.yaml"));
    if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
    this.memory = new MemoryStore({ path: dbPath });
    this.telemetry = new TelemetryRecorder({
      store: new MemoryBackedTelemetryStore(this.memory),
    });
    this.evaluator = new Evaluator({ memory: this.memory });
    this.extension = new ExtensionController({ memory: this.memory, yamlPath });
    this.router = new Router({ memory: this.memory });
    this.orchestrator = new Orchestrator({ memory: this.memory });
    this.approval = new ApprovalGate({ memory: this.memory, policy: options.approvalPolicy });
    this.middleware = new MiddlewareChain({ store: this.memory, toolName: "" });
    for (const mw of options.middleware ?? []) {
      this.middleware.use(mw);
    }
  }

  /** The OpenCode V1 plugin hooks. */
  hooks(): OpenCodeHooks {
    return {
      "tool.execute.before": (input, output) => this.onToolBefore(input, output),
      "tool.execute.after": (input, output) => this.onToolAfter(input, output),
      event: (input) => this.onEvent(input.event),
      dispose: () => this.dispose(),
    };
  }

  /**
   * OpenCode **V2** entry point: register the host's tool hooks on the setup
   * context and return the cleanup function the host runs on unload.
   *
   * V2 payloads map onto the same internals the V1 hooks use:
   * - `execute.before` `{tool, sessionID, id, input}` → `callID = id`,
   *   `args = input`
   * - `execute.after` completed → `result` folded into the V1
   *   `{title, output, metadata}` output shape
   * - `execute.after` `status: "error"` → a real failure record (V1 had no
   *   per-tool error hook), clearing the pending call for its duration.
   *
   * Guarded against double registration: the host may invoke `setup()` more
   * than once per process (observed live on v2.0.26); re-running it must not
   * double-count every tool call.
   */
  async setup(ctx: OpenCodeV2SetupContext): Promise<OpenCodeV2Cleanup> {
    if (this.disposed) return () => {};
    if (this.registeredV2) return () => this.dispose();
    if (!ctx || typeof ctx.tool?.hook !== "function") {
      throw new TypeError("@adaptivemcp/opencode-plugin: setup context has no tool.hook() API");
    }
    this.hostCtx = ctx;
    const registrations: OpenCodeV2Registration[] = [];
    registrations.push(await ctx.tool.hook("execute.before", (event) => this.onV2Before(event)));
    registrations.push(await ctx.tool.hook("execute.after", (event) => this.onV2After(event)));
    this.registeredV2 = true;
    return async () => {
      for (const registration of registrations) {
        await registration.dispose();
      }
      this.registeredV2 = false;
      await this.dispose();
    };
  }

  private async onV2Before(event: OpenCodeV2ToolExecuteBeforeEvent): Promise<void> {
    if (this.disposed) return;
    // V2 carries sessionID on every tool event — track it so currentSessionId()
    // reflects the active session without a ctx.event subscription.
    if (typeof event.sessionID === "string" && event.sessionID) {
      this.sessionId = event.sessionID;
    }
    await this.onToolBefore(
      { tool: event.tool, sessionID: event.sessionID, callID: event.id },
      { args: event.input },
    );
  }

  private async onV2After(event: OpenCodeV2ToolExecuteAfterEvent): Promise<void> {
    if (this.disposed) return;
    if (event.status === "error") {
      const call = this.pending.get(event.id);
      this.pending.delete(event.id);
      const sessionId = event.sessionID || call?.sessionId || this.sessionId;
      const message =
        typeof event.error?.message === "string" && event.error.message
          ? event.error.message
          : `tool ${event.tool} failed`;
      const { toolName, serverName } = await this.resolveTool(event.tool);
      this.telemetry.fail(
        { toolName, serverName, sessionId },
        { message },
        { durationMs: call ? Date.now() - call.startedAt : undefined },
      );
      // Mirror the thin client: classified failures reach middleware through
      // runAfter({ ok: false, error }) — runError() is for thrown chain errors.
      await this.middleware.runAfter(
        { ok: false, error: message },
        { toolName: event.tool, input: event.input },
      );
      this.schedulePersist();
      return;
    }
    await this.onToolAfter(
      { tool: event.tool, sessionID: event.sessionID, callID: event.id, args: event.input },
      mapV2Result(event.result, event.tool),
    );
  }

  /**
   * The host's MCP server names, read lazily from `ctx.mcp.list()` (populated
   * only once servers connect). Never cached while empty, so a server that
   * connects after the first tool call is still picked up.
   */
  private async serverNames(): Promise<string[]> {
    if (this.mcpServerNames?.length) return this.mcpServerNames;
    try {
      const result = await this.hostCtx?.mcp?.list?.();
      const names = (result?.data ?? [])
        .map((server) => server?.name)
        .filter((name): name is string => typeof name === "string" && name.length > 0);
      if (names.length > 0) this.mcpServerNames = names;
      return names;
    } catch {
      return [];
    }
  }

  /**
   * Split a host tool name into `{ serverName, toolName }`. OpenCode namespaces
   * MCP tools as `<server>_<tool>` (`McpCatalog.toolName`), so a name whose
   * prefix is a *connected server* is attributed to it; built-ins (`shell`,
   * `read`, `edit`, …, `apply_patch`) keep an empty server. The tool name
   * becomes the server's own tool name: `headroom_headroom_compress` → server
   * `headroom`, tool `headroom_compress`.
   */
  private async resolveTool(toolName: string): Promise<{ toolName: string; serverName?: string }> {
    for (const server of await this.serverNames()) {
      if (toolName.startsWith(`${server}_`)) {
        return { toolName: toolName.slice(server.length + 1), serverName: server };
      }
    }
    return { toolName };
  }

  /**
   * Classify a completed call from its result metadata. OpenCode reports a
   * non-zero `shell` exit as `status: "completed"`, so the exit code is the
   * only failure signal; the configured policy decides whether it counts.
   */
  private exitFailure(metadata: unknown): { message: string; code: string } | undefined {
    if (this.exitPolicy === "off") return undefined;
    const exit =
      metadata && typeof metadata === "object"
        ? (metadata as Record<string, unknown>).exit
        : undefined;
    if (typeof exit !== "number" || exit === 0) return undefined;
    if (this.exitPolicy === "gte2" && exit < 2) return undefined;
    return { message: `tool exited with code ${exit}`, code: String(exit) };
  }

  private async onToolBefore(
    input: OpenCodeToolExecuteBeforeInput,
    output: OpenCodeToolExecuteBeforeOutput,
  ): Promise<void> {
    if (this.disposed) return;
    this.pending.set(input.callID, {
      startedAt: Date.now(),
      sessionId: input.sessionID || this.sessionId,
    });
    await this.middleware.runBefore({ toolName: input.tool, input: output.args });
  }

  private async onToolAfter(
    input: OpenCodeToolExecuteAfterInput,
    output: OpenCodeToolExecuteAfterOutput,
  ): Promise<void> {
    if (this.disposed) return;
    const call = this.pending.get(input.callID);
    this.pending.delete(input.callID);
    const sessionId = input.sessionID || call?.sessionId || this.sessionId;
    const { toolName, serverName } = await this.resolveTool(input.tool);
    const durationMs = call ? Date.now() - call.startedAt : undefined;
    const outputRecord = { title: output.title, output: output.output, metadata: output.metadata };
    const failure = this.exitFailure(output.metadata);
    if (failure) {
      // The host reported "completed", but the call exited non-zero — a real
      // failure the learned failure rate must see (see `treatNonZeroExitAsFailure`).
      this.telemetry.fail({ toolName, serverName, sessionId }, failure, {
        durationMs,
        output: outputRecord,
      });
      await this.middleware.runAfter(
        { ok: false, error: failure.message },
        { toolName: input.tool, input: input.args, output: output.output },
      );
      this.schedulePersist();
      return;
    }
    this.telemetry.complete(
      { toolName, serverName, sessionId },
      { durationMs, output: outputRecord },
    );
    await this.middleware.runAfter(
      { ok: true },
      { toolName: input.tool, input: input.args, output: output.output },
    );
    this.schedulePersist();
  }

  private async onEvent(event: OpenCodeEvent): Promise<void> {
    if (this.disposed) return;
    const sessionId = event?.properties?.sessionID;
    if (typeof sessionId !== "string") return;
    if (event.type === "session.created" || event.type === "session.updated") {
      this.sessionId = sessionId;
      return;
    }
    if (event.type === "session.deleted" && sessionId === this.sessionId) {
      this.sessionId = undefined;
    }
  }

  private schedulePersist(): void {
    if (this.disposed) return;
    if (this.persistDebounceMs <= 0) {
      this.persist();
      return;
    }
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.persist();
    }, this.persistDebounceMs);
    this.timer.unref?.();
  }

  private cancelPersist(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  /**
   * Evaluate the accumulated telemetry and recompute the derived view once.
   * Mirrors `AdaptiveRuntime.observeCompleted`: routing/orchestration are
   * heavier cross-tool passes and are deliberately kept out — call
   * `runAdaptation()` for those.
   */
  persist(): void {
    this.cancelPersist();
    this.evaluator.evaluateAll();
    this.extension.setMiddlewareView(this.middleware.contributeView());
    this.extension.sync();
  }

  /** Run the heavier cross-tool adaptation passes (routing + orchestration), then persist. */
  runAdaptation(): void {
    this.router.routeAll();
    this.orchestrator.planAll();
    this.persist();
  }

  /**
   * Record a tool failure. OpenCode V1 exposes no per-tool error hook, so a host
   * (or an `event` integration that can see the failure) calls this.
   */
  recordToolFailure(
    toolName: string,
    error: { message: string; code?: string },
    opts: { sessionId?: string; durationMs?: number } = {},
  ): void {
    this.telemetry.fail({ toolName, sessionId: opts.sessionId ?? this.sessionId }, error, {
      durationMs: opts.durationMs,
    });
    this.schedulePersist();
  }

  /** The session id currently associated with tool calls (from `session.*` events). */
  currentSessionId(): string | undefined {
    return this.sessionId;
  }

  /** The current `tools-metadata` view (YAML by default). */
  getToolsMetadata(mimeType?: string): string {
    return this.extension.resourceText(mimeType);
  }

  /** Final flush, then close the store. Safe to call more than once. */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.persist();
    this.disposed = true;
    this.cancelPersist();
    this.memory.close();
  }
}

/**
 * Create an OpenCode V1 plugin backed by Adaptive MCP. The returned function is
 * what the host calls; the underlying instance is attached as `.plugin` for
 * introspection/tests.
 */
export function createAdaptivePlugin(
  options: AdaptivePluginOptions = {},
): OpenCodePlugin & { plugin: AdaptiveMcpPlugin } {
  const plugin = new AdaptiveMcpPlugin(options);
  const factory: OpenCodePlugin = async () => plugin.hooks();
  return Object.assign(factory, { plugin });
}

/**
 * Fold a V2 `execute.after` `result` into the V1 `{title, output, metadata}`
 * output shape the telemetry path already stores: text content blocks joined
 * as the output (falling back to `result.output.output`, e.g. shell stdout),
 * `result.metadata` as metadata, and the tool name as the title when the host
 * sends none.
 */
function mapV2Result(
  result: OpenCodeV2ToolResult | undefined,
  tool: string,
): OpenCodeToolExecuteAfterOutput {
  const title = typeof result?.title === "string" && result.title ? result.title : tool;
  const blocks = Array.isArray(result?.content)
    ? result.content
        .map((block) => (typeof block?.text === "string" ? block.text : ""))
        .filter((text) => text.length > 0)
    : [];
  const output =
    blocks.length > 0
      ? blocks.join("")
      : typeof result?.output?.output === "string"
        ? result.output.output
        : "";
  return { title, output, metadata: result?.metadata ?? {} };
}

/**
 * Pick the data-only host options (`plugins: [{ package, options }]` in V2
 * config, `server(input, options)` in V1) and drop anything that cannot cross
 * a JSON boundary (`middleware` is code — pass it via `createOpenCodePlugin`).
 * Unknown keys are ignored; wrong-typed known keys are ignored too.
 */
function readHostOptions(raw?: Record<string, unknown>): AdaptivePluginOptions {
  if (!raw || typeof raw !== "object") return {};
  const options: AdaptivePluginOptions = {};
  if (typeof raw.dbPath === "string") options.dbPath = raw.dbPath;
  if (typeof raw.yamlPath === "string") options.yamlPath = raw.yamlPath;
  if (typeof raw.persistDebounceMs === "number") options.persistDebounceMs = raw.persistDebounceMs;
  if (
    raw.treatNonZeroExitAsFailure === "off" ||
    raw.treatNonZeroExitAsFailure === "non-zero" ||
    raw.treatNonZeroExitAsFailure === "gte2"
  ) {
    options.treatNonZeroExitAsFailure = raw.treatNonZeroExitAsFailure;
  }
  if (raw.approvalPolicy && typeof raw.approvalPolicy === "object") {
    options.approvalPolicy = raw.approvalPolicy as AdaptivePluginOptions["approvalPolicy"];
  }
  return options;
}

/**
 * Create the **dual-shape** plugin definition loadable by both host
 * generations (V2 validates `id` + `setup()` and ignores `server()`; V1 calls
 * `server()` and ignores `setup()`):
 *
 * ```jsonc
 * // opencode.json (V2) — or `"plugin": ["./path/to/package"]` on V1
 * { "plugins": [{ "package": "@adaptivemcp/opencode-plugin",
 *                 "options": { "dbPath": "./adaptive.db" } }] }
 * ```
 *
 * The `AdaptiveMcpPlugin` instance (and with it the store) is constructed
 * lazily on the first `setup()`/`server()` call — never at module scope, so
 * importing this module has no side effects and host options are available
 * before the store opens. The instance is exposed as `.plugin` for
 * introspection/tests (it is `undefined` until the host calls in).
 */
export function createOpenCodePlugin(
  options: AdaptivePluginOptions = {},
): OpenCodePluginDefinition & { readonly plugin: AdaptiveMcpPlugin | undefined } {
  let instance: AdaptiveMcpPlugin | undefined;
  const construct = (hostOptions?: Record<string, unknown>): AdaptiveMcpPlugin => {
    instance ??= new AdaptiveMcpPlugin({ ...options, ...readHostOptions(hostOptions) });
    return instance;
  };
  return {
    id: "adaptivemcp",
    async setup(ctx: OpenCodeV2SetupContext) {
      const plugin = construct(ctx?.options);
      const cleanup = await plugin.setup(ctx);
      // Release the instance on unload so a later setup() re-constructs fresh
      // instead of handing back a disposed one.
      return async () => {
        await cleanup();
        if (instance === plugin) instance = undefined;
      };
    },
    async server(_input: OpenCodePluginInput, hostOptions?: Record<string, unknown>) {
      const plugin = construct(hostOptions);
      const hooks = plugin.hooks();
      const dispose = hooks.dispose;
      hooks.dispose = async () => {
        await dispose?.();
        if (instance === plugin) instance = undefined;
      };
      return hooks;
    },
    get plugin() {
      return instance;
    },
  };
}

/**
 * The package's default export — a ready-to-load dual-shape plugin with the
 * default options (`:memory:` store, no yaml file until configured). Point
 * OpenCode at this package directory (or npm name) directly; pass `dbPath` /
 * `yamlPath` / `persistDebounceMs` / `approvalPolicy` through the host's
 * plugin `options`, or use `createOpenCodePlugin({ middleware: [...] })` when
 * you need code-level options.
 */
const plugin: OpenCodePluginDefinition & { readonly plugin: AdaptiveMcpPlugin | undefined } =
  createOpenCodePlugin();

export default plugin;

export * from "./types.js";
