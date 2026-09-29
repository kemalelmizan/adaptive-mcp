import { describe, it, expect } from "vitest";
import type { MetricCell, ToolExecutionEvent } from "@adaptivemcp/spec";
import { DecodingAnalyzer } from "./decoding-analyzer.js";

function event(overrides: Partial<ToolExecutionEvent>): ToolExecutionEvent {
  return {
    id: crypto.randomUUID(),
    toolName: "deploy",
    timestamp: new Date().toISOString(),
    status: "completed",
    decoding: { profile: "deterministic", resolverVersion: "1.0.0", resolved: { temperature: 0.2 } },
    ...overrides,
  };
}

describe("DecodingAnalyzer", () => {
  it("groups by (tool, profile, model, resolverVersion) and computes stats", () => {
    const events: ToolExecutionEvent[] = [
      ...Array.from({ length: 6 }, (_, i) =>
        event({
          toolName: "a",
          model: "m1",
          durationMs: 100,
          status: i < 2 ? "failed" : "completed",
          usage: { inputTokens: 10, outputTokens: 5 },
        }),
      ),
      ...Array.from({ length: 6 }, () => event({ toolName: "a", model: "m2", durationMs: 200 })),
      event({ toolName: "b", model: "m1" }), // below minSamples
    ];

    const groups = new DecodingAnalyzer({ minSamples: 5 }).analyze(events);
    expect(groups).toHaveLength(2);

    const m1 = groups.find((group) => group.model === "m1")!;
    expect(m1.invocations).toBe(6);
    expect(m1.failures).toBe(2);
    expect(m1.failureRate).toBeCloseTo(0.3333, 3);
    expect(m1.avgDurationMs).toBe(100);
    expect(m1.avgInputTokens).toBe(10);
    expect(m1.avgOutputTokens).toBe(5);
    expect(m1.suggestedProfile).toBe("deterministic");

    const m2 = groups.find((group) => group.model === "m2")!;
    expect(m2.failureRate).toBe(0);
    expect(m2.avgDurationMs).toBe(200);
    expect(m2.suggestedProfile).toBe("deterministic");
  });

  it("ignores events without decoding and non-terminal statuses", () => {
    const groups = new DecodingAnalyzer().analyze([
      event({ decoding: undefined }),
      event({ status: "started" }),
      event({ status: "cancelled" }),
    ]);
    expect(groups).toEqual([]);
  });

  it("keeps a healthy profile when the failure rate is low", () => {
    const events = Array.from({ length: 5 }, () =>
      event({ decoding: { profile: "balanced", resolverVersion: "1.0.0", resolved: {} } }),
    );
    const groups = new DecodingAnalyzer().analyze(events);
    expect(groups[0]?.suggestedProfile).toBe("balanced");
  });

  describe("analyzeCells", () => {
    const cell: MetricCell = {
      toolName: "a",
      serverName: "srv",
      window: "all",
      dimensions: { model: "m1", decodingProfile: "deterministic", resolverVersion: "1.0.0" },
      invocations: 10,
      failures: 1,
      errorCodes: {},
      durationSum: 500,
      durationCount: 10,
      durationHistogram: [10],
      tokenInSum: 100,
      tokenOutSum: 50,
      tokenCount: 10,
      costSum: 0,
      firstSeen: "",
      lastSeen: "",
      exemplars: [],
    };

    it("reads a pre-aggregated cell", () => {
      const groups = new DecodingAnalyzer().analyzeCells([cell]);
      expect(groups).toHaveLength(1);
      expect(groups[0]?.profile).toBe("deterministic");
      expect(groups[0]?.model).toBe("m1");
      expect(groups[0]?.resolverVersion).toBe("1.0.0");
      expect(groups[0]?.avgDurationMs).toBe(50);
      expect(groups[0]?.avgInputTokens).toBe(10);
      expect(groups[0]?.avgOutputTokens).toBe(5);
      expect(groups[0]?.suggestedProfile).toBe("deterministic");
    });

    it("ignores non-decoding cells and cells below minSamples", () => {
      const noProfile: MetricCell = { ...cell, dimensions: { model: "m1" } };
      expect(new DecodingAnalyzer().analyzeCells([noProfile])).toEqual([]);
      expect(new DecodingAnalyzer({ minSamples: 20 }).analyzeCells([cell])).toEqual([]);
    });
  });
});
