/**
 * @adaptivemcp/opencode-plugin — a real OpenCode V1 plugin that feeds the
 * Adaptive MCP adaptation loop.
 *
 * It maps the host's hooks onto the Adaptive MCP libraries:
 * - `tool.execute.before` → `MiddlewareChain.runBefore`
 * - `tool.execute.after`  → `TelemetryRecorder.complete` + `MiddlewareChain.runAfter`
 * - `event` (session.*)   → session id tracking for telemetry
 * - `dispose`             → final evaluation/sync flush + store close
 *
 * This is a thin adapter at the edge: no core package depends on it, and it
 * mirrors OpenCode's hook types structurally instead of depending on
 * `@opencode-ai/plugin` (see `types.ts`).
 *
 * Scope notes (things V1 hooks cannot do):
 * - There is no per-tool error hook; failures are recorded through
 *   `recordToolFailure()` by a host/event integration.
 * - There is no parent/child tool linkage, so execution-graph tracking is not
 *   wired here; `TelemetryRecorder.complete`/`fail` stats still flow normally.
 * - OpenCode does not report MCP server names, so events carry no `serverName`.
 */

import { MemoryStore } from "@adaptivemcp/memory";
import { TelemetryRecorder, MemoryBackedTelemetryStore } from "@adaptivemcp/telemetry";
import { Evaluator } from "@adaptivemcp/evaluation";
import { ExtensionController } from "@adaptivemcp/extension";
import { Router } from "@adaptivemcp/routing";
import { Orchestrator } from "@adaptivemcp/orchestration";
import { ApprovalGate } from "@adaptivemcp/approval";
import { MiddlewareChain } from "@adaptivemcp/middleware";
import type {
  AdaptivePluginOptions,
  OpenCodeEvent,
  OpenCodeHooks,
  OpenCodePlugin,
  OpenCodeToolExecuteAfterInput,
  OpenCodeToolExecuteAfterOutput,
  OpenCodeToolExecuteBeforeInput,
  OpenCodeToolExecuteBeforeOutput,
} from "./types.js";

interface PendingCall {
  startedAt: number;
  sessionId?: string;
}

/**
 * Wires the Adaptive MCP components into an OpenCode plugin. Construct it
 * directly (and call `hooks()`), or via `createAdaptivePlugin()` for the
 * function shape the host actually loads.
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
  private readonly pending = new Map<string, PendingCall>();
  private sessionId?: string;
  private timer?: ReturnType<typeof setTimeout>;
  private disposed = false;

  constructor(options: AdaptivePluginOptions = {}) {
    this.persistDebounceMs = options.persistDebounceMs ?? 250;
    this.memory = new MemoryStore({ path: options.dbPath ?? ":memory:" });
    this.telemetry = new TelemetryRecorder({
      store: new MemoryBackedTelemetryStore(this.memory),
    });
    this.evaluator = new Evaluator({ memory: this.memory });
    this.extension = new ExtensionController({ memory: this.memory, yamlPath: options.yamlPath });
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
    this.telemetry.complete(
      { toolName: input.tool, sessionId },
      {
        durationMs: call ? Date.now() - call.startedAt : undefined,
        output: { title: output.title, output: output.output, metadata: output.metadata },
      },
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
    this.telemetry.fail(
      { toolName, sessionId: opts.sessionId ?? this.sessionId },
      error,
      { durationMs: opts.durationMs },
    );
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

export * from "./types.js";
