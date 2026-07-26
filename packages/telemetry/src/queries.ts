import type { TelemetryStore } from "./store.js";

export interface ToolStats {
  toolName: string;
  invocations: number;
  failures: number;
  failureRate: number;
  avgDurationMs: number | null;
  totalCost: number;
}

/**
 * Compute aggregate statistics for a tool from its recorded events. This is the
 * observation layer feeding evaluation and routing.
 */
export function computeToolStats(
  store: TelemetryStore,
  toolName: string,
  serverName?: string,
): ToolStats {
  const events = store.byTool(toolName, serverName);
  const invocations = events.length;
  const failures = events.filter((e) => e.status === "failed").length;

  const durations = events
    .map((e) => e.durationMs)
    .filter((d): d is number => typeof d === "number");
  const avgDurationMs =
    durations.length > 0
      ? durations.reduce((a, b) => a + b, 0) / durations.length
      : null;

  const totalCost = events.reduce(
    (sum, e) => sum + (e.cost?.amount ?? 0),
    0,
  );

  return {
    toolName,
    invocations,
    failures,
    failureRate: invocations > 0 ? failures / invocations : 0,
    avgDurationMs,
    totalCost,
  };
}
