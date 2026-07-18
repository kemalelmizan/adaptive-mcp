import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryStore } from "./store.js";
import type { ToolExecutionEvent } from "@adaptivemcp/spec";

describe("@adaptivemcp/memory", () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore({ path: ":memory:" });
  });

  afterEach(() => {
    store.close();
  });

  it("ensureTool seeds an empty record and is idempotent", () => {
    const a = store.ensureTool("deploy_service", "srv");
    const b = store.ensureTool("deploy_service", "srv");
    expect(a.toolName).toBe("deploy_service");
    expect(a.serverName).toBe("srv");
    expect(a.stats.invocations).toBe(0);
    expect(b).toEqual(a);
    expect(store.allTools()).toHaveLength(1);
  });

  it("getTool returns undefined for unknown tools", () => {
    expect(store.getTool("nope")).toBeUndefined();
  });

  it("setAnnotation merges into the existing annotation", () => {
    store.ensureTool("deploy_service");
    const rec = store.setAnnotation({
      toolName: "deploy_service",
      risk: "high",
      owner: "platform",
    });
    expect(rec.annotation.risk).toBe("high");
    expect(rec.annotation.owner).toBe("platform");
    expect(store.getTool("deploy_service")?.annotation.risk).toBe("high");
  });

  it("addInsight upserts by key", () => {
    store.ensureTool("deploy_service");
    store.addInsight({
      toolName: "deploy_service",
      key: "observed_failure_rate",
      value: 0.1,
      confidence: 0.9,
      source: "evaluation",
    });
    store.addInsight({
      toolName: "deploy_service",
      key: "observed_failure_rate",
      value: 0.2,
      confidence: 0.95,
      source: "evaluation",
    });
    const insights = store.getTool("deploy_service")?.insights ?? [];
    expect(insights).toHaveLength(1);
    expect(insights[0].value).toBe(0.2);
  });

  it("addRecommendation appends and clearRecommendations removes by type", () => {
    store.ensureTool("deploy_service");
    store.addRecommendation({
      toolName: "deploy_service",
      type: "approval",
      payload: { decision: "require_confirmation" },
      rationale: "x",
      confidence: 1,
      generatedAt: new Date().toISOString(),
    });
    store.addRecommendation({
      toolName: "deploy_service",
      type: "model",
      payload: { model: "gpt-5-mini" },
      rationale: "y",
      confidence: 0.8,
      generatedAt: new Date().toISOString(),
    });
    expect(store.getTool("deploy_service")?.recommendations).toHaveLength(2);
    store.clearRecommendations("deploy_service", "approval");
    const recs = store.getTool("deploy_service")?.recommendations ?? [];
    expect(recs).toHaveLength(1);
    expect(recs[0].type).toBe("model");
  });

  it("recordExecution folds events into stats", () => {
    store.ensureTool("deploy_service", "srv");
    const base: Omit<ToolExecutionEvent, "status"> = {
      id: "e1",
      toolName: "deploy_service",
      serverName: "srv",
      timestamp: new Date().toISOString(),
      durationMs: 1000,
      model: "gpt-5-mini",
      cost: { amount: 0.01, currency: "USD" },
    };
    store.recordExecution({ ...base, status: "completed" });
    store.recordExecution({ ...base, id: "e2", status: "failed" });
    const stats = store.getTool("deploy_service")?.stats;
    expect(stats?.invocations).toBe(2);
    expect(stats?.failures).toBe(1);
    expect(stats?.failureRate).toBeCloseTo(0.5);
    expect(stats?.avgDurationMs).toBe(1000);
    expect(stats?.totalCost).toBeCloseTo(0.02);
  });
});
