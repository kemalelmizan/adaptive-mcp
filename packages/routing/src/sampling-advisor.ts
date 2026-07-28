import type { Store, ToolRecord, Recommendation, SamplingRecommendationPayload } from "@adaptivemcp/spec";

export interface SamplingThresholds {
  /** failureRate at/above which temperature/top_p are cut hard. Default 0.2. */
  highFailureRate?: number;
  /** failureRate at/above which temperature/top_p are cut moderately. Default 0.1. */
  moderateFailureRate?: number;
}

export interface SamplingAdvisorOptions {
  memory: Store;
  /** Minimum invocations before the advisor trusts observed stats. */
  minInvocations?: number;
  thresholds?: SamplingThresholds;
}

/**
 * Turns observed failure-rate stats into sampling-parameter recommendations
 * (`type: "sampling"`), following the same evaluate-stats -> persist-
 * recommendation shape as `Router`.
 *
 * Deliberately advisory-only: this class never touches an LLM. It only writes
 * a `Recommendation` a host can read (directly, via the YAML view, or via
 * `ThinClient`'s `onSamplingRecommendation` hook) and apply itself.
 */
export class SamplingAdvisor {
  private memory: Store;
  private minInvocations: number;
  private highFailureRate: number;
  private moderateFailureRate: number;

  constructor(options: SamplingAdvisorOptions) {
    this.memory = options.memory;
    this.minInvocations = options.minInvocations ?? 10;
    this.highFailureRate = options.thresholds?.highFailureRate ?? 0.2;
    this.moderateFailureRate = options.thresholds?.moderateFailureRate ?? 0.1;
  }

  /** Evaluate every known tool and persist (or clear) sampling recommendations. */
  adviseAll(): void {
    for (const record of this.memory.allTools()) {
      this.advise(record.toolName, record.serverName);
    }
  }

  /** Recompute and persist (or clear) the `sampling` recommendation for one tool. */
  advise(toolName: string, serverName?: string): Recommendation | undefined {
    const record = this.memory.getTool(toolName, serverName);
    if (!record) return undefined;

    this.memory.clearRecommendations(toolName, "sampling", serverName);
    if (record.stats.invocations < this.minInvocations) return undefined;

    const rec = this.computeRecommendation(record);
    if (!rec) return undefined;

    this.memory.addRecommendation(rec);
    return rec;
  }

  private computeRecommendation(record: ToolRecord): Recommendation | undefined {
    const { failureRate } = record.stats;
    const payload: SamplingRecommendationPayload = {};
    const reasons: string[] = [];

    if (failureRate >= this.highFailureRate) {
      payload.temperature = 0.2;
      payload.topP = 0.5;
      reasons.push(
        `high observed failure rate (${failureRate.toFixed(2)}) — lower temperature/top_p for more deterministic tool-call arguments`,
      );
    } else if (failureRate >= this.moderateFailureRate) {
      payload.temperature = 0.4;
      payload.topP = 0.7;
      reasons.push(`moderate observed failure rate (${failureRate.toFixed(2)}) — moderately lower temperature/top_p`);
    }

    if (Object.keys(payload).length === 0) return undefined;

    return {
      toolName: record.toolName,
      serverName: record.serverName,
      type: "sampling",
      payload,
      rationale: reasons.join("; "),
      confidence: confidenceFor(record.stats.invocations),
      generatedAt: new Date().toISOString(),
    };
  }
}

function confidenceFor(sampleSize: number): number {
  return Number(Math.min(0.95, 0.5 + sampleSize / 200).toFixed(2));
}
