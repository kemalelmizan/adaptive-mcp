import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryStore } from "@adaptivemcp/memory";
import { DecodingAdvisor } from "./decoding-advisor.js";
import type { ToolExecutionEvent, DecodingProfile } from "@adaptivemcp/spec";

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

describe("@adaptivemcp/routing DecodingAdvisor", () => {
  let store: MemoryStore;
  let advisor: DecodingAdvisor;

  beforeEach(() => {
    store = new MemoryStore({ path: ":memory:" });
  });

  afterEach(() => store.close());

  it("does not advise below minInvocations", () => {
    record(store, "deploy_service", { calls: 5, failRate: 1 });
    advisor = new DecodingAdvisor({ memory: store });
    advisor.advise("deploy_service");
    expect(store.getTool("deploy_service")?.recommendations).toHaveLength(0);
  });

  it("defaults to the 'balanced' baseline when no intentProfile or failure signal is given", () => {
    record(store, "search_customer", { calls: 40, failRate: 0 });
    advisor = new DecodingAdvisor({ memory: store });
    advisor.advise("search_customer");
    const rec = store.getTool("search_customer")?.recommendations.find((r) => r.type === "decoding");
    expect(rec?.payload).toEqual({ id: "balanced" } satisfies DecodingProfile);
  });

  it("keeps a caller-supplied intentProfile as the baseline when failure rate is low", () => {
    record(store, "search_customer", { calls: 40, failRate: 0 });
    advisor = new DecodingAdvisor({ memory: store });
    advisor.advise("search_customer", "srv", "creative");
    const rec = store.getTool("search_customer")?.recommendations.find((r) => r.type === "decoding");
    expect(rec?.payload).toEqual({ id: "creative" } satisfies DecodingProfile);
  });

  it("overrides any baseline toward deterministic on a high failure rate", () => {
    record(store, "very_flaky_tool", { calls: 40, failRate: 0.25 });
    advisor = new DecodingAdvisor({ memory: store });
    advisor.advise("very_flaky_tool", "srv", "creative");
    const rec = store.getTool("very_flaky_tool")?.recommendations.find((r) => r.type === "decoding");
    expect(rec?.payload).toEqual({ id: "deterministic" } satisfies DecodingProfile);
    expect(rec?.rationale).toContain("overrides the baseline toward deterministic");
  });

  it("tempers a creative baseline toward balanced on a moderate failure rate", () => {
    record(store, "flaky_tool", { calls: 40, failRate: 0.12 });
    advisor = new DecodingAdvisor({ memory: store });
    advisor.advise("flaky_tool", "srv", "creative");
    const rec = store.getTool("flaky_tool")?.recommendations.find((r) => r.type === "decoding");
    expect(rec?.payload).toEqual({ id: "balanced" } satisfies DecodingProfile);
  });

  it("does not temper a balanced baseline on a moderate failure rate (only creative gets tempered)", () => {
    record(store, "flaky_tool", { calls: 40, failRate: 0.12 });
    advisor = new DecodingAdvisor({ memory: store });
    advisor.advise("flaky_tool", "srv", "balanced");
    const rec = store.getTool("flaky_tool")?.recommendations.find((r) => r.type === "decoding");
    expect(rec?.payload).toEqual({ id: "balanced" } satisfies DecodingProfile);
  });

  it("re-running advise() clears a stale recommendation instead of duplicating it", () => {
    record(store, "flaky_tool", { calls: 40, failRate: 0.25 });
    advisor = new DecodingAdvisor({ memory: store });
    advisor.advise("flaky_tool");
    advisor.advise("flaky_tool");
    const recs = store.getTool("flaky_tool")?.recommendations.filter((r) => r.type === "decoding") ?? [];
    expect(recs).toHaveLength(1);
  });

  it("adviseAll processes every tool independently with the same intentProfile", () => {
    record(store, "a", { calls: 40, failRate: 0 });
    record(store, "b", { calls: 40, failRate: 0.25 });
    advisor = new DecodingAdvisor({ memory: store });
    advisor.adviseAll("creative");
    expect(store.getTool("a")?.recommendations.find((r) => r.type === "decoding")?.payload).toEqual({
      id: "creative",
    });
    expect(store.getTool("b")?.recommendations.find((r) => r.type === "decoding")?.payload).toEqual({
      id: "deterministic",
    });
  });

  it("respects a custom defaultProfile", () => {
    record(store, "tool", { calls: 40, failRate: 0 });
    advisor = new DecodingAdvisor({ memory: store, defaultProfile: "deterministic" });
    advisor.advise("tool");
    const rec = store.getTool("tool")?.recommendations.find((r) => r.type === "decoding");
    expect(rec?.payload).toEqual({ id: "deterministic" });
  });
});
