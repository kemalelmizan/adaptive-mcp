import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryStore } from "@adaptivemcp/memory";
import { Orchestrator } from "./retry.js";
import type { ToolExecutionEvent } from "@adaptivemcp/spec";

function record(store: MemoryStore, toolName: string, failRate: number, calls: number): void {
  store.ensureTool(toolName, "srv");
  for (let i = 0; i < calls; i++) {
    const event: ToolExecutionEvent = {
      id: `${toolName}-${i}`,
      toolName,
      serverName: "srv",
      timestamp: new Date().toISOString(),
      durationMs: 1000,
      status: i < calls * failRate ? "failed" : "completed",
      cost: { amount: 0.01, currency: "USD" },
    };
    store.recordExecution(event);
  }
}

describe("@adaptivemcp/orchestration", () => {
  let store: MemoryStore;
  let orchestrator: Orchestrator;

  beforeEach(() => {
    store = new MemoryStore({ path: ":memory:" });
  });

  afterEach(() => store.close());

  it("writes no workflow recommendation below minInvocations", () => {
    record(store, "deploy_service", 0.5, 5);
    orchestrator = new Orchestrator({ memory: store });
    orchestrator.planTool("deploy_service");
    expect(store.getTool("deploy_service")?.recommendations).toHaveLength(0);
  });

  it("suggests a retry policy for flaky tools", () => {
    record(store, "deploy_service", 0.3, 40);
    orchestrator = new Orchestrator({ memory: store });
    orchestrator.planTool("deploy_service");
    const rec = store.getTool("deploy_service")?.recommendations.find((r) => r.type === "workflow");
    expect(rec).toBeDefined();
    expect((rec?.payload as { retry: { maxAttempts: number } }).retry.maxAttempts).toBeGreaterThan(3);
  });

  it("caps retry attempts at 6", () => {
    record(store, "deploy_service", 1, 40);
    orchestrator = new Orchestrator({ memory: store });
    orchestrator.planTool("deploy_service");
    const rec = store.getTool("deploy_service")?.recommendations.find((r) => r.type === "workflow");
    const retry = (rec?.payload as { retry: { maxAttempts: number } }).retry;
    expect(retry.maxAttempts).toBe(6);
  });

  it("writes no workflow recommendation for healthy tools", () => {
    record(store, "search_customer", 0, 40);
    orchestrator = new Orchestrator({ memory: store });
    orchestrator.planTool("search_customer");
    expect(store.getTool("search_customer")?.recommendations).toHaveLength(0);
  });

  it("planAll processes every tool", () => {
    record(store, "a", 0.3, 40);
    record(store, "b", 0, 40);
    orchestrator = new Orchestrator({ memory: store });
    orchestrator.planAll();
    expect(store.getTool("a")?.recommendations.some((r) => r.type === "workflow")).toBe(true);
    expect(store.getTool("b")?.recommendations.some((r) => r.type === "workflow")).toBe(false);
  });
});
