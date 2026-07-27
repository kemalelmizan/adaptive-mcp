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
import type { ExecutionNode } from "@adaptivemcp/spec";

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

  describe("graph resource ETags (Phase 9.3)", () => {
    it.each([
      ["executionGraphResourceText", (c: ExtensionController) => c.executionGraphResourceText("s1", "application/json")],
      ["workflowGraphResourceText", (c: ExtensionController) => c.workflowGraphResourceText("wf1", "application/json")],
      ["graphInsightsResourceText", (c: ExtensionController) => c.graphInsightsResourceText("s1", "application/json")],
    ] as const)("%s computes a real, stable etag for unchanged data", (_name, call) => {
      store.recordExecutionNode(node({ id: "root", workflowId: "wf1" }));
      const controller = new ExtensionController({ memory: store });

      const first = call(controller);
      const second = call(controller);
      if (typeof first !== "string" || typeof second !== "string") throw new Error("expected documents");

      const etagA = (JSON.parse(first) as { etag: string }).etag;
      const etagB = (JSON.parse(second) as { etag: string }).etag;
      expect(etagA).toBeTruthy();
      expect(etagA).toBe(etagB);
    });

    it.each([
      ["executionGraphResourceText", (c: ExtensionController, opts: { ifNoneMatch?: string }) =>
        c.executionGraphResourceText("s1", "application/json", opts)],
      ["workflowGraphResourceText", (c: ExtensionController, opts: { ifNoneMatch?: string }) =>
        c.workflowGraphResourceText("wf1", "application/json", opts)],
      ["graphInsightsResourceText", (c: ExtensionController, opts: { ifNoneMatch?: string }) =>
        c.graphInsightsResourceText("s1", "application/json", opts)],
    ] as const)("%s returns notModified when ifNoneMatch matches, full doc when stale", (_name, call) => {
      store.recordExecutionNode(node({ id: "root", workflowId: "wf1" }));
      const controller = new ExtensionController({ memory: store });

      const initial = call(controller, {});
      if (typeof initial !== "string") throw new Error("expected a document");
      const etag = (JSON.parse(initial) as { etag: string }).etag;

      const matched = call(controller, { ifNoneMatch: etag });
      expect(matched).toEqual({ notModified: true, etag });

      const stale = call(controller, { ifNoneMatch: "bogus" });
      expect(typeof stale).toBe("string");
    });

    it("execution graph etag changes when a new node is recorded for the session", () => {
      store.recordExecutionNode(node({ id: "root", workflowId: "wf1" }));
      const controller = new ExtensionController({ memory: store });
      const before = controller.executionGraphResourceText("s1", "application/json") as string;
      const etagBefore = (JSON.parse(before) as { etag: string }).etag;

      store.recordExecutionNode(node({ id: "child", parentId: "root", workflowId: "wf1" }));
      const after = controller.executionGraphResourceText("s1", "application/json") as string;
      const etagAfter = (JSON.parse(after) as { etag: string }).etag;

      expect(etagAfter).not.toBe(etagBefore);
    });
  });

  describe("execution graph pagination (Phase 11.1)", () => {
    function seedChainOfNodes(count: number): void {
      let parentId: string | undefined;
      for (let i = 0; i < count; i++) {
        const id = `n${i}`;
        store.recordExecutionNode(
          node({
            id,
            parentId,
            workflowId: "wf1",
            timestamp: new Date(2026, 0, 1, 0, 0, i).toISOString(),
            childrenIds: [],
          }),
        );
        if (parentId) {
          const parent = store.getExecutionNode(parentId)!;
          store.updateChildrenIds(parentId, [...parent.childrenIds, id]);
        }
        parentId = id;
      }
    }

    it("returns at most pageSize nodes and a next_cursor when more remain", () => {
      seedChainOfNodes(5);
      const controller = new ExtensionController({ memory: store });
      const doc = JSON.parse(controller.executionGraphResourceText("s1", "application/json", { pageSize: 2 }) as string);

      expect(doc.nodes.map((n: { id: string }) => n.id)).toEqual(["n0", "n1"]);
      expect(doc.next_cursor).toBe("n1");
    });

    it("resumes from a cursor and omits next_cursor on the last page", () => {
      seedChainOfNodes(5);
      const controller = new ExtensionController({ memory: store });
      const doc = JSON.parse(
        controller.executionGraphResourceText("s1", "application/json", { cursor: "n2", pageSize: 2 }) as string,
      );

      expect(doc.nodes.map((n: { id: string }) => n.id)).toEqual(["n3", "n4"]);
      expect(doc.next_cursor).toBeUndefined();
    });

    it("falls back to the first page for an unknown/stale cursor", () => {
      seedChainOfNodes(3);
      const controller = new ExtensionController({ memory: store });
      const doc = JSON.parse(
        controller.executionGraphResourceText("s1", "application/json", { cursor: "does-not-exist", pageSize: 2 }) as string,
      );

      expect(doc.nodes.map((n: { id: string }) => n.id)).toEqual(["n0", "n1"]);
    });

    it("always returns every edge, regardless of the current node page", () => {
      seedChainOfNodes(5);
      const controller = new ExtensionController({ memory: store });
      const doc = JSON.parse(controller.executionGraphResourceText("s1", "application/json", { pageSize: 2 }) as string);

      expect(doc.edges).toHaveLength(4); // 5 nodes chained -> 4 edges, all present despite a 2-node page
    });

    it("defaults to a full page (pageSize 50) when no pagination options are given", () => {
      seedChainOfNodes(3);
      const controller = new ExtensionController({ memory: store });
      const doc = JSON.parse(controller.executionGraphResourceText("s1", "application/json") as string);

      expect(doc.nodes).toHaveLength(3);
      expect(doc.next_cursor).toBeUndefined();
    });
  });
});
