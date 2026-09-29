import type { Store, Recommendation } from "@adaptivemcp/spec";
import type { ApprovalGate, ApprovalDecision } from "@adaptivemcp/approval";
import type { RetryPolicy } from "@adaptivemcp/orchestration";
import { MiddlewareChain, type Middleware, type PlannedCall, type CallResult } from "@adaptivemcp/middleware";
import type { SamplingAdvisor } from "@adaptivemcp/routing";
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
  /**
   * Optional sampling-parameter advisor. When set, ThinClient recomputes the
   * `sampling` recommendation for this tool immediately after this call's
   * telemetry is recorded (i.e. using stats that include *this* call), then —
   * if `onSamplingRecommendation` is also set — invokes it.
   *
   * This is advisory-only: ThinClient never makes an LLM call itself. The
   * host must read the payload from the hook (or from the recommendation in
   * the store / tools-metadata.yaml) and pass it into its own next
   * completion request for it to have any effect.
   */
  samplingAdvisor?: SamplingAdvisor;
  /**
   * Called after `run()` records this call's telemetry and (if
   * `samplingAdvisor` is set) recomputes the `sampling` recommendation —
   * representing "here is the suggested sampling config for your next LLM
   * turn involving this tool." Not called when `samplingAdvisor` is unset or
   * produces no recommendation, or when the call was denied/blocked before
   * execution.
   */
  onSamplingRecommendation?: (rec: Recommendation, ctx: { toolName: string; serverName?: string }) => void | Promise<void>;
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
  private samplingAdvisor?: SamplingAdvisor;
  private onSamplingRecommendation?: (
    rec: Recommendation,
    ctx: { toolName: string; serverName?: string },
  ) => void | Promise<void>;

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
    this.samplingAdvisor = options.samplingAdvisor;
    this.onSamplingRecommendation = options.onSamplingRecommendation;
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
  ): Promise<{ decision: ApprovalDecision; executed: boolean; output?: unknown; attempts?: number }> {
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
    const runOnce = async (): Promise<{ decision: ApprovalDecision; executed: boolean; output?: unknown; attempts?: number }> => {
      await this.chain.runBefore(call);

      if (this.graphTracking) {
        await this.graphTracking.beforeCall(call);
      }

      const policy = this.retryPolicyFor(toolName, serverName);
      const result = await this.executeWithRetry(handler, call, policy);
      call.output = result.output;
      await this.chain.runAfter(result, call);

      if (this.graphTracking) {
        const callResult: CallResult = { ok: result.ok, error: result.error };
        if (result.ok) {
          await this.graphTracking.afterCall(callResult, call);
        } else {
          await this.graphTracking.onError(new Error(result.error ?? "Unknown error"));
        }
      }

      record(result.ok, result.error, call.output);

      if (this.samplingAdvisor) {
        const rec = this.samplingAdvisor.advise(toolName, serverName);
        if (rec && this.onSamplingRecommendation) {
          await this.onSamplingRecommendation(rec, { toolName, serverName });
        }
      }

      return { decision, executed: true, output: call.output, attempts: result.attempts };
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
  ): Promise<{ ok: boolean; error?: string; output?: unknown; attempts: number }> {
    const attempts = policy.enabled ? Math.max(1, policy.maxAttempts) : 1;
    let last: { ok: boolean; error?: string; output?: unknown } = { ok: false, error: "no attempt" };
    let tried = 0;
    for (let attempt = 0; attempt < attempts; attempt++) {
      tried = attempt + 1;
      last = await handler(call.input);
      if (last.ok) return { ...last, attempts: tried };
      if (attempt < attempts - 1 && policy.baseDelayMs > 0) {
        await delay(policy.baseDelayMs * 2 ** attempt);
      }
    }
    return { ...last, attempts: tried };
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
