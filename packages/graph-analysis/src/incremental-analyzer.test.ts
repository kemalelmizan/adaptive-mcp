import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { MemoryStore } from "@adaptivemcp/memory";
import type { ExecutionNode } from "@adaptivemcp/spec";
import { GraphAnalyzer } from "./analyzer.js";
import { IncrementalGraphAnalyzer } from "./incremental-analyzer.js";

function node(overrides: Partial<ExecutionNode> & { id: string }): ExecutionNode {
  return {
    toolName: "tool",
    sessionId: "s1",
    childrenIds: [],
    timestamp: new Date().toISOString(),
    status: "completed",
    ...overrides,
  };
}

describe("@adaptivemcp/graph-analysis IncrementalGraphAnalyzer", () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore({ path: ":memory:" });
    store.recordExecutionNode(node({ id: "root", durationMs: 100, childrenIds: ["a"] }));
    store.recordExecutionNode(node({ id: "a", parentId: "root", durationMs: 200, childrenIds: [] }));
  });

  afterEach(() => store.close());

  it("returns cached results without re-querying memory within the cache window", () => {
    const analyzer = new IncrementalGraphAnalyzer(store, { maxCacheAgeMs: 60_000 });
    const spy = vi.spyOn(store, "getNodesBySession");

    analyzer.getCriticalPath("s1");
    analyzer.getCriticalPath("s1");
    analyzer.getBottlenecks("s1");

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("re-queries after invalidate() is called", () => {
    const analyzer = new IncrementalGraphAnalyzer(store, { maxCacheAgeMs: 60_000 });
    const spy = vi.spyOn(store, "getNodesBySession");

    analyzer.getCriticalPath("s1");
    analyzer.invalidate("s1");
    analyzer.getCriticalPath("s1");

    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("re-queries after maxCacheAgeMs elapses", () => {
    vi.useFakeTimers();
    try {
      const analyzer = new IncrementalGraphAnalyzer(store, { maxCacheAgeMs: 1000 });
      const spy = vi.spyOn(store, "getNodesBySession");

      analyzer.getCriticalPath("s1");
      vi.advanceTimersByTime(1500);
      analyzer.getCriticalPath("s1");

      expect(spy).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("produces identical results to the stateless GraphAnalyzer for the same data", () => {
    const stateless = new GraphAnalyzer(store);
    const incremental = new IncrementalGraphAnalyzer(store);

    expect(incremental.getCriticalPath("s1")).toEqual(stateless.getCriticalPath("s1"));
    expect(incremental.getBottlenecks("s1")).toEqual(stateless.getBottlenecks("s1"));
    expect(incremental.getFanOutAnalysis("s1")).toEqual(stateless.getFanOutAnalysis("s1"));
    expect(incremental.getCostBreakdown("s1")).toEqual(stateless.getCostBreakdown("s1"));
  });
});
