import { describe, it, expect, afterEach } from "vitest";
import { readFileSync, existsSync, rmSync } from "node:fs";
import { AdaptiveRuntime } from "./runtime.js";
import { toToolMetadataView } from "@adaptivemcp/extension";

/**
 * End-to-end integration test: drive AdaptiveRuntime through the full
 * observation -> evaluation -> routing -> orchestration -> extension loop and
 * assert the derived store + YAML state.
 */
describe("AdaptiveRuntime integration", () => {
  const runtimes: AdaptiveRuntime[] = [];

  afterEach(() => {
    while (runtimes.length) runtimes.pop()?.close();
  });

  function makeRuntime(yamlPath?: string): AdaptiveRuntime {
    const rt = new AdaptiveRuntime({ yamlPath });
    runtimes.push(rt);
    return rt;
  }

  it("derives insights, recommendations, and a stable YAML view from observations", () => {
    const rt = makeRuntime();
    rt.extension.annotate("deploy_service", {
      toolName: "deploy_service",
      risk: "high",
      owner: "platform",
    });

    // Simulate a flaky regression across enough invocations to trigger learning.
    for (let i = 0; i < 40; i++) {
      rt.observeCompleted({
        toolName: "deploy_service",
        serverName: "srv",
        durationMs: 900,
        status: i < 12 ? "failed" : "completed",
        model: "gpt-5-mini",
        cost: { amount: 0.0021 },
      });
    }

    const record = rt.memory.getTool("deploy_service");
    expect(record).toBeDefined();
    expect(record!.stats.invocations).toBe(40);
    expect(record!.stats.failureRate).toBeCloseTo(0.3, 1);

    // Evaluation emitted insights.
    expect(record!.insights.some((i) => i.key === "observed_failure_rate")).toBe(true);

    // Routing + orchestration wrote recommendations; approval is produced by the
    // enforcement hook (gate), which the caller invokes before a tool runs.
    const types = record!.recommendations.map((r) => r.type);
    expect(types).toContain("model");
    expect(types).toContain("workflow");

    // The approval gate reflects the high-risk annotation and writes its own
    // recommendation into the store.
    expect(rt.gate("deploy_service")).toBe("require_confirmation");
    expect(rt.memory.getTool("deploy_service")?.recommendations.some((r) => r.type === "approval")).toBe(true);

    // The YAML view is a faithful projection of the store.
    const view = toToolMetadataView(record!);
    expect(view.name).toBe("deploy_service");
    expect(view.annotation.risk).toBe("high");
    expect(view.insights.observed_failure_rate.value).toBeCloseTo(0.3, 1);
    expect(view.recommendations.length).toBe(record!.recommendations.length);
  });

  it("keeps the YAML view stable across identical store state", () => {
    const rt = makeRuntime();
    for (let i = 0; i < 40; i++) {
      rt.observeCompleted({
        toolName: "search_customer",
        serverName: "crm",
        durationMs: 40,
        status: "completed",
        model: "gpt-5-mini",
        cost: { amount: 0.0003 },
      });
    }
    const stripTs = (s: string) => s.replace(/generated_at:.*\n/, "");
    const first = stripTs(rt.extension.resourceText());
    const second = stripTs(rt.extension.resourceText());
    expect(first).toBe(second);
  });

  it("writes the derived YAML to disk when a yamlPath is given", () => {
    const path = "examples/yaml/.integration.test.yaml";
    const rt = makeRuntime(path);
    rt.observeCompleted({
      toolName: "search_customer",
      serverName: "crm",
      durationMs: 40,
      status: "completed",
      model: "gpt-5-mini",
      cost: { amount: 0.0003 },
    });
    expect(existsSync(path)).toBe(true);
    const text = readFileSync(path, "utf8");
    expect(text).toContain("name: search_customer");
    rmSync(path, { force: true });
  });
});
