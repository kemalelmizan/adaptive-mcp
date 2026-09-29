import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryStore } from "@adaptivemcp/memory";
import { Evaluator } from "./evaluator.js";
import type { ToolExecutionEvent, ExecutionNode } from "@adaptivemcp/spec";

function node(overrides: Partial<ExecutionNode> & { id: string; sessionId: string; workflowId: string }): ExecutionNode {
  return {
    toolName: "deploy",
    childrenIds: [],
    timestamp: new Date().toISOString(),
    status: "completed",
    ...overrides,
  };
}

function record(store: MemoryStore, toolName: string, failRate: number, calls: number): void {
  store.ensureTool(toolName, "srv");
  for (let i = 0; i < calls; i++) {
    const failed = i < calls * failRate;
    const event: ToolExecutionEvent = {
      id: `${toolName}-${i}`,
      toolName,
      serverName: "srv",
      timestamp: new Date().toISOString(),
      durationMs: 1000,
      status: failed ? "failed" : "completed",
      cost: { amount: 0.01, currency: "USD" },
    };
    store.recordExecution(event);
  }
}

describe("@adaptivemcp/evaluation", () => {
  let store: MemoryStore;
  let evaluator: Evaluator;

  beforeEach(() => {
    store = new MemoryStore({ path: ":memory:" });
    evaluator = new Evaluator({ memory: store });
  });

  afterEach(() => store.close());

  it("emits no insights below minInvocations", () => {
    record(store, "deploy_service", 0.5, 5);
    expect(evaluator.evaluateAll()).toHaveLength(0);
  });

  it("emits observed_failure_rate when failure rate crosses threshold", () => {
    record(store, "deploy_service", 0.3, 40);
    const insights = evaluator.evaluateAll();
    const fr = insights.find((i) => i.key === "observed_failure_rate");
    expect(fr).toBeDefined();
    expect(fr?.value).toBeCloseTo(0.3, 1);
    expect(fr?.source).toBe("evaluation");
  });

  it("emits avg_duration_ms insight from telemetry", () => {
    record(store, "deploy_service", 0, 40);
    const insights = evaluator.evaluateAll();
    const dur = insights.find((i) => i.key === "avg_duration_ms");
    expect(dur).toBeDefined();
    expect(dur?.value).toBe(1000);
    expect(dur?.source).toBe("telemetry");
  });

  it("confidence saturates near 0.95 for large samples", () => {
    record(store, "deploy_service", 0, 200);
    const insights = evaluator.evaluateAll();
    expect(insights[0].confidence).toBeCloseTo(0.95, 2);
  });

  it("persists insights into the store", () => {
    record(store, "deploy_service", 0.3, 40);
    evaluator.evaluateAll();
    const insights = store.getTool("deploy_service")?.insights ?? [];
    expect(insights.some((i) => i.key === "observed_failure_rate")).toBe(true);
  });

  describe("evaluateAllWorkflows (multi-session learning, Phase 10.4)", () => {
    it("returns [] when graph tracking is not enabled", () => {
      const ev = new Evaluator({ memory: { allTools: () => [], getTool: () => undefined } as never });
      expect(ev.evaluateAllWorkflows()).toEqual([]);
    });

    it("evaluates every session of every workflow and learns the common cross-session pattern", () => {
      // Three sessions of the same workflow, all running the identical single-tool
      // sequence, so detectCommonPatterns' default minOccurrences (3) is met.
      for (const [sessionId, durationMs] of [["s1", 100], ["s2", 200], ["s3", 300]] as const) {
        store.recordExecutionNode(node({ id: `${sessionId}-root`, sessionId, workflowId: "wf1", durationMs }));
      }

      const insights = evaluator.evaluateAllWorkflows();

      // Per-session insights (evaluateWorkflow ran for each of the 3 sessions).
      const durationInsights = insights.filter((i) => i.key === "workflow_duration_ms");
      expect(durationInsights).toHaveLength(3);

      // Cross-session pattern insight, persisted once per workflow.
      const patternInsight = insights.find((i) => i.key === "workflow_common_pattern");
      expect(patternInsight).toBeDefined();
      expect((patternInsight?.value as { pattern: string }).pattern).toBe("deploy");

      const stored = store.getTool("wf1")?.insights ?? [];
      expect(stored.some((i) => i.key === "workflow_common_pattern")).toBe(true);
    });

    it("does not learn a cross-session pattern below the occurrence threshold", () => {
      // Only two sessions - below detectCommonPatterns' default minOccurrences of 3.
      store.recordExecutionNode(node({ id: "s1-root", sessionId: "s1", workflowId: "wf1", durationMs: 100 }));
      store.recordExecutionNode(node({ id: "s2-root", sessionId: "s2", workflowId: "wf1", durationMs: 200 }));

      const insights = evaluator.evaluateAllWorkflows();
      expect(insights.some((i) => i.key === "workflow_common_pattern")).toBe(false);
    });
  });

  describe("repetition detection (ROADMAP 6d)", () => {
    it("emits repetition_detected for a repeated tool sequence, attributed to the workflow", () => {
      // A -> B -> A -> B -> A -> B: the 2-tool pattern "tool_a -> tool_b"
      // occurs 3 times, meeting the count >= 3 threshold.
      const sequence = ["tool_a", "tool_b", "tool_a", "tool_b", "tool_a", "tool_b"];
      const ids = sequence.map((_, i) => `s1-${i}`);
      sequence.forEach((toolName, i) => {
        store.recordExecutionNode(
          node({
            id: ids[i]!,
            sessionId: "s1",
            workflowId: "wf-rep",
            toolName,
            parentId: i === 0 ? undefined : ids[i - 1],
            childrenIds: i === sequence.length - 1 ? [] : [ids[i + 1]!],
          }),
        );
      });

      const insights = evaluator.evaluateWorkflow("s1");
      const rep = insights.find((i) => i.key === "repetition_detected");
      expect(rep).toBeDefined();
      expect(rep?.toolName).toBe("wf-rep");
      expect((rep?.value as { pattern: string }).pattern).toBe("tool_a -> tool_b");

      const stored = store.getTool("wf-rep")?.insights ?? [];
      expect(stored.some((i) => i.key === "repetition_detected")).toBe(true);
    });

    it("does not emit repetition_detected for a short or non-repeating sequence", () => {
      for (const [i, toolName] of ["tool_a", "tool_b", "tool_c"].entries()) {
        store.recordExecutionNode(
          node({ id: `s2-${i}`, sessionId: "s2", workflowId: "wf-norep", toolName }),
        );
      }
      const insights = evaluator.evaluateWorkflow("s2");
      expect(insights.some((i) => i.key === "repetition_detected")).toBe(false);
    });
  });

  describe("session co-occurrence", () => {
    it("emits tool_cooccurrence for tools that cluster in the same session", () => {
      for (const sessionId of ["a", "b", "c"]) {
        store.recordExecutionNode(
          node({ id: `${sessionId}-1`, sessionId, workflowId: "wf", toolName: "search" }),
        );
        store.recordExecutionNode(
          node({ id: `${sessionId}-2`, sessionId, workflowId: "wf", toolName: "summarize" }),
        );
      }
      store.recordExecutionNode(node({ id: "solo-1", sessionId: "solo", workflowId: "wf", toolName: "lonely" }));

      const insights = evaluator.evaluateCooccurrence();
      const search = insights.find((i) => i.toolName === "search");
      expect(search?.key).toBe("tool_cooccurrence");
      expect(search?.value).toEqual([{ tool: "summarize", sessions: 3, support: 1 }]);
      // A tool seen in only one session is below minSessions.
      expect(insights.some((i) => i.toolName === "lonely")).toBe(false);
    });

    it("is included in evaluateAllWorkflows", () => {
      for (const sessionId of ["a", "b"]) {
        store.recordExecutionNode(
          node({ id: `${sessionId}-1`, sessionId, workflowId: "wf", toolName: "x" }),
        );
        store.recordExecutionNode(
          node({ id: `${sessionId}-2`, sessionId, workflowId: "wf", toolName: "y" }),
        );
      }
      const insights = evaluator.evaluateAllWorkflows();
      expect(insights.some((i) => i.key === "tool_cooccurrence")).toBe(true);
    });
  });
});
