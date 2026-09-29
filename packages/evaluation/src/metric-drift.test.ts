import { describe, it, expect } from "vitest";
import type { MetricCell } from "@adaptivemcp/spec";
import { computeMetricDrift } from "./metric-drift.js";

function cell(overrides: Partial<MetricCell>): MetricCell {
  return {
    toolName: "deploy",
    serverName: "srv",
    window: "all",
    dimensions: {},
    invocations: 0,
    failures: 0,
    attempts: 0,
    errorCodes: {},
    durationSum: 0,
    durationCount: 0,
    durationHistogram: [],
    tokenInSum: 0,
    tokenOutSum: 0,
    tokenCount: 0,
    costSum: 0,
    firstSeen: "",
    lastSeen: "",
    exemplars: [],
    ...overrides,
  };
}

describe("computeMetricDrift", () => {
  it("computes recent-vs-lifetime deltas and a regressing direction", () => {
    const cells = [
      cell({ window: "all", invocations: 20, failures: 2, durationSum: 2000, durationCount: 20 }),
      cell({ window: "hour:2026-09-29T13", invocations: 5, failures: 3, durationSum: 1000, durationCount: 5 }),
    ];

    const [drift] = computeMetricDrift(cells);
    expect(drift?.toolName).toBe("deploy");
    expect(drift?.failureRateDelta).toBeCloseTo(0.5, 4);
    expect(drift?.latencyDeltaMs).toBe(100);
    expect(drift?.direction).toBe("regressing");
  });

  it("uses the latest hourly window and ignores dimensioned cells", () => {
    const cells = [
      cell({ window: "all", invocations: 10, failures: 1, durationSum: 1000, durationCount: 10 }),
      cell({ window: "hour:2026-09-29T12", invocations: 2, failures: 0, durationSum: 200, durationCount: 2 }),
      cell({ window: "hour:2026-09-29T13", invocations: 4, failures: 0, durationSum: 240, durationCount: 4 }),
      cell({ window: "all", dimensions: { model: "qwen" }, invocations: 9, failures: 9 }),
    ];

    const [drift] = computeMetricDrift(cells);
    expect(drift?.window).toBe("hour:2026-09-29T13");
    expect(drift?.direction).toBe("improving");
  });

  it("returns nothing without a comparable window", () => {
    expect(computeMetricDrift([cell({ window: "all", invocations: 5 })])).toEqual([]);
  });
});
