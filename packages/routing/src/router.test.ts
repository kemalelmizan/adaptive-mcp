import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryStore } from "@adaptivemcp/memory";
import { GraphAnalyzer } from "@adaptivemcp/graph-analysis";
import { Router } from "./router.js";
import type { ToolExecutionEvent, ExecutionNode } from "@adaptivemcp/spec";

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

function record(store: MemoryStore, toolName: string, opts: { calls: number; failRate: number; durationMs: number; cost: number }): void {
  store.ensureTool(toolName, "srv");
  for (let i = 0; i < opts.calls; i++) {
    const event: ToolExecutionEvent = {
      id: `${toolName}-${i}`,
      toolName,
      serverName: "srv",
      timestamp: new Date().toISOString(),
      durationMs: opts.durationMs,
      status: i < opts.calls * opts.failRate ? "failed" : "completed",
      cost: { amount: opts.cost, currency: "USD" },
    };
    store.recordExecution(event);
  }
}

describe("@adaptivemcp/routing", () => {
  let store: MemoryStore;
  let router: Router;

  beforeEach(() => {
    store = new MemoryStore({ path: ":memory:" });
  });

  afterEach(() => store.close());

  it("does not route below minInvocations", () => {
    record(store, "deploy_service", { calls: 5, failRate: 0, durationMs: 1000, cost: 0.01 });
    router = new Router({ memory: store });
    router.routeTool("deploy_service");
    expect(store.getTool("deploy_service")?.recommendations).toHaveLength(0);
  });

  it("selects cheapest model for fast tools", () => {
    record(store, "search_customer", { calls: 40, failRate: 0, durationMs: 50, cost: 0.0003 });
    router = new Router({ memory: store });
    router.routeTool("search_customer");
    const recs = store.getTool("search_customer")?.recommendations ?? [];
    const model = recs.find((r) => r.type === "model");
    expect(model?.payload).toEqual({ model: "gpt-5-mini" });
  });

  it("may upgrade model for slow tools", () => {
    record(store, "deploy_service", { calls: 40, failRate: 0, durationMs: 900, cost: 0.0021 });
    router = new Router({ memory: store });
    router.routeTool("deploy_service");
    const model = store.getTool("deploy_service")?.recommendations.find((r) => r.type === "model");
    expect(model?.payload).toEqual({ model: "gpt-5" });
  });

  it("emits a budget warning when approaching the limit", () => {
    record(store, "deploy_service", { calls: 40, failRate: 0, durationMs: 900, cost: 0.05 });
    router = new Router({ memory: store, budget: { perToolLimit: 2.2 } });
    router.routeTool("deploy_service");
    const budget = store.getTool("deploy_service")?.recommendations.find((r) => r.type === "routing");
    expect(budget?.payload).toMatchObject({ status: "approaching_budget" });
  });

  it("emits an over_budget warning when the limit is exceeded", () => {
    record(store, "deploy_service", { calls: 40, failRate: 0, durationMs: 900, cost: 0.05 });
    router = new Router({ memory: store, budget: { perToolLimit: 1 } });
    router.routeTool("deploy_service");
    const budget = store.getTool("deploy_service")?.recommendations.find((r) => r.type === "routing");
    expect(budget?.payload).toMatchObject({ status: "over_budget" });
  });

  it("routeAll processes every tool", () => {
    record(store, "a", { calls: 40, failRate: 0, durationMs: 50, cost: 0.0003 });
    record(store, "b", { calls: 40, failRate: 0, durationMs: 900, cost: 0.0021 });
    router = new Router({ memory: store });
    router.routeAll();
    expect(store.getTool("a")?.recommendations.some((r) => r.type === "model")).toBe(true);
    expect(store.getTool("b")?.recommendations.some((r) => r.type === "model")).toBe(true);
  });

  describe("routeByPosition (Phase 10.5)", () => {
    it("gives the leaf the cheapest model and the critical-path node the lowest-latency model", () => {
      // root -> branch (critical path, slow) ; root -> leaf (short, no children)
      store.recordExecutionNode(node({ id: "root", toolName: "root_tool", durationMs: 10, childrenIds: ["branch", "leaf"] }));
      store.recordExecutionNode(node({ id: "branch", toolName: "branch_tool", parentId: "root", durationMs: 5000, childrenIds: [] }));
      store.recordExecutionNode(node({ id: "leaf", toolName: "leaf_tool", parentId: "root", durationMs: 10, childrenIds: [] }));

      router = new Router({ memory: store });
      const analyzer = new GraphAnalyzer(store);
      const routings = router.routeByPosition("s1", analyzer);

      const branchRouting = routings.find((r) => r.nodeId === "branch");
      const leafRouting = routings.find((r) => r.nodeId === "leaf");
      expect(branchRouting?.position).toBe("critical_path");
      expect(branchRouting?.recommendedModel.id).toBe("gpt-5"); // lowest latencyWeight (0.6) among defaults
      expect(leafRouting?.position).toBe("leaf");
      expect(leafRouting?.recommendedModel.id).toBe("gpt-5-mini"); // lowest costWeight (1) among defaults
    });

    it("returns an empty array for a session with no recorded nodes", () => {
      router = new Router({ memory: store });
      const analyzer = new GraphAnalyzer(store);
      expect(router.routeByPosition("nope", analyzer)).toEqual([]);
    });
  });
});
