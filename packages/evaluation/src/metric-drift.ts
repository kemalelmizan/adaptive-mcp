import type { MetricCell } from "@adaptivemcp/spec";

/** Recent-vs-lifetime drift for one tool, computed from metric cells. */
export interface MetricDrift {
  toolName: string;
  serverName?: string;
  /** The most recent hourly window compared. */
  window: string;
  baseline: { invocations: number; failureRate: number; avgDurationMs: number | null };
  recent: { invocations: number; failureRate: number; avgDurationMs: number | null };
  /** recent.failureRate - baseline.failureRate. */
  failureRateDelta: number;
  /** recent.avgDurationMs - baseline.avgDurationMs (0 when either is unknown). */
  latencyDeltaMs: number;
  direction: "improving" | "regressing" | "stable";
}

export interface MetricDriftOptions {
  /** Skip a tool unless its most recent window has at least this many calls. Default 1. */
  minRecentInvocations?: number;
  /** |failure-rate delta| at/above which the direction flips. Default 0.05. */
  failureRateThreshold?: number;
  /** |latency delta| in ms at/above which the direction flips. Default 50. */
  latencyThresholdMs?: number;
}

function failureRate(cell: MetricCell): number {
  return cell.invocations > 0 ? cell.failures / cell.invocations : 0;
}

function avgDurationMs(cell: MetricCell): number | null {
  return cell.durationCount > 0 ? cell.durationSum / cell.durationCount : null;
}

/**
 * Compare each tool's most recent hourly metric cell against its lifetime `all`
 * cell, yielding drift/regression signals **without an events table**. Pure and
 * computed-on-read, like `GraphAnalyzer` and `DecodingAnalyzer`.
 */
export function computeMetricDrift(
  cells: MetricCell[],
  options: MetricDriftOptions = {},
): MetricDrift[] {
  const minRecent = options.minRecentInvocations ?? 1;
  const failureThreshold = options.failureRateThreshold ?? 0.05;
  const latencyThreshold = options.latencyThresholdMs ?? 50;

  // Only overall ({} dimensions) cells carry both `all` and hourly windows.
  const byTool = new Map<string, { baseline?: MetricCell; recent?: MetricCell }>();
  for (const cell of cells) {
    if (Object.keys(cell.dimensions).length > 0) continue;
    const key = `${cell.toolName}\u0000${cell.serverName ?? ""}`;
    const entry = byTool.get(key) ?? {};
    if (cell.window === "all") {
      entry.baseline = cell;
    } else if (cell.window.startsWith("hour:")) {
      if (!entry.recent || cell.window > entry.recent.window) entry.recent = cell;
    }
    byTool.set(key, entry);
  }

  const drifts: MetricDrift[] = [];
  for (const { baseline, recent } of byTool.values()) {
    if (!baseline || !recent || recent.invocations < minRecent) continue;

    const failureRateDelta = failureRate(recent) - failureRate(baseline);
    const recentAvg = avgDurationMs(recent);
    const baselineAvg = avgDurationMs(baseline);
    const latencyDeltaMs =
      recentAvg !== null && baselineAvg !== null ? recentAvg - baselineAvg : 0;

    const direction: MetricDrift["direction"] =
      failureRateDelta >= failureThreshold || latencyDeltaMs >= latencyThreshold
        ? "regressing"
        : failureRateDelta <= -failureThreshold || latencyDeltaMs <= -latencyThreshold
          ? "improving"
          : "stable";

    drifts.push({
      toolName: baseline.toolName,
      serverName: baseline.serverName,
      window: recent.window,
      baseline: {
        invocations: baseline.invocations,
        failureRate: failureRate(baseline),
        avgDurationMs: baselineAvg,
      },
      recent: {
        invocations: recent.invocations,
        failureRate: failureRate(recent),
        avgDurationMs: recentAvg,
      },
      failureRateDelta: Number(failureRateDelta.toFixed(4)),
      latencyDeltaMs: Math.round(latencyDeltaMs),
      direction,
    });
  }

  return drifts.sort(
    (a, b) =>
      Math.abs(b.failureRateDelta) - Math.abs(a.failureRateDelta) ||
      Math.abs(b.latencyDeltaMs) - Math.abs(a.latencyDeltaMs),
  );
}
