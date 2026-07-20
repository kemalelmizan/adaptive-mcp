import type { Store } from "@adaptivemcp/spec";
import type { CallResult, Middleware, MiddlewareContext, PlannedCall } from "./middleware.js";

export interface MiddlewareChainOptions {
  store: Store;
  toolName: string;
  serverName?: string;
}

/**
 * Holds an ordered list of `Middleware` and runs their hooks around a single
 * tool execution (doubts.md §12c / D2 / D5).
 *
 * Ordering (decided, D5): `beforeCall` runs in registration order; `afterCall`
 * and `onError` run in reverse registration order, so the last-registered
 * middleware observes the final output first. `contributeView` is collected in
 * registration order into a `{ [name]: fragment }` map.
 *
 * The chain is intentionally transport-agnostic: it does not execute the tool
 * itself. The caller (AdaptiveRuntime or ThinClient) owns execution and calls
 * `runBefore` / `runAfter` / `runError` around it.
 */
export class MiddlewareChain {
  private middlewares: Middleware[] = [];
  private store: Store;
  private toolName: string;
  private serverName?: string;

  constructor(options: MiddlewareChainOptions) {
    this.store = options.store;
    this.toolName = options.toolName;
    this.serverName = options.serverName;
  }

  /** Register a middleware. Returns `this` for chaining (D2: explicit `use()`). */
  use(mw: Middleware): this {
    this.middlewares.push(mw);
    return this;
  }

  /** The registered middleware names, in order. */
  names(): string[] {
    return this.middlewares.map((m) => m.name);
  }

  private ctx(): MiddlewareContext {
    return { store: this.store, toolName: this.toolName, serverName: this.serverName };
  }

  /** Run every `init` hook (e.g. when the chain is attached to a runtime). */
  async initAll(): Promise<void> {
    for (const mw of this.middlewares) {
      await mw.init?.(this.ctx());
    }
  }

  /** Run `beforeCall` in registration order. */
  async runBefore(call: PlannedCall): Promise<void> {
    const ctx = this.ctx();
    for (const mw of this.middlewares) {
      await mw.beforeCall?.(call, ctx);
    }
  }

  /** Run `afterCall` in reverse registration order. */
  async runAfter(result: CallResult, call: PlannedCall): Promise<void> {
    const ctx = this.ctx();
    for (let i = this.middlewares.length - 1; i >= 0; i--) {
      await this.middlewares[i]!.afterCall?.(result, call, ctx);
    }
  }

  /** Run `onError` in reverse registration order. */
  async runError(err: unknown, call: PlannedCall): Promise<void> {
    const ctx = this.ctx();
    for (let i = this.middlewares.length - 1; i >= 0; i--) {
      await this.middlewares[i]!.onError?.(err, call, ctx);
    }
  }

  /**
   * Collect every middleware's `contributeView` fragment into a single map
   * keyed by middleware name. Fragments that are `undefined` are omitted.
   */
  contributeView(): Record<string, unknown> {
    const ctx = this.ctx();
    const out: Record<string, unknown> = {};
    for (const mw of this.middlewares) {
      const fragment = mw.contributeView?.(ctx);
      if (fragment !== undefined) {
        out[mw.name] = fragment;
      }
    }
    return out;
  }
}
