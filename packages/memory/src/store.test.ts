import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { MemoryStore } from "./store.js";
import { MIGRATIONS, runMigrations } from "./migrations.js";
import type { ToolExecutionEvent, ExecutionNode, Suspension, Task } from "@adaptivemcp/spec";

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
    expect(all.attempts).toBe(4);
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

    // The overall cell also gets an hourly window for drift.
    expect(cells.some((cell) => cell.window.startsWith("hour:"))).toBe(true);
  });

  it("caps distinct model cells per tool (folds extra models into 'other')", () => {
    const capped = new MemoryStore({
      path: ":memory:",
      metricCardinality: { maxModelsPerTool: 2 },
    });
    const at = new Date().toISOString();
    for (const model of ["m1", "m2", "m3", "m4"]) {
      capped.recordExecution({
        id: `e-${model}`,
        toolName: "t",
        serverName: "s",
        timestamp: at,
        status: "completed",
        model,
      });
    }
    const models = capped
      .metricCells({ toolName: "t" })
      .map((cell) => cell.dimensions.model)
      .filter((model): model is string => model !== undefined);
    expect(new Set(models)).toEqual(new Set(["m1", "m2", "other"]));
    capped.close();
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
      observedAt: new Date().toISOString(),
    });
    store.addInsight({
      toolName: "deploy_service",
      key: "observed_failure_rate",
      value: 0.2,
      confidence: 0.95,
      source: "evaluation",
      observedAt: new Date().toISOString(),
    });
    const insights = store.getTool("deploy_service")?.insights ?? [];
    expect(insights).toHaveLength(1);
    expect(insights[0]?.value).toBe(0.2);
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
    expect(recs[0]?.type).toBe("model");
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
      // Compare against the declared history rather than a hard-coded list: the
      // invariant is "every migration applied exactly once, in order", and it
      // should not need editing every time one is added.
      const declared = [...MIGRATIONS].sort((x, y) => x.version - y.version).map((m) => m.version);
      expect(rows.map((r) => r.version)).toEqual(declared);
    });

    it("creates the timestamp index used for pruning", () => {
      const path = join(dir, "index.db");
      const fileStore = new MemoryStore({ path });
      fileStore.close();

      const raw = new DatabaseSync(path);
      const indexes = raw
        .prepare(
          `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'execution_nodes'`,
        )
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
      retentionStore.recordExecutionNode(
        makeNode({ id: "old", timestamp: new Date(now - 5_000).toISOString() }),
      );
      retentionStore.recordExecutionNode(
        makeNode({ id: "new", timestamp: new Date(now).toISOString() }),
      );

      expect(retentionStore.getExecutionNode("old")).toBeUndefined();
      expect(retentionStore.getExecutionNode("new")).toBeDefined();
      retentionStore.close();
    });
  });

  describe("suspensions (pause/resume)", () => {
    function makeSuspension(overrides: Partial<Suspension> = {}): Suspension {
      return {
        id: "sus1",
        sessionId: "s1",
        kind: "confirmation",
        question: "Deploy to production?",
        status: "pending",
        createdAt: new Date().toISOString(),
        ...overrides,
      };
    }

    it("round-trips a suspension, including the opaque host state", () => {
      store.recordSuspension(
        makeSuspension({
          responseSchema: { type: "boolean" },
          resumeState: { step: 3, plan: "deploy" },
        }),
      );
      const read = store.getSuspension("sus1");
      expect(read?.question).toBe("Deploy to production?");
      expect(read?.kind).toBe("confirmation");
      expect(read?.responseSchema).toEqual({ type: "boolean" });
      expect(read?.resumeState).toEqual({ step: 3, plan: "deploy" });
      expect(read?.status).toBe("pending");
      expect(read?.answer).toBeUndefined();
    });

    it("filters by status and returns newest first", () => {
      store.recordSuspension(makeSuspension({ id: "a", createdAt: "2026-01-01T00:00:00.000Z" }));
      store.recordSuspension(makeSuspension({ id: "b", createdAt: "2026-01-02T00:00:00.000Z" }));
      store.resolveSuspension("a", { status: "answered", answer: true });
      expect(store.getSuspensions("s1").map((s) => s.id)).toEqual(["b", "a"]);
      expect(store.getSuspensions("s1", "pending").map((s) => s.id)).toEqual(["b"]);
      expect(store.getSuspensions("s1", "answered").map((s) => s.id)).toEqual(["a"]);
    });

    it("answers a suspension and stamps resolvedAt", () => {
      store.recordSuspension(makeSuspension());
      const resolved = store.resolveSuspension("sus1", {
        status: "answered",
        answer: { ok: true },
      });
      expect(resolved?.status).toBe("answered");
      expect(resolved?.answer).toEqual({ ok: true });
      expect(resolved?.resolvedAt).toBeTruthy();
    });

    it("records a refusal or a timeout with a reason, and no answer", () => {
      store.recordSuspension(makeSuspension({ id: "c" }));
      const cancelled = store.resolveSuspension("c", {
        status: "cancelled",
        reason: "user declined",
      });
      expect(cancelled?.status).toBe("cancelled");
      expect(cancelled?.reason).toBe("user declined");
      expect(cancelled?.answer).toBeUndefined();
    });

    it("is idempotent: a replayed resume cannot overwrite the first answer", () => {
      store.recordSuspension(makeSuspension());
      store.resolveSuspension("sus1", { status: "answered", answer: "first" });
      const again = store.resolveSuspension("sus1", { status: "answered", answer: "second" });
      expect(again?.answer).toBe("first");
    });

    it("returns undefined for an unknown id", () => {
      expect(store.resolveSuspension("nope", { status: "cancelled" })).toBeUndefined();
      expect(store.getSuspension("nope")).toBeUndefined();
    });

    it("survives a close/reopen — it is durable state, not a cache", () => {
      const dir = mkdtempSync(join(tmpdir(), "suspensions-"));
      const path = join(dir, "s.db");
      const first = new MemoryStore({ path });
      first.recordSuspension(makeSuspension({ id: "p", sessionId: "sess" }));
      first.close();
      const second = new MemoryStore({ path });
      expect(second.getSuspensions("sess").map((s) => s.id)).toEqual(["p"]);
      second.close();
      rmSync(dir, { recursive: true, force: true });
    });
  });

  describe("tasks + typed memory steps", () => {
    function makeTask(overrides: Partial<Task> = {}): Task {
      return {
        id: "t1",
        sessionId: "s1",
        kind: "task",
        title: "Deploy the service",
        status: "pending",
        dependencies: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        ...overrides,
      };
    }

    it("round-trips a task, keeping dependencies in the order they were written", () => {
      store.recordTask(
        makeTask({
          description: "ship it",
          assignee: "worker-a",
          parentId: "epic",
          dependencies: ["t3", "t2"],
          notes: "waiting on review",
        }),
      );

      expect(store.getTask("t1")).toEqual({
        id: "t1",
        sessionId: "s1",
        kind: "task",
        title: "Deploy the service",
        description: "ship it",
        status: "pending",
        assignee: "worker-a",
        dependencies: ["t3", "t2"],
        parentId: "epic",
        notes: "waiting on review",
        createdAt: "2026-01-01T00:00:00.000Z",
      });
      expect(store.getTask("nope")).toBeUndefined();
    });

    it("upserts a task rather than appending a second one", () => {
      store.recordTask(makeTask({ dependencies: ["t9"] }));
      store.recordTask(makeTask({ dependencies: [] }));
      expect(store.getTask("t1")?.dependencies).toEqual([]);
      expect(store.getTasks("s1")).toHaveLength(1);
    });

    it("updateTask merges a patch and stamps updatedAt, leaving identity alone", () => {
      store.recordTask(makeTask());

      const updated = store.updateTask("t1", { status: "in_progress", assignee: "worker-b" });

      expect(updated?.status).toBe("in_progress");
      expect(updated?.assignee).toBe("worker-b");
      expect(updated?.title).toBe("Deploy the service");
      expect(updated?.createdAt).toBe("2026-01-01T00:00:00.000Z");
      expect(updated?.updatedAt).toBeDefined();
      expect(store.updateTask("nope", { status: "completed" })).toBeUndefined();
    });

    it("orders a session's tasks oldest first and filters them", () => {
      store.recordTask(makeTask({ id: "b", createdAt: "2026-01-02T00:00:00.000Z", assignee: "a" }));
      store.recordTask(makeTask({ id: "a", assignee: "b" }));
      store.recordTask(
        makeTask({
          id: "c",
          createdAt: "2026-01-03T00:00:00.000Z",
          status: "completed",
          assignee: "a",
        }),
      );

      expect(store.getTasks("s1").map((t) => t.id)).toEqual(["a", "b", "c"]);
      expect(store.getTasks("s1", { status: "completed" }).map((t) => t.id)).toEqual(["c"]);
      expect(store.getTasks("s1", { assignee: "a" }).map((t) => t.id)).toEqual(["b", "c"]);
      expect(store.getTasks("s1", { parentId: "epic" })).toEqual([]);
      // Another session's tasks are not this session's.
      expect(store.getTasks("s2")).toEqual([]);
    });

    it("offers only tasks whose dependencies are complete", () => {
      store.recordTask(makeTask({ id: "a" }));
      store.recordTask(makeTask({ id: "b", dependencies: ["a"] }));
      store.recordTask(makeTask({ id: "c", dependencies: ["b"] }));
      store.recordTask(makeTask({ id: "d", dependencies: ["a", "b"] }));

      expect(store.readyTasks("s1").map((t) => t.id)).toEqual(["a"]);

      // Started is not finished: a dependency in progress still blocks.
      store.updateTask("a", { status: "in_progress" });
      expect(store.readyTasks("s1")).toEqual([]);

      store.updateTask("a", { status: "completed" });
      expect(store.readyTasks("s1").map((t) => t.id)).toEqual(["b"]);

      store.updateTask("b", { status: "completed" });
      expect(store.readyTasks("s1").map((t) => t.id)).toEqual(["c", "d"]);
    });

    it("treats a dependency that matches no task as unmet, so a typo fails closed", () => {
      store.recordTask(makeTask({ id: "a", dependencies: ["ghost"] }));
      expect(store.readyTasks("s1")).toEqual([]);
    });

    it("does not treat a failed or cancelled dependency as done", () => {
      store.recordTask(makeTask({ id: "a" }));
      store.recordTask(makeTask({ id: "b", dependencies: ["a"] }));

      store.updateTask("a", { status: "failed" });
      expect(store.readyTasks("s1")).toEqual([]);

      store.updateTask("a", { status: "cancelled" });
      expect(store.readyTasks("s1")).toEqual([]);
    });

    it("round-trips an action step and a plan step", () => {
      store.recordStep({
        id: "st1",
        sessionId: "s1",
        kind: "action",
        summary: "ran deploy_service",
        toolName: "deploy_service",
        durationMs: 12.5,
        correlationId: "node-7",
        createdAt: "2026-01-01T00:00:01.000Z",
      });
      store.recordStep({
        id: "st2",
        sessionId: "s1",
        kind: "plan",
        steps: ["check the diff", "deploy"],
        reasoning: "the last step failed",
        createdAt: "2026-01-01T00:00:02.000Z",
      });

      // Exact objects, so a kind's fields cannot leak into the other's record.
      expect(store.getStep("st1")).toEqual({
        id: "st1",
        sessionId: "s1",
        kind: "action",
        summary: "ran deploy_service",
        toolName: "deploy_service",
        durationMs: 12.5,
        correlationId: "node-7",
        createdAt: "2026-01-01T00:00:01.000Z",
      });
      expect(store.getStep("st2")).toEqual({
        id: "st2",
        sessionId: "s1",
        kind: "plan",
        steps: ["check the diff", "deploy"],
        reasoning: "the last step failed",
        createdAt: "2026-01-01T00:00:02.000Z",
      });
      expect(store.getStep("nope")).toBeUndefined();
    });

    it("reads one session's history back in order, and narrows it by kind", () => {
      store.recordTask(makeTask({ id: "t1" }));
      store.recordStep({
        id: "st1",
        sessionId: "s1",
        kind: "plan",
        steps: ["go"],
        createdAt: "2026-01-01T00:00:01.000Z",
      });
      store.recordStep({
        id: "st2",
        sessionId: "s1",
        kind: "action",
        summary: "did it",
        createdAt: "2026-01-01T00:00:02.000Z",
      });
      store.recordTask(makeTask({ id: "t2", createdAt: "2026-01-01T00:00:03.000Z" }));
      store.recordTask(makeTask({ id: "x", sessionId: "s2" }));

      expect(store.getSteps("s1").map((r) => r.id)).toEqual(["t1", "st1", "st2", "t2"]);
      expect(store.getSteps("s1", { kind: "task" }).map((r) => r.id)).toEqual(["t1", "t2"]);
      expect(store.getSteps("s1", { kind: "plan" }).map((r) => r.id)).toEqual(["st1"]);
      expect(store.getSteps("s1", { kind: "action" }).map((r) => r.id)).toEqual(["st2"]);
      expect(store.getSteps("s2").map((r) => r.id)).toEqual(["x"]);
    });

    it("breaks ties on id, so a history is stable across reads", () => {
      store.recordStep({
        id: "st",
        sessionId: "s1",
        kind: "action",
        summary: "x",
        createdAt: "2026-01-01T00:00:00.000Z",
      });
      store.recordTask(makeTask({ id: "b" }));
      store.recordTask(makeTask({ id: "a" }));

      expect(store.getSteps("s1").map((r) => r.id)).toEqual(["a", "b", "st"]);
    });

    it("upgrades a store created before these tables existed", () => {
      const dir = mkdtempSync(join(tmpdir(), "upgrade-"));
      const path = join(dir, "old.db");

      // A database as an earlier release left it: every migration but this one.
      const old = new DatabaseSync(path);
      runMigrations(
        old,
        MIGRATIONS.filter((migration) => migration.version < 6),
      );
      const applied = old
        .prepare(`SELECT max(version) AS version FROM schema_migrations`)
        .get() as {
        version: number;
      };
      expect(applied.version).toBe(5);
      old.close();

      // Opening it with today's code applies the rest, and the new tables work —
      // which is what an existing agent's database will do on upgrade.
      const upgraded = new MemoryStore({ path });
      upgraded.recordTask(makeTask({ id: "t1", sessionId: "sess" }));
      upgraded.recordStep({
        id: "st1",
        sessionId: "sess",
        kind: "plan",
        steps: ["go"],
        createdAt: "2026-01-01T00:00:01.000Z",
      });

      expect(upgraded.getTask("t1")?.title).toBe("Deploy the service");
      expect(upgraded.getSteps("sess").map((r) => r.id)).toEqual(["t1", "st1"]);
      upgraded.close();
      rmSync(dir, { recursive: true, force: true });
    });

    it("survives a close/reopen — a task list and its history are durable state", () => {
      const dir = mkdtempSync(join(tmpdir(), "tasks-"));
      const path = join(dir, "t.db");
      const first = new MemoryStore({ path });
      first.recordTask(makeTask({ id: "t1", sessionId: "sess", dependencies: ["t0"] }));
      first.recordStep({
        id: "st1",
        sessionId: "sess",
        kind: "plan",
        steps: ["a", "b"],
        createdAt: "2026-01-01T00:00:01.000Z",
      });
      first.close();

      const second = new MemoryStore({ path });
      expect(second.getTask("t1")?.title).toBe("Deploy the service");
      expect(second.getTask("t1")?.dependencies).toEqual(["t0"]);
      expect(second.getStep("st1")).toMatchObject({ kind: "plan", steps: ["a", "b"] });
      second.close();
      rmSync(dir, { recursive: true, force: true });
    });
  });
});
