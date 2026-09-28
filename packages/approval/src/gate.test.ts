import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryStore } from "@adaptivemcp/memory";
import { ApprovalGate, isFlaky } from "./gate.js";
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

describe("@adaptivemcp/approval", () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore({ path: ":memory:" });
  });

  afterEach(() => store.close());

  it("allows a healthy, low-risk tool", () => {
    record(store, "search_customer", 0, 40);
    const gate = new ApprovalGate({ memory: store });
    expect(gate.gate("search_customer")).toBe("allow");
  });

  it("requires confirmation for high-risk annotated tools", () => {
    store.ensureTool("deploy_service", "srv");
    store.setAnnotation({ toolName: "deploy_service", risk: "high" });
    const gate = new ApprovalGate({ memory: store });
    expect(gate.gate("deploy_service")).toBe("require_confirmation");
  });

  it("requires confirmation for flaky tools past minInvocations", () => {
    record(store, "deploy_service", 0.3, 40);
    const gate = new ApprovalGate({ memory: store });
    expect(gate.gate("deploy_service")).toBe("require_confirmation");
  });

  it("denies explicitly denied tools", () => {
    record(store, "deploy_service", 0, 40);
    const gate = new ApprovalGate({ memory: store, policy: { denyTools: ["deploy_service"] } });
    expect(gate.gate("deploy_service")).toBe("deny");
  });

  it("denies tools matching a suffix glob in denyTools", () => {
    record(store, "flaky-server.unstable_tool", 0, 40);
    const gate = new ApprovalGate({ memory: store, policy: { denyTools: ["flaky-server.*"] } });
    expect(gate.gate("flaky-server.unstable_tool", "srv")).toBe("deny");
  });

  it("denies tools matching a leading-wildcard glob in denyTools", () => {
    record(store, "dangerous.delete_all", 0, 40);
    const gate = new ApprovalGate({ memory: store, policy: { denyTools: ["*.delete_*"] } });
    expect(gate.gate("dangerous.delete_all", "srv")).toBe("deny");
  });

  it("does not deny a tool outside the glob", () => {
    record(store, "github.merge_pr", 0, 40);
    const gate = new ApprovalGate({ memory: store, policy: { denyTools: ["dangerous.*"] } });
    expect(gate.gate("github.merge_pr", "srv")).toBe("allow");
  });

  it("writes an approval recommendation with the decision payload", () => {
    store.ensureTool("deploy_service", "srv");
    store.setAnnotation({ toolName: "deploy_service", risk: "high" });
    const gate = new ApprovalGate({ memory: store });
    gate.gate("deploy_service");
    const rec = store.getTool("deploy_service")?.recommendations.find((r) => r.type === "approval");
    expect(rec?.payload).toEqual({ decision: "require_confirmation" });
  });

  it("isFlaky reflects the threshold", () => {
    record(store, "deploy_service", 0.3, 40);
    expect(isFlaky(store.getTool("deploy_service"), 0.2)).toBe(true);
    expect(isFlaky(store.getTool("deploy_service"), 0.5)).toBe(false);
  });
});
