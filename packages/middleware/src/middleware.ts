import type { Store } from "@adaptivemcp/spec";

/**
 * A planned tool call, as seen by middleware before/after execution.
 *
 * Middleware may mutate `input`/`output`/`credentials` in place (the chain
 * passes the same object through every stage). `output` is only present after
 * the call has executed (in `afterCall` / `onError`).
 */
export interface PlannedCall {
  toolName: string;
  serverName?: string;
  /** The tool input arguments. Mutable by `beforeCall`. */
  input: unknown;
  /** The tool result. Only present in `afterCall` / `onError`. Mutable by `afterCall`. */
  output?: unknown;
  /** Credentials resolved by an auth-injecting middleware. */
  credentials?: Record<string, string>;
}

export interface CallResult {
  ok: boolean;
  error?: string;
}

/**
 * Shared context handed to every middleware hook. `store` is the persistence
 * boundary (see `@adaptivemcp/spec`); middleware depends only on that, never on
 * a concrete store. `toolName`/`serverName` mirror the active call for
 * convenience in `contributeView`.
 */
export interface MiddlewareContext {
  store: Store;
  toolName: string;
  serverName?: string;
}

/**
 * The pluggable middleware contract (doubts.md §12c).
 *
 * Every hook is optional. The chain invokes them in a fixed order (doubts.md
 * D5): `beforeCall` in registration order, `afterCall` in reverse, `onError`
 * in reverse. `contributeView` is collected into the YAML `middleware` map.
 *
 * Middleware MUST NOT shell out or depend on processes — that is the job of
 * `@adaptivemcp/mcp-binary` (the only sanctioned shell-out layer). Middleware
 * may, however, call an injected MCP client (e.g. a compressor server).
 */
export interface Middleware {
  /** Stable identifier; also the key in the YAML `middleware` map. */
  name: string;

  /** Called once when the middleware is registered with a chain. */
  init?(ctx: MiddlewareContext): void | Promise<void>;

  /** Runs before the tool executes. Gate, transform input, or inject credentials. */
  beforeCall?(call: PlannedCall, ctx: MiddlewareContext): void | Promise<void>;

  /** Runs after a successful (or non-throwing) execution. Transform output / observe. */
  afterCall?(result: CallResult, call: PlannedCall, ctx: MiddlewareContext): void | Promise<void>;

  /** Runs after a thrown execution error. Observe / record. */
  onError?(err: unknown, call: PlannedCall, ctx: MiddlewareContext): void | Promise<void>;

  /**
   * Contribute a serializable fragment to the derived YAML `middleware` map,
   * keyed by `name`. Returning `undefined` contributes nothing.
   */
  contributeView?(ctx: MiddlewareContext): unknown | void;
}
