import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryStore } from "@adaptivemcp/memory";
import { GraphTrackingMiddleware } from "./graph-middleware.js";
import type { CallResult, PlannedCall } from "@adaptivemcp/middleware";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Runs one logical tool call's full beforeCall -> afterCall hook sequence, as loop.ts does. */
async function runTrackedCall(
  middleware: GraphTrackingMiddleware,
  call: PlannedCall,
  jitterMs: number,
): Promise<{ parentId: string | undefined; sessionId: string }> {
  return middleware.runInContext(async () => {
    await middleware.beforeCall(call);
    await sleep(jitterMs);
    const result: CallResult = { ok: true };
    await middleware.afterCall(result, call);
    return { parentId: middleware.getParentId(), sessionId: middleware.getSessionId() };
  });
}

describe("@adaptivemcp/thin-client GraphTrackingMiddleware", () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore({ path: ":memory:" });
  });

  afterEach(() => store.close());

  it("tracks a single sequential call chain correctly", async () => {
    const middleware = new GraphTrackingMiddleware(store, { sessionId: "s1" });
    const call: PlannedCall = { toolName: "root_tool", input: {} };

    const rootId = await middleware.runInContext(async () => {
      await middleware.beforeCall(call);
      const id = middleware.getParentId();
      expect(middleware.getRootNodeId()).toBe(id);
      await middleware.afterCall({ ok: true }, call);
      expect(middleware.getDepth()).toBe(0);
      return id;
    });

    expect(rootId).toBeDefined();
    const node = store.getExecutionNode(rootId!);
    expect(node?.status).toBe("completed");
    expect(node?.sessionId).toBe("s1");
  });

  it("isolates concurrent call chains via AsyncLocalStorage", async () => {
    const middleware = new GraphTrackingMiddleware(store, { sessionId: "s1" });

    const [a, b] = await Promise.all([
      runTrackedCall(middleware, { toolName: "tool_a", input: {} }, 20),
      runTrackedCall(middleware, { toolName: "tool_b", input: {} }, 5),
    ]);

    // Each chain must have started (and completed) its own root node -
    // neither should observe the other's node id.
    expect(a.parentId).toBeUndefined();
    expect(b.parentId).toBeUndefined();

    const nodes = store.getNodesBySession("s1");
    expect(nodes).toHaveLength(2);
    const toolNames = nodes.map((n) => n.toolName).sort();
    expect(toolNames).toEqual(["tool_a", "tool_b"]);
    for (const node of nodes) {
      expect(node.status).toBe("completed");
      expect(node.parentId).toBeUndefined();
    }
  });

  it("beforeCall/afterCall resolve to the call's own node under concurrency", async () => {
    const middleware = new GraphTrackingMiddleware(store, { sessionId: "s1" });

    async function runAndCapture(toolName: string, jitterMs: number) {
      return middleware.runInContext(async () => {
        const call: PlannedCall = { toolName, input: {} };
        await middleware.beforeCall(call);
        const nodeIdAtStart = middleware.getParentId();
        await sleep(jitterMs);
        await middleware.afterCall({ ok: true }, call);
        return nodeIdAtStart;
      });
    }

    const [idA, idB] = await Promise.all([runAndCapture("slow_tool", 30), runAndCapture("fast_tool", 2)]);

    expect(idA).toBeDefined();
    expect(idB).toBeDefined();
    expect(idA).not.toBe(idB);

    const nodeA = store.getExecutionNode(idA!);
    const nodeB = store.getExecutionNode(idB!);
    expect(nodeA?.toolName).toBe("slow_tool");
    expect(nodeA?.status).toBe("completed");
    expect(nodeB?.toolName).toBe("fast_tool");
    expect(nodeB?.status).toBe("completed");
  });

  it("getDepth/getParentId reflect only the current async chain, and nest correctly across recursive calls", async () => {
    const middleware = new GraphTrackingMiddleware(store, { sessionId: "s1" });
    expect(middleware.getDepth()).toBe(0);
    expect(middleware.getParentId()).toBeUndefined();

    // Mirrors real usage: a nested tool call recurses through its own
    // runInContext scope (e.g. a tool handler that itself calls
    // ThinClient.run() again), nested inside the outer call's scope.
    const depthInside = await middleware.runInContext(async () => {
      const rootCall: PlannedCall = { toolName: "root", input: {} };
      await middleware.beforeCall(rootCall);

      const inner = await middleware.runInContext(async () => {
        const childCall: PlannedCall = { toolName: "child", input: {} };
        await middleware.beforeCall(childCall);
        const depth = middleware.getDepth();
        await middleware.afterCall({ ok: true }, childCall);
        return depth;
      });

      await middleware.afterCall({ ok: true }, rootCall);
      return inner;
    });

    expect(depthInside).toBe(2);
    expect(middleware.getDepth()).toBe(0);
  });

  describe("runTurn (per-turn DAG)", () => {
    /**
     * Mirrors `ThinClient.run`, which awaits middleware before `beforeCall`; the
     * yield ensures the graph context is established before nodes start.
     */
    async function runTurnCall(middleware: GraphTrackingMiddleware, toolName: string): Promise<void> {
      await middleware.runInContext(async () => {
        await Promise.resolve();
        await middleware.beforeCall({ toolName, input: {} });
        await middleware.afterCall({ ok: true }, { toolName, input: {} });
      });
    }

    it("parents every top-level call under one turn root", async () => {
      const middleware = new GraphTrackingMiddleware(store, { sessionId: "s1" });

      await middleware.runTurn("agent_turn", async () => {
        await runTurnCall(middleware, "tool_a");
        await runTurnCall(middleware, "tool_b");
      });

      const nodes = store.getNodesBySession("s1");
      const turn = nodes.find((node) => node.toolName === "agent_turn");
      expect(turn).toBeDefined();
      expect(turn?.status).toBe("completed");
      expect(turn?.parentId).toBeUndefined();
      expect(turn?.childrenIds).toHaveLength(2);

      const children = turn!.childrenIds.map((id) => store.getExecutionNode(id)!);
      expect(children.map((child) => child.toolName).sort()).toEqual(["tool_a", "tool_b"]);
      for (const child of children) {
        expect(child.parentId).toBe(turn!.id);
        expect(child.status).toBe("completed");
      }

      // A single DAG: only the turn is a root (no per-call roots).
      expect(store.getRootNodes("s1")).toHaveLength(1);
    });

    it("marks the turn root failed and rethrows when the turn throws", async () => {
      const middleware = new GraphTrackingMiddleware(store, { sessionId: "s1" });

      await expect(
        middleware.runTurn("agent_turn", async () => {
          throw new Error("turn boom");
        }),
      ).rejects.toThrow("turn boom");

      const turn = store.getNodesBySession("s1").find((node) => node.toolName === "agent_turn");
      expect(turn?.status).toBe("failed");
      expect(turn?.error?.message).toBe("turn boom");
    });

    it("keeps per-call roots when runTurn is not used (backward compatible)", async () => {
      const middleware = new GraphTrackingMiddleware(store, { sessionId: "s1" });
      await runTrackedCall(middleware, { toolName: "tool_a", input: {} }, 1);
      await runTrackedCall(middleware, { toolName: "tool_b", input: {} }, 1);
      expect(store.getRootNodes("s1")).toHaveLength(2);
    });
  });

  describe("getTraceParent (Phase 11.4)", () => {
    const TRACEPARENT_RE = /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/;

    it("returns undefined outside of a tracked call", () => {
      const middleware = new GraphTrackingMiddleware(store, { sessionId: "s1" });
      expect(middleware.getTraceParent()).toBeUndefined();
    });

    it("generates a valid W3C traceparent for the root node", async () => {
      const middleware = new GraphTrackingMiddleware(store, { sessionId: "s1" });
      const rootCall: PlannedCall = { toolName: "root", input: {} };

      const traceparent = await middleware.runInContext(async () => {
        await middleware.beforeCall(rootCall);
        return middleware.getTraceParent();
      });

      expect(traceparent).toMatch(TRACEPARENT_RE);
      const rootId = store.getRootNodes("s1")[0]?.id;
      expect(store.getExecutionNode(rootId!)?.metadata?.traceparent).toBe(traceparent);
    });

    it("keeps the same traceId across a workflow but gives each node its own spanId, and records parentSpanId on children", async () => {
      const middleware = new GraphTrackingMiddleware(store, { sessionId: "s1" });
      const rootCall: PlannedCall = { toolName: "root", input: {} };

      await middleware.runInContext(async () => {
        await middleware.beforeCall(rootCall);
        const childCall: PlannedCall = { toolName: "child", input: {} };
        await middleware.beforeCall(childCall);
        await middleware.afterCall({ ok: true }, childCall);
        await middleware.afterCall({ ok: true }, rootCall);
      });

      const nodes = store.getNodesBySession("s1");
      const root = nodes.find((n) => n.toolName === "root")!;
      const child = nodes.find((n) => n.toolName === "child")!;

      expect(root.metadata?.traceparent).toMatch(TRACEPARENT_RE);
      expect(child.metadata?.traceparent).toMatch(TRACEPARENT_RE);
      expect(root.metadata?.traceId).toBe(child.metadata?.traceId);
      expect(root.metadata?.spanId).not.toBe(child.metadata?.spanId);
      expect(child.metadata?.parentSpanId).toBe(root.metadata?.spanId);
      expect(root.metadata?.parentSpanId).toBeUndefined();
    });
  });
});
