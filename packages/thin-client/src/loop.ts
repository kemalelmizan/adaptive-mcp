import type { Store } from "@adaptivemcp/spec";
import type { ApprovalGate, ApprovalDecision } from "@adaptivemcp/approval";
import type { RetryPolicy } from "@adaptivemcp/orchestration";
import { MiddlewareChain, type Middleware, type PlannedCall, type CallResult } from "@adaptivemcp/middleware";
import { GraphTrackingMiddleware } from "./graph-middleware.js";

export interface ToolHandler {
  (input: unknown): Promise<{ ok: boolean; error?: string; output?: unknown }>;
}

export interface ThinClientOptions {
  memory: Store;
  /** The approval gate used before each tool call. */
  gate: ApprovalGate;
  /**
   * Called when the gate returns `require_confirmation`. Return true to proceed.
   * In a real client this would prompt a human; here it is injectable.
   */
  requestApproval?: (toolName: string) => boolean | Promise<boolean>;
  /** Default retry policy if none is suggested for a tool. */
  defaultRetry?: RetryPolicy;
  /** Middleware registered up-front (D2: explicit `use()`). */
  middleware?: Middleware[];
  /** Optional graph tracking middleware for execution graph intelligence. */
  graphTracking?: GraphTrackingMiddleware;
}

/**
 * A minimal client-side execution loop.
 *
 * The thin client is intentionally small: it owns the *execution lifecycle* and
 * the *middleware hooks* (approval gate + retry), but delegates all learning to
 * the other packages. For each planned tool call it:
 *
 *   1. asks the `ApprovalGate` whether the call may proceed (enforcement hook);
 *   2. if allowed/confirmed, executes with a retry policy derived from the
 *      store `workflow` recommendation (or the default);
 *   3. records the outcome into the store via the caller-supplied recorder.
 *
 * It does NOT implement MCP transport — that remains the official SDK's job. It
 * is the "operational machinery" that runs on the client side.
 */
export class ThinClient {
  private memory: Store;
  private gate: ApprovalGate;
  private requestApproval: (toolName: string) => boolean | Promise<boolean>;
  private defaultRetry: RetryPolicy;
  private chain: MiddlewareChain;
  private graphTracking?: GraphTrackingMiddleware;

  constructor(options: ThinClientOptions) {
    this.memory = options.memory;
    this.gate = options.gate;
    this.requestApproval = options.requestApproval ?? (() => true);
    this.defaultRetry = options.defaultRetry ?? {
      maxAttempts: 1,
      baseDelayMs: 0,
      enabled: false,
    };
    this.chain = new MiddlewareChain({ store: this.memory, toolName: "" });
    for (const mw of options.middleware ?? []) {
      this.chain.use(mw);
    }
    this.graphTracking = options.graphTracking;
  }

  /**
   * Register middleware (D2: explicit `use()` API). Returns `this` for chaining.
   */
  use(mw: Middleware): this {
    this.chain.use(mw);
    return this;
  }

  /**
   * Plan + execute a single tool call through the approval gate, middleware
   * chain, and retry loop. Returns the decision, whether the tool ran, and the
   * (possibly middleware-transformed) output.
   */
  async run(
    toolName: string,
    handler: ToolHandler,
    input: unknown,
    record: (ok: boolean, error?: string, output?: unknown) => void,
    serverName?: string,
  ): Promise<{ decision: ApprovalDecision; executed: boolean; output?: unknown }> {
    const decision = this.gate.gate(toolName, serverName);
    if (decision === "deny") {
      return { decision, executed: false };
    }
    if (decision === "require_confirmation") {
      const approved = await this.requestApproval(toolName);
      if (!approved) {
        record(false, "approval denied by user");
        return { decision, executed: false };
      }
    }

    const call: PlannedCall = { toolName, serverName, input };

    // The full beforeCall -> execute -> afterCall/onError sequence runs inside
    // one graph-tracking context fork, so concurrent calls (e.g. via
    // `Promise.all`) each get an isolated parent/child stack instead of
    // corrupting a shared one. See GraphTrackingMiddleware.runInContext.
    const runOnce = async (): Promise<{ decision: ApprovalDecision; executed: boolean; output?: unknown }> => {
      await this.chain.runBefore(call);

      if (this.graphTracking) {
        await this.graphTracking.beforeCall(call, { store: this.memory, toolName, serverName });
      }

      const policy = this.retryPolicyFor(toolName, serverName);
      const result = await this.executeWithRetry(handler, call, policy);
      call.output = result.output;
      await this.chain.runAfter(result, call);

      if (this.graphTracking) {
        const callResult: CallResult = { ok: result.ok, error: result.error };
        if (result.ok) {
          await this.graphTracking.afterCall(callResult, call, { store: this.memory, toolName, serverName });
        } else {
          await this.graphTracking.onError(new Error(result.error ?? "Unknown error"), call, {
            store: this.memory,
            toolName,
            serverName,
          });
        }
      }

      record(result.ok, result.error, call.output);
      return { decision, executed: true, output: call.output };
    };

    return this.graphTracking ? this.graphTracking.runInContext(runOnce) : runOnce();
  }

  /** Read the suggested retry policy from the store, else fall back to default. */
  private retryPolicyFor(toolName: string, serverName?: string): RetryPolicy {
    const rec = this.memory
      .getTool(toolName, serverName)
      ?.recommendations.find(
        (r) => r.type === "workflow" && r.payload != null && typeof r.payload === "object" && "retry" in r.payload,
      );
    if (rec && rec.payload && typeof rec.payload === "object" && "retry" in rec.payload) {
      return (rec.payload as { retry: RetryPolicy }).retry;
    }
    return this.defaultRetry;
  }

  private async executeWithRetry(
    handler: ToolHandler,
    call: PlannedCall,
    policy: RetryPolicy,
  ): Promise<{ ok: boolean; error?: string; output?: unknown }> {
    const attempts = policy.enabled ? Math.max(1, policy.maxAttempts) : 1;
    let last: { ok: boolean; error?: string; output?: unknown } = { ok: false, error: "no attempt" };
    for (let attempt = 0; attempt < attempts; attempt++) {
      last = await handler(call.input);
      if (last.ok) return last;
      if (attempt < attempts - 1 && policy.baseDelayMs > 0) {
        await delay(policy.baseDelayMs * 2 ** attempt);
      }
    }
    return last;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
