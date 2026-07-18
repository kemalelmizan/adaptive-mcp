import { describe, it, expect } from "vitest";
import { InMemoryTelemetryStore, TelemetryRecorder, computeToolStats } from "@adaptivemcp/telemetry";

describe("@adaptivemcp/telemetry", () => {
  it("records and queries events by tool", () => {
    const store = new InMemoryTelemetryStore();
    const rec = new TelemetryRecorder({ store });
    rec.complete({ toolName: "search_customer" }, { durationMs: 12 });
    rec.fail({ toolName: "search_customer" }, { message: "timeout" });

    expect(store.byTool("search_customer")).toHaveLength(2);
    const stats = computeToolStats(store, "search_customer");
    expect(stats.invocations).toBe(2);
    expect(stats.failures).toBe(1);
    expect(stats.failureRate).toBeCloseTo(0.5);
  });
});
