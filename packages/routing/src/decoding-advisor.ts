import type { Store, ToolRecord, Recommendation, DecodingProfile } from "@adaptivemcp/spec";

export type DecodingProfileId = DecodingProfile["id"];

export interface DecodingThresholds {
  /** failureRate at/above which the effective profile is forced to "deterministic". Default 0.2. */
  highFailureRate?: number;
  /** failureRate at/above which a "creative" baseline is tempered to "balanced". Default 0.1. */
  moderateFailureRate?: number;
}

export interface DecodingAdvisorOptions {
  memory: Store;
  /** Minimum invocations before the advisor trusts observed stats. */
  minInvocations?: number;
  thresholds?: DecodingThresholds;
  /** Baseline profile used when no `intentProfile` is supplied. Default "balanced". */
  defaultProfile?: DecodingProfileId;
}

/**
 * Turns observed failure-rate stats + a caller-supplied intent into a
 * symbolic `DecodingProfile` recommendation (`type: "decoding"`) — never raw
 * sampling numbers. Backend-specific translation is `DecodingResolver`'s job
 * (see decoding-resolver.ts), not this class's.
 *
 * Composition, not replacement (docs/doubts.md §13 D2): `intentProfile` is
 * the baseline (e.g. "architecture review" -> "balanced", decided by the
 * caller — this class never classifies intent from free text, see D3).
 * Observed failure rate can then pull the *effective* profile toward
 * "deterministic" regardless of that baseline. The resolver never sees
 * telemetry and never learns (D4) — all adaptation happens here.
 *
 * Deliberately advisory-only: this class never touches an LLM or a resolver.
 * It only writes a `Recommendation` a host (or `DecodingResolver`, via
 * `toDecodingRecommendation`) can read.
 */
export class DecodingAdvisor {
  private memory: Store;
  private minInvocations: number;
  private highFailureRate: number;
  private moderateFailureRate: number;
  private defaultProfile: DecodingProfileId;

  constructor(options: DecodingAdvisorOptions) {
    this.memory = options.memory;
    this.minInvocations = options.minInvocations ?? 10;
    this.highFailureRate = options.thresholds?.highFailureRate ?? 0.2;
    this.moderateFailureRate = options.thresholds?.moderateFailureRate ?? 0.1;
    this.defaultProfile = options.defaultProfile ?? "balanced";
  }

  /** Evaluate every known tool and persist (or clear) decoding recommendations. */
  adviseAll(intentProfile?: DecodingProfileId): void {
    for (const record of this.memory.allTools()) {
      this.advise(record.toolName, record.serverName, intentProfile);
    }
  }

  /**
   * Recompute and persist (or clear) the `decoding` recommendation for one
   * tool. `intentProfile` is the caller-supplied baseline (falls back to
   * `defaultProfile` if omitted); telemetry may still override it.
   */
  advise(toolName: string, serverName?: string, intentProfile?: DecodingProfileId): Recommendation | undefined {
    const record = this.memory.getTool(toolName, serverName);
    if (!record) return undefined;

    this.memory.clearRecommendations(toolName, "decoding", serverName);
    if (record.stats.invocations < this.minInvocations) return undefined;

    const rec = this.computeRecommendation(record, intentProfile ?? this.defaultProfile);
    this.memory.addRecommendation(rec);
    return rec;
  }

  private computeRecommendation(record: ToolRecord, baseline: DecodingProfileId): Recommendation {
    const { failureRate } = record.stats;
    const reasons: string[] = [`intent baseline: ${baseline}`];
    let effective: DecodingProfileId = baseline;

    if (failureRate >= this.highFailureRate) {
      effective = "deterministic";
      reasons.push(
        `high observed failure rate (${failureRate.toFixed(2)}) overrides the baseline toward deterministic`,
      );
    } else if (failureRate >= this.moderateFailureRate && baseline === "creative") {
      effective = "balanced";
      reasons.push(
        `moderate observed failure rate (${failureRate.toFixed(2)}) tempers a creative baseline toward balanced`,
      );
    }

    const payload: DecodingProfile = { id: effective };
    return {
      toolName: record.toolName,
      serverName: record.serverName,
      type: "decoding",
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
