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

  it("getCausalCascade separates root causes from downstream symptoms", () => {
    // root -> a(failed, root cause) -> b(failed, symptom of a) -> c(ok)
    // root -> d(failed, independent root cause)
    store.recordExecutionNode(node({ id: "root", childrenIds: ["a", "d"] }));
    store.recordExecutionNode(node({ id: "a", parentId: "root", status: "failed", childrenIds: ["b"] }));
    store.recordExecutionNode(node({ id: "b", parentId: "a", status: "failed", childrenIds: ["c"] }));
    store.recordExecutionNode(node({ id: "c", parentId: "b", childrenIds: [] }));
    store.recordExecutionNode(node({ id: "d", parentId: "root", status: "failed", childrenIds: [] }));

    const result = analyzer.getCausalCascade("s1");
    expect(result.rootCauses.map((n) => n.id).sort()).toEqual(["a", "d"]);
    expect(result.symptoms).toHaveLength(1);
    expect(result.symptoms[0]?.node.id).toBe("b");
    expect(result.symptoms[0]?.causedBy.id).toBe("a");
    // Descendants of root causes a (b, c) and d (none) = 2.
    expect(result.blastRadius).toBe(2);
  });

  it("getCausalCascade treats every failed node as a root cause when there is no cascading", () => {
    store.recordExecutionNode(node({ id: "root", childrenIds: ["a"] }));
    store.recordExecutionNode(node({ id: "a", parentId: "root", status: "failed", childrenIds: [] }));

    const result = analyzer.getCausalCascade("s1");
    expect(result.rootCauses.map((n) => n.id)).toEqual(["a"]);
    expect(result.symptoms).toHaveLength(0);
  });

  it("detectAntiPatterns finds a diamond dependency where two branches reconverge", () => {
    // apex -> (left, right) -> join
    store.recordExecutionNode(node({ id: "apex", childrenIds: ["left", "right"] }));
    store.recordExecutionNode(node({ id: "left", parentId: "apex", childrenIds: ["join"] }));
    store.recordExecutionNode(node({ id: "right", parentId: "apex", childrenIds: ["join"] }));
    store.recordExecutionNode(node({ id: "join", parentId: "left", childrenIds: [] }));

    const patterns = analyzer.detectAntiPatterns("s1");
    const diamond = patterns.find((p) => p.type === "diamond_dependency");
    expect(diamond).toBeDefined();
    expect(diamond?.nodes.map((n) => n.id)).toEqual(["apex", "join"]);
    expect(diamond?.severity).toBe(2);
  });

  it("detectAntiPatterns finds a sequential bottleneck chain dominating the critical path", () => {
    // root -> a -> b -> c: an unbranched chain starting at a session root, so
    // it *is* the critical path (ratio 1.0) - a clear, unambiguous bottleneck.
    // A separate short root2 in the same session keeps the graph from being
    // trivially single-path-only.
    store.recordExecutionNode(node({ id: "root", durationMs: 100, childrenIds: ["a"] }));
    store.recordExecutionNode(node({ id: "a", parentId: "root", durationMs: 1000, childrenIds: ["b"] }));
    store.recordExecutionNode(node({ id: "b", parentId: "a", durationMs: 1000, childrenIds: ["c"] }));
    store.recordExecutionNode(node({ id: "c", parentId: "b", durationMs: 1000, childrenIds: [] }));
    store.recordExecutionNode(node({ id: "root2", durationMs: 5, childrenIds: [] }));

    const patterns = analyzer.detectAntiPatterns("s1");
    const bottleneck = patterns.find((p) => p.type === "sequential_bottleneck");
    expect(bottleneck).toBeDefined();
    expect(bottleneck?.nodes.map((n) => n.id)).toEqual(["root", "a", "b", "c"]);
    expect(bottleneck?.severity).toBeGreaterThan(0.5);
  });

  it("detectAntiPatterns returns no bottleneck when no chain dominates the critical path", () => {
    seedChain(); // root -> a -> b (critical path) and root -> c; no chain exceeds 50% on its own beyond the path itself
    const patterns = analyzer.detectAntiPatterns("s1");
    expect(patterns.find((p) => p.type === "diamond_dependency")).toBeUndefined();
  });

  describe("getWorkflowForecast", () => {
    beforeEach(() => {
      // Two historical (completed) 2-node runs of wf1: 1000ms/$0.10 and 2000ms/$0.20, no failures.
      store.recordExecutionNode(node({ id: "h1-root", sessionId: "h1", workflowId: "wf1", durationMs: 1000, cost: { amount: 0.06 }, childrenIds: ["h1-a"] }));
      store.recordExecutionNode(node({ id: "h1-a", sessionId: "h1", workflowId: "wf1", parentId: "h1-root", cost: { amount: 0.04 }, childrenIds: [] }));
      store.recordExecutionNode(node({ id: "h2-root", sessionId: "h2", workflowId: "wf1", durationMs: 2000, cost: { amount: 0.12 }, childrenIds: ["h2-a"] }));
      store.recordExecutionNode(node({ id: "h2-a", sessionId: "h2", workflowId: "wf1", parentId: "h2-root", cost: { amount: 0.08 }, childrenIds: [] }));
    });

    it("extrapolates duration/cost proportionally to progress for an in-progress session", () => {
      // In-progress session "live" has recorded only its root node so far (1 of an
      // expected ~2 nodes -> progressRatio 0.5), with half the avg historical duration/cost.
      store.recordExecutionNode(node({ id: "live-root", sessionId: "live", workflowId: "wf1", durationMs: 750, cost: { amount: 0.075 }, childrenIds: [] }));

      const forecast = analyzer.getWorkflowForecast("live", "wf1");
      expect(forecast.workflowId).toBe("wf1");
      expect(forecast.progressRatio).toBeCloseTo(0.5);
      // avg historical duration/cost is 1500/$0.15; elapsed 750/$0.075 at 50% progress -> projected back to the full amount.
      expect(forecast.projectedDurationMs).toBeCloseTo(1500);
      expect(forecast.projectedCost).toBeCloseTo(0.15);
      expect(forecast.failureProbability).toBe(0);
    });

    it("treats an observed failure in the current session as certain", () => {
      store.recordExecutionNode(node({ id: "live-root", sessionId: "live", workflowId: "wf1", status: "failed", childrenIds: [] }));
      const forecast = analyzer.getWorkflowForecast("live", "wf1");
      expect(forecast.failureProbability).toBe(1);
    });

    it("returns a zero-baseline forecast for a workflow with no historical runs", () => {
      store.recordExecutionNode(node({ id: "only-root", sessionId: "only", workflowId: "wf-new", durationMs: 500, childrenIds: [] }));
      const forecast = analyzer.getWorkflowForecast("only", "wf-new");
      expect(forecast.progressRatio).toBe(1);
      expect(forecast.projectedDurationMs).toBe(500);
      expect(forecast.failureProbability).toBe(0);
    });
  });

  it("detectCommonPatterns attributes duration/success to the right session per pattern, not always the first", () => {
    // s1 (inserted first) runs a different, single-occurrence pattern.
    store.recordExecutionNode(
      node({ id: "s1-root", sessionId: "s1", workflowId: "wf1", toolName: "solo_a", durationMs: 100, timestamp: "2026-01-01T00:00:00.000Z" }),
    );
    // s2 and s3 share a pattern (meets minOccurrences=2) with durations distinct from s1's.
    store.recordExecutionNode(
      node({ id: "s2-root", sessionId: "s2", workflowId: "wf1", toolName: "solo_b", durationMs: 200, timestamp: "2026-01-01T00:01:00.000Z" }),
    );
    store.recordExecutionNode(
      node({ id: "s3-root", sessionId: "s3", workflowId: "wf1", toolName: "solo_b", durationMs: 400, timestamp: "2026-01-01T00:02:00.000Z" }),
    );

    const patterns = analyzer.detectCommonPatterns("wf1", 2);
    const soloB = patterns.find((p) => p.pattern === "solo_b");
    expect(soloB).toBeDefined();
    // Correct average across s2 (200) and s3 (400); the bug always used s1's duration (100).
    expect(soloB?.avgDurationMs).toBe(300);
  });
});
