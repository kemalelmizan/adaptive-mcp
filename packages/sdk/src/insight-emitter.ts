import type { ToolExecutionEvent } from "@adaptivemcp/spec";
import { computeToolStats, type TelemetryStore, type ToolStats } from "@adaptivemcp/telemetry";
import type { Middleware } from "./middleware.js";

export interface InsightEmitterOptions {
  store: TelemetryStore;
  failureRateThreshold?: number;
  minInvocations?: number;
}

/**
 * Example middleware that derives a simple insight from telemetry: when a tool's
 * observed failure rate crosses a threshold, it emits an insight signal. This is
 * the "evaluate -> remember" step of the adaptation loop.
 */
export class InsightEmitter implements Middleware {
  name = "insight-emitter";
  private store: TelemetryStore;
  private failureRateThreshold: number;
  private minInvocations: number;

  constructor(options: InsightEmitterOptions) {
    this.store = options.store;
    this.failureRateThreshold = options.failureRateThreshold ?? 0.1;
    this.minInvocations = options.minInvocations ?? 10;
  }

  onEvent(event: ToolExecutionEvent): void {
    if (event.status !== "completed" && event.status !== "failed") return;
    const stats: ToolStats = computeToolStats(this.store, event.toolName);
    if (stats.invocations < this.minInvocations) return;
    if (stats.failureRate >= this.failureRateThreshold) {
      // In a full implementation this would push an Insight into @adaptivemcp/memory.
      // Here we surface it on the console as a research signal.
      console.warn(
        `[adaptive] insight: ${event.toolName} failure rate ` +
          `${(stats.failureRate * 100).toFixed(1)}% over ${stats.invocations} calls`,
      );
    }
  }
}
