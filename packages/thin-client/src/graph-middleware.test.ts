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
    await middleware.beforeCall(call, {} as never);
    await sleep(jitterMs);
    const result: CallResult = { ok: true };
    await middleware.afterCall(result, call, {} as never);
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
      await middleware.beforeCall(call, {} as never);
      const id = middleware.getParentId();
      expect(middleware.getRootNodeId()).toBe(id);
      await middleware.afterCall({ ok: true }, call, {} as never);
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
        await middleware.beforeCall(call, {} as never);
        const nodeIdAtStart = middleware.getParentId();
        await sleep(jitterMs);
        await middleware.afterCall({ ok: true }, call, {} as never);
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
      await middleware.beforeCall(rootCall, {} as never);

      const inner = await middleware.runInContext(async () => {
        const childCall: PlannedCall = { toolName: "child", input: {} };
        await middleware.beforeCall(childCall, {} as never);
        const depth = middleware.getDepth();
        await middleware.afterCall({ ok: true }, childCall, {} as never);
        return depth;
      });

      await middleware.afterCall({ ok: true }, rootCall, {} as never);
      return inner;
    });

    expect(depthInside).toBe(2);
    expect(middleware.getDepth()).toBe(0);
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
        await middleware.beforeCall(rootCall, {} as never);
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
        await middleware.beforeCall(rootCall, {} as never);
        const childCall: PlannedCall = { toolName: "child", input: {} };
        await middleware.beforeCall(childCall, {} as never);
        await middleware.afterCall({ ok: true }, childCall, {} as never);
        await middleware.afterCall({ ok: true }, rootCall, {} as never);
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
