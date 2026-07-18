import type { MemoryStore } from "@adaptivemcp/memory";
import type { ApprovalGate, ApprovalDecision } from "@adaptivemcp/approval";
import type { RetryPolicy } from "@adaptivemcp/orchestration";

export interface ToolHandler {
  (input: unknown): Promise<{ ok: boolean; error?: string }>;
}

export interface ThinClientOptions {
  memory: MemoryStore;
  /** The approval gate used before each tool call. */
  gate: ApprovalGate;
  /**
   * Called when the gate returns `require_confirmation`. Return true to proceed.
   * In a real client this would prompt a human; here it is injectable.
   */
  requestApproval?: (toolName: string) => boolean | Promise<boolean>;
  /** Default retry policy if none is suggested for a tool. */
  defaultRetry?: RetryPolicy;
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
 *      SSOT `workflow` recommendation (or the default);
 *   3. records the outcome into the SSOT via the caller-supplied recorder.
 *
 * It does NOT implement MCP transport — that remains the official SDK's job. It
 * is the "operational machinery" that runs on the client side.
 */
export class ThinClient {
  private memory: MemoryStore;
  private gate: ApprovalGate;
  private requestApproval: (toolName: string) => boolean | Promise<boolean>;
  private defaultRetry: RetryPolicy;

  constructor(options: ThinClientOptions) {
    this.memory = options.memory;
    this.gate = options.gate;
    this.requestApproval = options.requestApproval ?? (() => true);
    this.defaultRetry = options.defaultRetry ?? {
      maxAttempts: 1,
      baseDelayMs: 0,
      enabled: false,
    };
  }

  /**
   * Plan + execute a single tool call through the approval gate and retry loop.
   * Returns the decision and whether the tool actually ran.
   */
  async run(
    toolName: string,
    handler: ToolHandler,
    input: unknown,
    record: (ok: boolean, error?: string) => void,
  ): Promise<{ decision: ApprovalDecision; executed: boolean }> {
    const decision = this.gate.gate(toolName);
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

    const policy = this.retryPolicyFor(toolName);
    const result = await this.executeWithRetry(handler, input, policy);
    record(result.ok, result.error);
    return { decision, executed: true };
  }

  /** Read the suggested retry policy from the SSOT, else fall back to default. */
  private retryPolicyFor(toolName: string): RetryPolicy {
    const rec = this.memory
      .getTool(toolName)
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
    input: unknown,
    policy: RetryPolicy,
  ): Promise<{ ok: boolean; error?: string }> {
    const attempts = policy.enabled ? Math.max(1, policy.maxAttempts) : 1;
    let last: { ok: boolean; error?: string } = { ok: false, error: "no attempt" };
    for (let attempt = 0; attempt < attempts; attempt++) {
      last = await handler(input);
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
