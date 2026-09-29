import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { MemoryStore } from "./store.js";
import type { ToolExecutionEvent, ExecutionNode } from "@adaptivemcp/spec";

function makeNode(overrides: Partial<ExecutionNode> = {}): ExecutionNode {
  return {
    id: "n1",
    toolName: "deploy_service",
    sessionId: "s1",
    childrenIds: [],
    timestamp: new Date().toISOString(),
    status: "completed",
    ...overrides,
  };
}

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

  it("folds execution events into dimensional metric cells", () => {
    const now = new Date().toISOString();
    for (let i = 0; i < 4; i += 1) {
      store.recordExecution({
        id: `e${i}`,
        toolName: "deploy",
        serverName: "srv",
        timestamp: now,
        status: i === 0 ? "failed" : "completed",
        durationMs: 120,
        model: "m1",
        decoding: { profile: "deterministic", resolverVersion: "1.0.0", resolved: {} },
        usage: { inputTokens: 10, outputTokens: 5 },
        error: i === 0 ? { message: "boom", code: "ETIMEDOUT" } : undefined,
      });
    }

    const cells = store.metricCells({ toolName: "deploy" });
    const all = cells.find((cell) => Object.keys(cell.dimensions).length === 0)!;
    expect(all.invocations).toBe(4);
    expect(all.failures).toBe(1);
    expect(all.errorCodes).toEqual({ ETIMEDOUT: 1 });
    expect(all.durationSum).toBe(480);
    expect(all.tokenInSum).toBe(40);
    expect(all.tokenOutSum).toBe(20);
    expect(all.durationHistogram.reduce((sum, n) => sum + n, 0)).toBe(4);
    expect(all.ewmaFailureRate).toBeCloseTo(0.512, 3);
    expect(all.exemplars).toEqual(["e0", "e1", "e2", "e3"]);

    const model = cells.find(
      (cell) => cell.dimensions.model === "m1" && cell.dimensions.decodingProfile === undefined,
    )!;
    expect(model.invocations).toBe(4);

    const decoding = cells.find((cell) => cell.dimensions.decodingProfile === "deterministic")!;
    expect(decoding.dimensions.model).toBe("m1");
    expect(decoding.dimensions.resolverVersion).toBe("1.0.0");
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

  it("keeps separate records for the same tool name on different servers", () => {
    store.ensureTool("search", "crm-server");
    store.ensureTool("search", "docs-server");
    expect(store.allTools()).toHaveLength(2);

    store.setAnnotation({ toolName: "search", serverName: "crm-server", risk: "high" });
    store.setAnnotation({ toolName: "search", serverName: "docs-server", risk: "low" });
    expect(store.getTool("search", "crm-server")?.annotation.risk).toBe("high");
    expect(store.getTool("search", "docs-server")?.annotation.risk).toBe("low");
  });

  it("claims an unclaimed record instead of fragmenting it once the server is known", () => {
    store.setAnnotation({ toolName: "deploy_service", risk: "high" });
    store.recordExecution({
      id: "e1",
      toolName: "deploy_service",
      serverName: "srv",
      timestamp: new Date().toISOString(),
      status: "completed",
    });
    expect(store.allTools()).toHaveLength(1);
    const record = store.getTool("deploy_service", "srv");
    expect(record?.annotation.risk).toBe("high");
    expect(record?.stats.invocations).toBe(1);
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

  it("getWorkflowIds returns every distinct workflow id, excluding nulls", () => {
    store.recordExecutionNode(makeNode({ id: "a", workflowId: "wf1" }));
    store.recordExecutionNode(makeNode({ id: "b", workflowId: "wf1" }));
    store.recordExecutionNode(makeNode({ id: "c", workflowId: "wf2" }));
    store.recordExecutionNode(makeNode({ id: "d" })); // no workflowId

    expect(store.getWorkflowIds().sort()).toEqual(["wf1", "wf2"]);
  });

  describe("production hardening (Phase 9)", () => {
    let dir: string;

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), "adaptivemcp-memory-test-"));
    });

    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    it("applies WAL journal mode for file-backed stores", () => {
      const path = join(dir, "wal.db");
      const fileStore = new MemoryStore({ path });
      fileStore.recordExecutionNode(makeNode());

      const raw = new DatabaseSync(path);
      const mode = raw.prepare(`PRAGMA journal_mode`).get() as { journal_mode: string };
      raw.close();
      fileStore.close();

      expect(mode.journal_mode).toBe("wal");
    });

    it("does not attempt WAL for :memory: stores", () => {
      expect(() => new MemoryStore({ path: ":memory:" })).not.toThrow();
    });

    it("runs migrations idempotently when reopening an existing file", () => {
      const path = join(dir, "migrations.db");
      const a = new MemoryStore({ path });
      a.close();
      const b = new MemoryStore({ path });
      b.close();

      const raw = new DatabaseSync(path);
      const rows = raw.prepare(`SELECT version FROM schema_migrations ORDER BY version`).all() as {
        version: number;
      }[];
      raw.close();
      expect(rows.map((r) => r.version)).toEqual([1, 2, 3]);
    });

    it("creates the timestamp index used for pruning", () => {
      const path = join(dir, "index.db");
      const fileStore = new MemoryStore({ path });
      fileStore.close();

      const raw = new DatabaseSync(path);
      const indexes = raw
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'execution_nodes'`)
        .all() as { name: string }[];
      raw.close();
      expect(indexes.map((i) => i.name)).toContain("idx_nodes_timestamp");
    });

    it("prunes execution nodes older than the cutoff and returns the deleted count", () => {
      const now = Date.now();
      const oldTimestamp = new Date(now - 10_000).toISOString();
      const freshTimestamp = new Date(now - 1_000).toISOString();
      store.recordExecutionNode(makeNode({ id: "old", timestamp: oldTimestamp }));
      store.recordExecutionNode(makeNode({ id: "fresh", timestamp: freshTimestamp }));

      const result = store.pruneExecutionNodes(5_000, now);

      expect(result.deleted).toBe(1);
      expect(store.getExecutionNode("old")).toBeUndefined();
      expect(store.getExecutionNode("fresh")).toBeDefined();
    });

    it("leaves the tools table untouched by pruning", () => {
      store.ensureTool("deploy_service");
      store.recordExecutionNode(makeNode({ timestamp: new Date(0).toISOString() }));
      store.pruneExecutionNodes(1);
      expect(store.getTool("deploy_service")).toBeDefined();
    });

    it("opportunistically prunes when retention is configured and the check interval has elapsed", () => {
      const retentionStore = new MemoryStore({ path: ":memory:", retention: { maxAgeMs: 1_000 } });
      const now = Date.now();
      retentionStore.recordExecutionNode(makeNode({ id: "old", timestamp: new Date(now - 5_000).toISOString() }));
      retentionStore.recordExecutionNode(makeNode({ id: "new", timestamp: new Date(now).toISOString() }));

      expect(retentionStore.getExecutionNode("old")).toBeUndefined();
      expect(retentionStore.getExecutionNode("new")).toBeDefined();
      retentionStore.close();
    });
  });
});
