import { describe, it, expect } from "vitest";
import { AdaptiveRuntime } from "./index.js";

describe("@adaptivemcp/runtime AdaptiveRuntime graph tracking (Phase 11.2)", () => {
  it("throws from startWorkflow when enableGraph is not set", () => {
    const runtime = new AdaptiveRuntime();
    expect(() => runtime.startWorkflow({ toolName: "deploy" })).toThrow();
    runtime.close();
  });

  it("records a root node and its child when enableGraph is true", () => {
    const runtime = new AdaptiveRuntime({ enableGraph: true });

    const { nodeId: rootId, sessionId } = runtime.startWorkflow({ toolName: "deploy_release", workflowId: "wf1" });
    const { nodeId: childId } = runtime.startChild({ toolName: "kubernetes.apply" }, rootId);
    runtime.completeNode(childId, { durationMs: 500 });
    runtime.completeNode(rootId, { durationMs: 1000 });

    const graphMemory = runtime.memory as unknown as {
      getNodesBySession(sessionId: string): Array<{ id: string; status: string; parentId?: string }>;
    };
    const nodes = graphMemory.getNodesBySession(sessionId);
    expect(nodes).toHaveLength(2);
    expect(nodes.find((n) => n.id === rootId)?.status).toBe("completed");
    expect(nodes.find((n) => n.id === childId)?.parentId).toBe(rootId);

    runtime.close();
  });

  it("does not wire graph tracking for a non-MemoryStore backing store even with enableGraph: true", () => {
    const fakeStore = {
      close: () => {},
      ensureTool: () => ({ toolName: "x", annotation: {}, insights: [], recommendations: [], stats: { invocations: 0, failures: 0, failureRate: 0, avgDurationMs: null, totalCost: 0, lastObservedAt: null }, updatedAt: "" }),
      getTool: () => undefined,
      allTools: () => [],
      setAnnotation: (a: unknown) => a,
      addInsight: (i: unknown) => i,
      addRecommendation: (r: unknown) => r,
      clearRecommendations: () => ({}),
      recordExecution: () => ({}),
    };
    const runtime = new AdaptiveRuntime({ store: fakeStore as never, enableGraph: true });
    expect(() => runtime.startWorkflow({ toolName: "deploy" })).toThrow();
    runtime.close();
  });
});
