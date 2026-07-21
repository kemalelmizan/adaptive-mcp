import type { Store } from "@adaptivemcp/spec";

export interface RetryPolicy {
  /** Maximum attempts (including the first). */
  maxAttempts: number;
  /** Base backoff in ms. */
  baseDelayMs: number;
  /** Whether to retry on observed flakiness. */
  enabled: boolean;
}

export interface OrchestrationOptions {
  memory: Store;
  /** Default retry policy applied to flaky tools. */
  defaultPolicy?: RetryPolicy;
  /** Failure rate at/above which a tool is considered flaky. */
  flakyThreshold?: number;
  /** Minimum invocations before a policy is suggested. */
  minInvocations?: number;
}

/**
 * Derives execution strategies (currently: retry policies) from observed
 * behavior. When a tool's observed failure rate crosses `flakyThreshold`, a
 * `workflow` recommendation suggesting a retry policy is written into the store.
 *
 * The package is intentionally limited to *suggesting* strategies here; the
 * actual retry execution belongs to the caller (e.g. the thin client or an
 * agent loop), which can read the recommendation and act on it.
 */
export class Orchestrator {
  private memory: Store;
  private defaultPolicy: RetryPolicy;
  private flakyThreshold: number;
  private minInvocations: number;

  constructor(options: OrchestrationOptions) {
    this.memory = options.memory;
    this.defaultPolicy = options.defaultPolicy ?? {
      maxAttempts: 3,
      baseDelayMs: 200,
      enabled: true,
    };
    this.flakyThreshold = options.flakyThreshold ?? 0.1;
    this.minInvocations = options.minInvocations ?? 10;
  }

  /** Evaluate every known tool and persist retry-policy recommendations. */
  planAll(): void {
    for (const record of this.memory.allTools()) {
      this.planTool(record.toolName, record.serverName);
    }
  }

  /** Evaluate a single tool, writing a `workflow` recommendation if flaky. */
  planTool(toolName: string, serverName?: string): void {
    const record = this.memory.getTool(toolName, serverName);
    if (!record) return;
    if (record.stats.invocations < this.minInvocations) return;

    this.memory.clearRecommendations(toolName, "workflow", serverName);

    if (record.stats.failureRate >= this.flakyThreshold) {
      const policy = this.policyFor(record.stats.failureRate);
      this.memory.addRecommendation({
        toolName,
        serverName,
        type: "workflow",
        payload: { retry: policy },
        rationale: `Observed failure rate ${record.stats.failureRate.toFixed(
          2,
        )} >= ${this.flakyThreshold}; apply retry with backoff.`,
        confidence: confidenceFor(record.stats.invocations),
        generatedAt: new Date().toISOString(),
      });
    }
  }

  /** Scale retry attempts up with the failure rate (capped by the default). */
  private policyFor(failureRate: number): RetryPolicy {
    const extra = Math.round(failureRate * 5); // up to +5 attempts at 100% failure
    return {
      ...this.defaultPolicy,
      maxAttempts: Math.min(6, this.defaultPolicy.maxAttempts + extra),
    };
  }
}

function confidenceFor(sampleSize: number): number {
  return Number(Math.min(0.95, 0.5 + sampleSize / 200).toFixed(2));
}
