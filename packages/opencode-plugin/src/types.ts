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
