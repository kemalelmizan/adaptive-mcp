import type { Insight, Store, ToolRecord } from "@adaptivemcp/spec";

export interface EvaluationOptions {
  memory: Store;
  /** Failure rate above which an insight is emitted. */
  failureRateThreshold?: number;
  /** Minimum invocations before evaluating. */
  minInvocations?: number;
}

/**
 * Turns accumulated telemetry into learned insights.
 *
 * This is the "evaluate -> remember" step of the adaptation loop: it reads the
 * store stats and writes derived Insights back into the MemoryStore.
 */
export class Evaluator {
  private memory: Store;
  private failureRateThreshold: number;
  private minInvocations: number;

  constructor(options: EvaluationOptions) {
    this.memory = options.memory;
    this.failureRateThreshold = options.failureRateThreshold ?? 0.1;
    this.minInvocations = options.minInvocations ?? 10;
  }

  /** Evaluate a single tool and persist any derived insights. */
  evaluateTool(toolName: string, serverName?: string): Insight[] {
    const record = this.memory.getTool(toolName, serverName);
    if (!record) return [];
    return this.evaluateRecord(record);
  }

  /** Evaluate every known tool. */
  evaluateAll(): Insight[] {
    return this.memory.allTools().flatMap((r) => this.evaluateRecord(r));
  }

  private evaluateRecord(record: ToolRecord): Insight[] {
    const { stats } = record;
    if (stats.invocations < this.minInvocations) return [];

    const insights: Insight[] = [];
    const now = new Date().toISOString();

    if (stats.failureRate >= this.failureRateThreshold) {
      insights.push({
        toolName: record.toolName,
        serverName: record.serverName,
        key: "observed_failure_rate",
        value: Number(stats.failureRate.toFixed(4)),
        confidence: confidenceFor(stats.invocations),
        source: "evaluation",
        observedAt: now,
        sampleSize: stats.invocations,
      });
    }

    if (stats.avgDurationMs != null) {
      insights.push({
        toolName: record.toolName,
        serverName: record.serverName,
        key: "avg_duration_ms",
        value: Math.round(stats.avgDurationMs),
        confidence: confidenceFor(stats.invocations),
        source: "telemetry",
        observedAt: now,
        sampleSize: stats.invocations,
      });
    }

    for (const insight of insights) {
      this.memory.addInsight(insight);
    }
    return insights;
  }
}

function confidenceFor(sampleSize: number): number {
  // Simple saturating confidence: reaches ~0.95 by 100 samples.
  return Number(Math.min(0.95, 0.5 + sampleSize / 200).toFixed(2));
}
