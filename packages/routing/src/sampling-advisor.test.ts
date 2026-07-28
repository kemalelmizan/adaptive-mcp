import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryStore } from "@adaptivemcp/memory";
import { SamplingAdvisor } from "./sampling-advisor.js";
import type { ToolExecutionEvent } from "@adaptivemcp/spec";

function record(store: MemoryStore, toolName: string, opts: { calls: number; failRate: number }): void {
  store.ensureTool(toolName, "srv");
  for (let i = 0; i < opts.calls; i++) {
    const event: ToolExecutionEvent = {
      id: `${toolName}-${i}`,
      toolName,
      serverName: "srv",
      timestamp: new Date().toISOString(),
      durationMs: 100,
      status: i < opts.calls * opts.failRate ? "failed" : "completed",
    };
    store.recordExecution(event);
  }
}

describe("@adaptivemcp/routing SamplingAdvisor", () => {
  let store: MemoryStore;
  let advisor: SamplingAdvisor;

  beforeEach(() => {
    store = new MemoryStore({ path: ":memory:" });
  });

  afterEach(() => store.close());

  it("does not advise below minInvocations", () => {
    record(store, "deploy_service", { calls: 5, failRate: 1 });
    advisor = new SamplingAdvisor({ memory: store });
    advisor.advise("deploy_service");
    expect(store.getTool("deploy_service")?.recommendations).toHaveLength(0);
  });

  it("does not advise when failure rate is low", () => {
    record(store, "search_customer", { calls: 40, failRate: 0 });
    advisor = new SamplingAdvisor({ memory: store });
    advisor.advise("search_customer");
    expect(store.getTool("search_customer")?.recommendations.some((r) => r.type === "sampling")).toBe(false);
  });

  it("moderately lowers temperature/top_p for a moderate failure rate", () => {
    record(store, "flaky_tool", { calls: 40, failRate: 0.12 });
    advisor = new SamplingAdvisor({ memory: store });
    advisor.advise("flaky_tool");
    const rec = store.getTool("flaky_tool")?.recommendations.find((r) => r.type === "sampling");
    expect(rec?.payload).toEqual({ temperature: 0.4, topP: 0.7 });
  });

  it("sharply lowers temperature/top_p for a high failure rate", () => {
    record(store, "very_flaky_tool", { calls: 40, failRate: 0.25 });
    advisor = new SamplingAdvisor({ memory: store });
    advisor.advise("very_flaky_tool");
    const rec = store.getTool("very_flaky_tool")?.recommendations.find((r) => r.type === "sampling");
    expect(rec?.payload).toEqual({ temperature: 0.2, topP: 0.5 });
  });

  it("re-running advise() clears a stale recommendation instead of duplicating it", () => {
    record(store, "flaky_tool", { calls: 40, failRate: 0.25 });
    advisor = new SamplingAdvisor({ memory: store });
    advisor.advise("flaky_tool");
    advisor.advise("flaky_tool");
    const recs = store.getTool("flaky_tool")?.recommendations.filter((r) => r.type === "sampling") ?? [];
    expect(recs).toHaveLength(1);
  });

  it("adviseAll processes every tool independently", () => {
    record(store, "a", { calls: 40, failRate: 0 });
    record(store, "b", { calls: 40, failRate: 0.25 });
    advisor = new SamplingAdvisor({ memory: store });
    advisor.adviseAll();
    expect(store.getTool("a")?.recommendations.some((r) => r.type === "sampling")).toBe(false);
    expect(store.getTool("b")?.recommendations.some((r) => r.type === "sampling")).toBe(true);
  });

  it("respects custom thresholds", () => {
    record(store, "tool", { calls: 40, failRate: 0.06 });
    advisor = new SamplingAdvisor({ memory: store, thresholds: { moderateFailureRate: 0.05, highFailureRate: 0.5 } });
    advisor.advise("tool");
    const rec = store.getTool("tool")?.recommendations.find((r) => r.type === "sampling");
    expect(rec?.payload).toEqual({ temperature: 0.4, topP: 0.7 });
  });
});
