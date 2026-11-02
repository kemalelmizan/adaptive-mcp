import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryStore, modelStatsFromCells } from "./store.js";
import type { MetricCell, ToolExecutionEvent } from "@adaptivemcp/spec";

/** A lifetime cell with whatever dimensions the test needs. */
function cell(overrides: Partial<MetricCell> = {}): MetricCell {
  return {
    toolName: "search",
    window: "all",
    dimensions: {},
    invocations: 1,
    failures: 0,
    attempts: 1,
    errorCodes: {},
    durationSum: 100,
    durationCount: 1,
    durationHistogram: [],
    tokenInSum: 0,
    tokenOutSum: 0,
    tokenCount: 0,
    costSum: 0,
    firstSeen: "2026-11-01T00:00:00.000Z",
    lastSeen: "2026-11-02T00:00:00.000Z",
    exemplars: [],
    ...overrides,
  };
}

function event(overrides: Partial<ToolExecutionEvent> & { id: string }): ToolExecutionEvent {
  return {
    toolName: "search",
    serverName: "srv",
    timestamp: "2026-11-02T00:00:00.000Z",
    status: "completed",
    durationMs: 100,
    ...overrides,
  };
}

describe("per-model stats", () => {
  describe("modelStatsFromCells", () => {
    it("reads the { model } lifetime cell and computes rates", () => {
      const stats = modelStatsFromCells([
        cell({ dimensions: { model: "local/qwen3-8b" }, invocations: 10, failures: 2, durationSum: 500, durationCount: 10, costSum: 0.5 }),
      ]);

      expect(stats).toEqual([
        {
          model: "local/qwen3-8b",
          invocations: 10,
          failures: 2,
          failureRate: 0.2,
          avgDurationMs: 50,
          totalCost: 0.5,
          lastObservedAt: "2026-11-02T00:00:00.000Z",
        },
      ]);
    });

    it("ignores the overall cell, decoding slices, hourly windows and the overflow bucket", () => {
      const stats = modelStatsFromCells([
        cell({ dimensions: {} }), // no model
        cell({ dimensions: { model: "a" } }),
        // A slice of the same calls: counting it would double-count them.
        cell({ dimensions: { model: "a", decodingProfile: "p", resolverVersion: "1" } }),
        cell({ dimensions: { model: "b" }, window: "hour:2026-11-02T00" }),
        cell({ dimensions: { model: "other" } }), // cardinality overflow, not a model
      ]);

      expect(stats.map((entry) => entry.model)).toEqual(["a"]);
    });

    it("reports an unknown average duration rather than zero", () => {
      const [stats] = modelStatsFromCells([
        cell({ dimensions: { model: "a" }, durationSum: 0, durationCount: 0 }),
      ]);

      expect(stats?.avgDurationMs).toBeNull();
    });
  });

  describe("MemoryStore.modelStats", () => {
    let store: MemoryStore;

    beforeEach(() => {
      store = new MemoryStore({ path: ":memory:" });
    });

    afterEach(() => {
      store.close();
    });

    it("summarises what each model actually did on one tool", () => {
      for (let i = 0; i < 8; i += 1) {
        store.recordExecution(
          event({
            id: `fast-${i}`,
            model: "local/qwen3-8b",
            status: i === 0 ? "failed" : "completed",
            durationMs: 100,
          }),
        );
      }
      for (let i = 0; i < 4; i += 1) {
        store.recordExecution(
          event({ id: `cloud-${i}`, model: "cloud/deepseek", durationMs: 400 }),
        );
      }

      const stats = store.modelStats("search", "srv");

      expect(stats.map((entry) => entry.model)).toEqual(["cloud/deepseek", "local/qwen3-8b"]);
      expect(stats[0]).toMatchObject({ invocations: 4, failures: 0, avgDurationMs: 400 });
      expect(stats[1]).toMatchObject({ invocations: 8, failures: 1, avgDurationMs: 100 });
      expect(stats[1]?.failureRate).toBeCloseTo(0.125);
    });

    it("keeps servers apart when one is named, and sums when none is", () => {
      store.recordExecution(event({ id: "a", model: "m", serverName: "one" }));
      store.recordExecution(event({ id: "b", model: "m", serverName: "two", status: "failed" }));

      expect(store.modelStats("search", "one")).toEqual([
        expect.objectContaining({ model: "m", invocations: 1, failures: 0 }),
      ]);
      // No server named: the tool name is all we were told, so the rows add up.
      expect(store.modelStats("search")).toEqual([
        expect.objectContaining({ model: "m", invocations: 2, failures: 1 }),
      ]);
    });

    it("returns nothing for a tool with no per-model cells", () => {
      store.recordExecution(event({ id: "a" })); // no model on the event

      expect(store.modelStats("search", "srv")).toEqual([]);
    });
  });
});
