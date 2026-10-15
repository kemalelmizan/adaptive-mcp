import type { ApprovalPolicy } from "@adaptivemcp/approval";
import type { Middleware } from "@adaptivemcp/middleware";

/**
 * Structural mirror of the subset of OpenCode's **V1** plugin `Hooks` interface
 * that this adapter uses.
 *
 * Verified against the reference source (`opencode` `packages/plugin/src/index.ts`,
 * interface `Hooks`): the real hooks are `tool.execute.before`, `tool.execute.after`,
 * `event`, and `dispose`. V1 has **no** `tool.execute.error` hook and **no**
 * `session.*` hooks — session lifecycle arrives through `event` (e.g.
 * `session.created`, `session.deleted`). The types are mirrored rather than
 * imported from `@opencode-ai/plugin` so the adapter stays a thin, version-tolerant
 * edge; the returned hooks object is structurally assignable to OpenCode's `Hooks`.
 */
export interface OpenCodeToolExecuteBeforeInput {
  tool: string;
  sessionID: string;
  callID: string;
}

export interface OpenCodeToolExecuteBeforeOutput {
  args: unknown;
}

export interface OpenCodeToolExecuteAfterInput extends OpenCodeToolExecuteBeforeInput {
  args: unknown;
}

export interface OpenCodeToolExecuteAfterOutput {
  title: string;
  output: string;
  metadata: unknown;
}

/** A host event-bus envelope, e.g. `{ type: "session.created", properties: { sessionID } }`. */
export interface OpenCodeEvent {
  type: string;
  properties?: Record<string, unknown>;
}

export type OpenCodePluginInput = {
  directory?: string;
  worktree?: string;
  [key: string]: unknown;
};

export interface OpenCodeHooks {
  dispose?: () => Promise<void>;
  event?: (input: { event: OpenCodeEvent }) => Promise<void>;
  "tool.execute.before"?: (
    input: OpenCodeToolExecuteBeforeInput,
    output: OpenCodeToolExecuteBeforeOutput,
  ) => Promise<void>;
  "tool.execute.after"?: (
    input: OpenCodeToolExecuteAfterInput,
    output: OpenCodeToolExecuteAfterOutput,
  ) => Promise<void>;
}

export type OpenCodePlugin = (
  input: OpenCodePluginInput,
  options?: Record<string, unknown>,
) => Promise<OpenCodeHooks>;

/* ------------------------------------------------------------------ *
 * OpenCode V2 (structural mirrors)
 *
 * Verified live against OpenCode v2.0.26: the V2 loader schema-validates
 * `export default` as an object with `id` plus an `effect` **or** `setup`
 * function and reads no hooks object from it — hooks are registered inside
 * `setup(ctx)` via `ctx.tool.hook(name, callback)`. V2 therefore ignores the
 * V1 `server()` return value; a dual-shape definition (`{ id, setup, server }`)
 * satisfies both host generations. Like the V1 mirror above, these are
 * structural rather than imported from `@opencode/plugin` so the adapter stays
 * a thin, version-tolerant edge.
 * ------------------------------------------------------------------ */

/** Handle returned by `ctx.*.hook(...)`; dispose it to unregister. */
export interface OpenCodeV2Registration {
  dispose(): Promise<void> | void;
}

/** `ctx.tool.hook("execute.before", cb)` payload (captured live). */
export interface OpenCodeV2ToolExecuteBeforeEvent {
  tool: string;
  sessionID: string;
  /** Agent name that issued the call (present in the live payload). */
  agent?: string;
  /** Message id of the assistant turn that issued the call. */
  messageID?: string;
  /** Call id — the V2 equivalent of V1's `callID`. */
  id: string;
  input: unknown;
}

/** Success shape of `event.result` (captured live from a `shell` call). */
export interface OpenCodeV2ToolResult {
  output?: { exit?: number; truncated?: boolean; output?: string; status?: string };
  content?: Array<{ type?: string; text?: string }>;
  metadata?: Record<string, unknown>;
  title?: string;
  [key: string]: unknown;
}

/** `ctx.tool.hook("execute.after", cb)` payload: `ToolExecuteCompleted | ToolExecuteFailed`. */
export interface OpenCodeV2ToolExecuteAfterEvent extends OpenCodeV2ToolExecuteBeforeEvent {
  /** Host verdict for the call; only `"error"` is a failure (a non-zero exit code from `shell` still arrives as `"completed"`). */
  status: "completed" | "error" | string;
  result?: OpenCodeV2ToolResult;
  /** Present when `status === "error"` (docs: `event.error.message`). */
  error?: { message?: string; [key: string]: unknown };
}

/** The subset of `ctx.tool` this adapter uses. */
export interface OpenCodeV2ToolHookContext {
  hook(
    name: "execute.before",
    callback: (event: OpenCodeV2ToolExecuteBeforeEvent) => void | Promise<void>,
  ): Promise<OpenCodeV2Registration>;
  hook(
    name: "execute.after",
    callback: (event: OpenCodeV2ToolExecuteAfterEvent) => void | Promise<void>,
  ): Promise<OpenCodeV2Registration>;
}

/** A V2 event-bus envelope as delivered by `ctx.event.subscribe()`. */
export interface OpenCodeV2Event {
  type: string;
  properties?: Record<string, unknown>;
  sessionID?: string;
  [key: string]: unknown;
}

/** The subset of V2's `setup(ctx)` context this adapter uses. */
export interface OpenCodeV2SetupContext {
  /** Plugin `options` from config (`plugins: [{ package, options }]`). */
  options?: Record<string, unknown>;
  tool: OpenCodeV2ToolHookContext;
  event?: {
    subscribe(options?: { signal?: AbortSignal }): AsyncIterable<OpenCodeV2Event>;
  };
  [key: string]: unknown;
}

/** Cleanup function `setup()` may return; runs when the host unloads the plugin. */
export type OpenCodeV2Cleanup = () => void | Promise<void>;

/**
 * The dual-shape plugin definition. V2 reads `id` + `setup()` (and ignores
 * `server()`); V1 ≥ 1.18.29 reads `id` + `server()` (and ignores `setup()`).
 * Older V1 expects a function default export — use `createAdaptivePlugin()`
 * for that generation.
 */
export interface OpenCodePluginDefinition {
  id: string;
  /** Returns the cleanup function the host runs on unload (always provided by this adapter). */
  setup: (ctx: OpenCodeV2SetupContext) => Promise<OpenCodeV2Cleanup>;
  server: (input: OpenCodePluginInput, options?: Record<string, unknown>) => Promise<OpenCodeHooks>;
}

export interface AdaptivePluginOptions {
  /** SQLite path for the store. Defaults to in-memory (`:memory:`). */
  dbPath?: string;
  /** Where to write the derived `tools-metadata.yaml` view. */
  yamlPath?: string;
  /** Approval policy used by the gate (advisory; the host owns enforcement). */
  approvalPolicy?: ApprovalPolicy;
  /** Extra middleware, applied around every tool call. */
  middleware?: Middleware[];
  /**
   * Debounce window (ms) for re-evaluation + view sync after a completed call.
   * Defaults to 250. Set `0` to run synchronously on every call.
   */
  persistDebounceMs?: number;
}
