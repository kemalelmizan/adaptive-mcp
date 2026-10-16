import { describe, it, expect } from "vitest";
import { MemoryStore } from "@adaptivemcp/memory";
import { AdaptiveRuntime } from "./index.js";

describe("@adaptivemcp/runtime AdaptiveRuntime graph tracking (Phase 11.2)", () => {
  it("throws from startWorkflow when enableGraph is not set", () => {
    const runtime = new AdaptiveRuntime();
    expect(() => runtime.startWorkflow({ toolName: "deploy" })).toThrow();
    runtime.close();
  });

  it("records a root node and its child when enableGraph is true", () => {
    const runtime = new AdaptiveRuntime({ enableGraph: true });

    const { nodeId: rootId, sessionId } = runtime.startWorkflow({
      toolName: "deploy_release",
      workflowId: "wf1",
    });
    const { nodeId: childId } = runtime.startChild({ toolName: "kubernetes.apply" }, rootId);
    runtime.completeNode(childId, { durationMs: 500 });
    runtime.completeNode(rootId, { durationMs: 1000 });

    const graphMemory = runtime.memory as unknown as {
      getNodesBySession(
        sessionId: string,
      ): Array<{ id: string; status: string; parentId?: string }>;
    };
    const nodes = graphMemory.getNodesBySession(sessionId);
    expect(nodes).toHaveLength(2);
    expect(nodes.find((n) => n.id === rootId)?.status).toBe("completed");
    expect(nodes.find((n) => n.id === childId)?.parentId).toBe(rootId);

    runtime.close();
  });

  it("does not wire graph tracking for a non-MemoryStore backing store even with enableGraph: true", () => {
    const fakeStore = {
      close: () => {},
      ensureTool: () => ({
        toolName: "x",
        annotation: {},
        insights: [],
        recommendations: [],
        stats: {
          invocations: 0,
          failures: 0,
          failureRate: 0,
          avgDurationMs: null,
          totalCost: 0,
          lastObservedAt: null,
        },
        updatedAt: "",
      }),
      getTool: () => undefined,
      allTools: () => [],
      setAnnotation: (a: unknown) => a,
      addInsight: (i: unknown) => i,
      addRecommendation: (r: unknown) => r,
      clearRecommendations: () => ({}),
      recordExecution: () => ({}),
    };
    const runtime = new AdaptiveRuntime({ store: fakeStore as never, enableGraph: true });
    expect(() => runtime.startWorkflow({ toolName: "deploy" })).toThrow();
    runtime.close();
  });
});

describe("@adaptivemcp/runtime router configuration", () => {
  it("uses host-provided model options for model recommendations", () => {
    const runtime = new AdaptiveRuntime({
      routerModels: [{ id: "local-qwen", costWeight: 1, latencyWeight: 1 }],
      routerMinInvocations: 1,
    });

    runtime.observeCompleted({
      toolName: "fast",
      serverName: "s",
      durationMs: 100,
      status: "completed",
    });
    runtime.router.routeTool("fast", "s");

    const rec = runtime.memory
      .getTool("fast", "s")
      ?.recommendations.find((recommendation) => recommendation.type === "model");
    expect((rec?.payload as { model?: string } | undefined)?.model).toBe("local-qwen");

    runtime.close();
  });

  it("carries applied decoding + token usage into recorded telemetry (ROADMAP 8d)", () => {
    const runtime = new AdaptiveRuntime();

    runtime.observeCompleted({
      toolName: "deploy",
      serverName: "srv",
      durationMs: 10,
      status: "completed",
      decoding: {
        profile: "deterministic",
        resolverVersion: "1.0.0",
        resolved: { temperature: 0.2 },
      },
      usage: { inputTokens: 7, outputTokens: 3 },
    });

    const event = runtime.telemetry.getStore().all().at(-1);
    expect(event?.decoding?.profile).toBe("deterministic");
    expect(event?.decoding?.resolverVersion).toBe("1.0.0");
    expect(event?.usage?.inputTokens).toBe(7);
    expect(event?.usage?.outputTokens).toBe(3);

    runtime.close();
  });
});

describe("@adaptivemcp/runtime store ownership (#51)", () => {
  it("does not close a store it was handed, so several runtimes can share one", () => {
    // The shape a host uses for child sessions: a parent and its children over
    // one store. Closing a child must not take the database out from under the
    // parent — the failure would surface later, in the *other* runtime.
    const store = new MemoryStore({ path: ":memory:" });
    const parent = new AdaptiveRuntime({ store });
    const child = new AdaptiveRuntime({ store });

    child.close();

    expect(() => store.allTools()).not.toThrow();
    parent.close();
    expect(() => store.allTools()).not.toThrow();

    store.close(); // the caller owns what it supplied
  });

  it("still closes a store it created itself", () => {
    const runtime = new AdaptiveRuntime({ dbPath: ":memory:" });
    const store = runtime.memory;

    runtime.close();

    expect(() => store.allTools()).toThrow(/not open/i);
  });
});
