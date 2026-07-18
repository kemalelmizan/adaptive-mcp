import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryStore } from "@adaptivemcp/memory";
import { Evaluator } from "./evaluator.js";
import type { ToolExecutionEvent } from "@adaptivemcp/spec";

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

  it("persists insights into the SSOT", () => {
    record(store, "deploy_service", 0.3, 40);
    evaluator.evaluateAll();
    const insights = store.getTool("deploy_service")?.insights ?? [];
    expect(insights.some((i) => i.key === "observed_failure_rate")).toBe(true);
  });
});
