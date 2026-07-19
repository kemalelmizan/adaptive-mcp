import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryStore } from "@adaptivemcp/memory";
import {
  ExtensionController,
  renderToolsMetadata,
  toDocument,
  toToolMetadataView,
  toYaml,
} from "./index.js";
import { SPEC_VERSION } from "@adaptivemcp/spec";

describe("@adaptivemcp/extension", () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore({ path: ":memory:" });
  });

  afterEach(() => store.close());

  it("toToolMetadataView projects a record into the YAML shape", () => {
    store.ensureTool("deploy_service", "srv");
    store.setAnnotation({ toolName: "deploy_service", risk: "high" });
    store.addInsight({
      toolName: "deploy_service",
      key: "observed_failure_rate",
      value: 0.2,
      confidence: 0.9,
      source: "evaluation",
    });
    const view = toToolMetadataView(store.getTool("deploy_service")!);
    expect(view.name).toBe("deploy_service");
    expect(view.annotation.risk).toBe("high");
    expect(view.insights.observed_failure_rate.value).toBe(0.2);
    expect(view.stats.failure_rate).toBe(0);
  });

  it("renderToolsMetadata wraps tools with version + timestamp", () => {
    store.ensureTool("search_customer", "crm");
    const doc = renderToolsMetadata(store.allTools(), SPEC_VERSION);
    expect(doc.version).toBe(SPEC_VERSION);
    expect(doc.tools).toHaveLength(1);
    expect(doc.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("toYaml is stable and round-trips", () => {
    store.ensureTool("deploy_service", "srv");
    store.setAnnotation({ toolName: "deploy_service", risk: "high" });
    const doc = renderToolsMetadata(store.allTools(), SPEC_VERSION);
    const text = toYaml(doc);
    expect(text).toContain("name: deploy_service");
    expect(text).toContain("risk: high");
    // Re-rendering the same store yields identical tool projection (ignoring the
    // render timestamp and etag, which are intentionally regenerated each call).
    const stripVolatile = (s: string) =>
      s.replace(/generated_at:.*\n/, "").replace(/etag:.*\n/, "");
    expect(
      stripVolatile(toYaml(renderToolsMetadata(store.allTools(), SPEC_VERSION))),
    ).toBe(stripVolatile(text));
  });

  it("controller exposes the spec-compliant resource URI", () => {
    const controller = new ExtensionController({ memory: store });
    expect(controller.resourceUri()).toBe("dev.adaptivemcp://tools-metadata");
  });

  it("controller.sync derives the view and resourceText matches the YAML", () => {
    store.ensureTool("deploy_service", "srv");
    store.setAnnotation({ toolName: "deploy_service", risk: "high" });
    const controller = new ExtensionController({ memory: store });
    const doc = controller.sync();
    expect(doc.tools).toHaveLength(1);
    expect(controller.resourceText()).toContain("name: deploy_service");
  });

  it("controller.annotate writes into the store and re-syncs", () => {
    store.ensureTool("deploy_service", "srv");
    const controller = new ExtensionController({ memory: store });
    controller.annotate("deploy_service", { toolName: "deploy_service", risk: "high" });
    expect(store.getTool("deploy_service")?.annotation.risk).toBe("high");
    expect(controller.resourceText()).toContain("risk: high");
  });

  it("renderToolsMetadata emits a stable etag over its content", () => {
    store.ensureTool("deploy_service", "srv");
    store.setAnnotation({ toolName: "deploy_service", risk: "high" });
    const doc = renderToolsMetadata(store.allTools(), SPEC_VERSION);
    expect(doc.etag).toMatch(/^[0-9a-f]{40}$/);
    // Same content (ignoring generated_at) yields the same etag.
    const doc2 = renderToolsMetadata(store.allTools(), SPEC_VERSION);
    expect(doc2.etag).toBe(doc.etag);
  });

  it("toDocument serializes YAML by default and JSON on request", () => {
    store.ensureTool("deploy_service", "srv");
    const doc = renderToolsMetadata(store.allTools(), SPEC_VERSION);
    expect(toDocument(doc, "application/yaml")).toContain("name: deploy_service");
    const json = toDocument(doc, "application/json");
    expect(json).toContain('"name": "deploy_service"');
    expect(JSON.parse(json).etag).toBe(doc.etag);
  });

  it("controller exposes the report_observation tool definition", () => {
    const controller = new ExtensionController({ memory: store });
    const tool = controller.reportObservationTool();
    expect(tool.name).toBe("report_observation");
    expect(tool.inputSchema.properties.tool.type).toBe("string");
    expect(tool.inputSchema.required).toContain("tool");
    expect(tool.inputSchema.required).toContain("status");
    expect(tool.inputSchema.required).toContain("timestamp");
    expect(tool.inputSchema.properties.client_id).toBeDefined();
  });

  it("reportObservation folds a valid report and updates stats", () => {
    store.ensureTool("deploy_service", "srv");
    const controller = new ExtensionController({ memory: store });
    const res = controller.reportObservation({
      tool: "deploy_service",
      status: "failure",
      duration_ms: 1200,
      cost: 0.5,
      timestamp: "2026-07-19T10:00:00Z",
      client_id: "client-a",
    });
    expect(res.accepted).toBe(true);
    const rec = store.getTool("deploy_service")!;
    expect(rec.stats.invocations).toBe(1);
    expect(rec.stats.failures).toBe(1);
    expect(rec.stats.lastObservedAt).toBe("2026-07-19T10:00:00.000Z");
    expect(rec.stats.totalCost).toBe(0.5);
  });

  it("reportObservation drops invalid fields and substitutes bad timestamp", () => {
    store.ensureTool("search_customer", "crm");
    const controller = new ExtensionController({ memory: store });
    const res = controller.reportObservation({
      tool: "search_customer",
      status: "success",
      duration_ms: -5, // invalid → dropped
      cost: -1, // invalid → dropped
      timestamp: "not-a-date", // invalid → now
    });
    expect(res.accepted).toBe(true);
    const rec = store.getTool("search_customer")!;
    expect(rec.stats.invocations).toBe(1);
    expect(rec.stats.totalCost).toBe(0);
    expect(rec.stats.lastObservedAt).not.toBe("not-a-date");
  });

  it("reportObservation is a no-op when foldReports is false", () => {
    store.ensureTool("deploy_service", "srv");
    const controller = new ExtensionController({ memory: store });
    const res = controller.reportObservation({
      tool: "deploy_service",
      status: "success",
      timestamp: "2026-07-19T10:00:00Z",
      foldReports: false,
    });
    expect(res.accepted).toBe(false);
    expect(store.getTool("deploy_service")!.stats.invocations).toBe(0);
  });
});
