import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryStore } from "@adaptivemcp/memory";
import {
  ExtensionController,
  renderToolsMetadata,
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
    // render timestamp, which is intentionally regenerated each call).
    const stripTs = (s: string) => s.replace(/generated_at:.*\n/, "");
    expect(stripTs(toYaml(renderToolsMetadata(store.allTools(), SPEC_VERSION)))).toBe(stripTs(text));
  });

  it("controller exposes the spec-compliant resource URI", () => {
    const controller = new ExtensionController({ memory: store });
    expect(controller.resourceUri()).toBe("dev.adaptivemcp/tools-metadata");
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
});
