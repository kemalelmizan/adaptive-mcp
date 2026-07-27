import { describe, it, expect } from "vitest";
import { buildExecutionGraph } from "./execution-graph.js";
import type { ExecutionNode } from "./types.js";

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

describe("@adaptivemcp/spec buildExecutionGraph", () => {
  it("maps nodes and edges into the canonical wire shape", () => {
    const nodes = [
      node({ id: "root", workflowId: "wf1", childrenIds: ["a"], durationMs: 100, model: "gpt-5" }),
      node({ id: "a", parentId: "root", cost: { amount: 0.01 } }),
    ];

    const doc = buildExecutionGraph(nodes, { version: "1.0", sessionId: "s1" });

    expect(doc.version).toBe("1.0");
    expect(doc.session_id).toBe("s1");
    expect(doc.workflow_id).toBe("wf1");
    expect(doc.etag).toBe(""); // computed by the caller, not this pure builder
    expect(doc.nodes).toHaveLength(2);
    expect(doc.nodes[0]).toMatchObject({ id: "root", tool: "tool", duration_ms: 100, model: "gpt-5" });
    expect(doc.nodes[1]).toMatchObject({ id: "a", parent: "root", cost: 0.01 });
    expect(doc.edges).toEqual([{ from: "root", to: "a" }]);
    expect(doc.next_cursor).toBeUndefined();
  });

  it("falls back to 'unknown' workflow_id when no node carries one", () => {
    const doc = buildExecutionGraph([node({ id: "root" })], { version: "1.0", sessionId: "s1" });
    expect(doc.workflow_id).toBe("unknown");
  });

  it("carries an explicit nextCursor through to next_cursor", () => {
    const doc = buildExecutionGraph([node({ id: "root" })], { version: "1.0", sessionId: "s1", nextCursor: "root" });
    expect(doc.next_cursor).toBe("root");
  });

  it("surfaces a node's traceparent metadata as trace_parent", () => {
    const doc = buildExecutionGraph(
      [node({ id: "root", metadata: { traceparent: "00-abc-def-01" } })],
      { version: "1.0", sessionId: "s1" },
    );
    expect(doc.nodes[0]?.trace_parent).toBe("00-abc-def-01");
  });

  it("returns an empty graph for no nodes", () => {
    const doc = buildExecutionGraph([], { version: "1.0", sessionId: "s1" });
    expect(doc.nodes).toEqual([]);
    expect(doc.edges).toEqual([]);
    expect(doc.workflow_id).toBe("unknown");
  });
});
