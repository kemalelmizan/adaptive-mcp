import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryStore } from "@adaptivemcp/memory";
import type { ExecutionNode } from "@adaptivemcp/spec";
import { GraphAnalyzer } from "./analyzer.js";

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

describe("@adaptivemcp/graph-analysis GraphAnalyzer", () => {
  let store: MemoryStore;
  let analyzer: GraphAnalyzer;

  beforeEach(() => {
    store = new MemoryStore({ path: ":memory:" });
    analyzer = new GraphAnalyzer(store);
  });

  afterEach(() => store.close());

  /** root -> a -> b (chain), root -> c (short branch); chain is the critical path by duration. */
  function seedChain(): void {
    store.recordExecutionNode(node({ id: "root", durationMs: 100, childrenIds: ["a", "c"] }));
    store.recordExecutionNode(node({ id: "a", parentId: "root", durationMs: 1500, childrenIds: ["b"] }));
    store.recordExecutionNode(node({ id: "b", parentId: "a", durationMs: 400, childrenIds: [] }));
    store.recordExecutionNode(node({ id: "c", parentId: "root", durationMs: 50, childrenIds: [] }));
  }

  it("computes the critical path for a branching graph", () => {
    seedChain();
    const result = analyzer.getCriticalPath("s1");
    expect(result.path.map((n) => n.id)).toEqual(["root", "a", "b"]);
    expect(result.totalDurationMs).toBe(2000);
  });

  it("returns an empty critical path for a session with no nodes", () => {
    const result = analyzer.getCriticalPath("nope");
    expect(result).toEqual({ path: [], totalDurationMs: 0 });
  });

  it("computes bottlenecks along the critical path", () => {
    seedChain();
    const bottlenecks = analyzer.getBottlenecks("s1");
    expect(bottlenecks.length).toBeGreaterThan(0);
    expect(bottlenecks[0]?.node.id).toBe("a");
  });

  it("computes fan-out analysis", () => {
    seedChain();
    const report = analyzer.getFanOutAnalysis("s1");
    expect(report.maxFanOut).toBe(2);
    expect(report.parallelizableNodes.map((n) => n.id)).toEqual(["root"]);
  });

  it("computes failure cascade blast radius", () => {
    store.recordExecutionNode(node({ id: "root", childrenIds: ["a"] }));
    store.recordExecutionNode(node({ id: "a", parentId: "root", status: "failed", childrenIds: ["b"] }));
    store.recordExecutionNode(node({ id: "b", parentId: "a", childrenIds: [] }));

    const cascades = analyzer.getFailureCascade("s1");
    expect(cascades).toHaveLength(1);
    expect(cascades[0]?.rootCause.id).toBe("a");
    expect(cascades[0]?.blastRadius).toBe(1);
    expect(cascades[0]?.affectedNodes.map((n) => n.id)).toEqual(["b"]);
  });

  it("computes cost breakdown by tool, node, and critical path", () => {
    store.recordExecutionNode(
      node({ id: "root", toolName: "deploy", durationMs: 100, cost: { amount: 0.01 }, childrenIds: ["a"] }),
    );
    store.recordExecutionNode(
      node({ id: "a", parentId: "root", toolName: "deploy", durationMs: 200, cost: { amount: 0.02 }, childrenIds: [] }),
    );

    const breakdown = analyzer.getCostBreakdown("s1");
    expect(breakdown.totalCost).toBeCloseTo(0.03);
    expect(breakdown.byTool.deploy).toBeCloseTo(0.03);
    expect(breakdown.byNode.root).toBeCloseTo(0.01);
    expect(breakdown.criticalPathCost).toBeCloseTo(0.03);
  });
});
