import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryStore } from "@adaptivemcp/memory";
import { ApprovalGate } from "@adaptivemcp/approval";
import { Orchestrator } from "@adaptivemcp/orchestration";
import { SamplingAdvisor } from "@adaptivemcp/routing";
import { ThinClient } from "./loop.js";
import type { Middleware, PlannedCall } from "@adaptivemcp/middleware";
import type { Recommendation, ToolExecutionEvent } from "@adaptivemcp/spec";

function record(store: MemoryStore, toolName: string, failRate: number, calls: number): void {
  store.ensureTool(toolName, "srv");
  for (let i = 0; i < calls; i++) {
    const event: ToolExecutionEvent = {
      id: `${toolName}-${i}`,
      toolName,
      serverName: "srv",
      timestamp: new Date().toISOString(),
      durationMs: 1000,
      status: i < calls * failRate ? "failed" : "completed",
      cost: { amount: 0.01, currency: "USD" },
    };
    store.recordExecution(event);
  }
}

describe("@adaptivemcp/thin-client", () => {
  let store: MemoryStore;
  let gate: ApprovalGate;
  let client: ThinClient;

  beforeEach(() => {
    store = new MemoryStore({ path: ":memory:" });
    gate = new ApprovalGate({ memory: store });
  });

  afterEach(() => store.close());

  it("executes an allowed tool and records success", async () => {
    record(store, "search_customer", 0, 40);
    client = new ThinClient({ memory: store, gate });
    let recorded: { ok: boolean; error?: string; output?: unknown } | undefined;
    const res = await client.run(
      "search_customer",
      async () => ({ ok: true, output: "result" }),
      {},
      (ok, error, output) => {
        recorded = { ok, error, output };
      },
    );
    expect(res.decision).toBe("allow");
    expect(res.executed).toBe(true);
    expect(recorded?.ok).toBe(true);
    expect(recorded?.output).toBe("result");
  });

  it("blocks denied tools without executing", async () => {
    record(store, "deploy_service", 0, 40);
    gate = new ApprovalGate({ memory: store, policy: { denyTools: ["deploy_service"] } });
    client = new ThinClient({ memory: store, gate });
    let called = false;
    const res = await client.run(
      "deploy_service",
      async () => {
        called = true;
        return { ok: true };
      },
      {},
      () => {},
    );
    expect(res.decision).toBe("deny");
    expect(res.executed).toBe(false);
    expect(called).toBe(false);
  });

  it("respects a rejected confirmation", async () => {
    store.ensureTool("deploy_service", "srv");
    store.setAnnotation({ toolName: "deploy_service", risk: "high" });
    client = new ThinClient({ memory: store, gate, requestApproval: () => false });
    let called = false;
    const res = await client.run(
      "deploy_service",
      async () => {
        called = true;
        return { ok: true };
      },
      {},
      () => {},
    );
    expect(res.decision).toBe("require_confirmation");
    expect(res.executed).toBe(false);
    expect(called).toBe(false);
  });

  it("retries using the store-derived policy", async () => {
    record(store, "deploy_service", 0.3, 40);
    new Orchestrator({ memory: store }).planTool("deploy_service");
    client = new ThinClient({ memory: store, gate });
    let attempts = 0;
    const res = await client.run(
      "deploy_service",
      async () => {
        attempts++;
        return attempts < 3 ? { ok: false, error: "flaky" } : { ok: true };
      },
      {},
      () => {},
    );
    expect(res.executed).toBe(true);
    expect(attempts).toBe(3);
  });

  it("runs registered middleware around the call (D2/D5)", async () => {
    record(store, "search_customer", 0, 40);
    const seen: string[] = [];
    const upper: Middleware = {
      name: "upper",
      afterCall: (_r, call: PlannedCall) => {
        seen.push("after");
        if (typeof call.output === "string") call.output = call.output.toUpperCase();
      },
    };
    client = new ThinClient({ memory: store, gate, middleware: [upper] });
    const res = await client.run(
      "search_customer",
      async () => ({ ok: true, output: "hello" }),
      {},
      () => {},
    );
    expect(res.output).toBe("HELLO");
    expect(seen).toEqual(["after"]);
  });

  describe("sampling recommendations", () => {
    function recordTelemetry(toolName: string, serverName: string | undefined, ok: boolean, error?: string): void {
      store.recordExecution({
        id: `${toolName}-${Math.random()}`,
        toolName,
        serverName,
        timestamp: new Date().toISOString(),
        durationMs: 100,
        status: ok ? "completed" : "failed",
        error: error ? { message: error } : undefined,
      });
    }

    it("does not invoke onSamplingRecommendation when samplingAdvisor is unset", async () => {
      record(store, "search_customer", 0, 40);
      const seen: Recommendation[] = [];
      client = new ThinClient({ memory: store, gate, onSamplingRecommendation: (rec) => void seen.push(rec) });
      await client.run(
        "search_customer",
        async () => ({ ok: true, output: "result" }),
        {},
        (ok, error) => recordTelemetry("search_customer", "srv", ok, error),
        "srv",
      );
      expect(seen).toHaveLength(0);
    });

    it("does not invoke the hook while the failure rate stays below threshold", async () => {
      record(store, "search_customer", 0, 40);
      const advisor = new SamplingAdvisor({ memory: store });
      const seen: Recommendation[] = [];
      client = new ThinClient({
        memory: store,
        gate,
        samplingAdvisor: advisor,
        onSamplingRecommendation: (rec) => void seen.push(rec),
      });
      await client.run(
        "search_customer",
        async () => ({ ok: true, output: "result" }),
        {},
        (ok, error) => recordTelemetry("search_customer", "srv", ok, error),
        "srv",
      );
      expect(seen).toHaveLength(0);
    });

    it("invokes the hook with the current sampling recommendation once the failure rate crosses the threshold", async () => {
      // 6/40 = 0.15, already above the default moderate threshold (0.1).
      record(store, "flaky_tool", 0.15, 40);
      const advisor = new SamplingAdvisor({ memory: store });
      const seen: Recommendation[] = [];
      client = new ThinClient({
        memory: store,
        gate,
        samplingAdvisor: advisor,
        onSamplingRecommendation: (rec, ctx) => void seen.push({ ...rec, toolName: ctx.toolName }),
      });
      await client.run(
        "flaky_tool",
        async () => ({ ok: true, output: "result" }),
        {},
        (ok, error) => recordTelemetry("flaky_tool", "srv", ok, error),
        "srv",
      );
      expect(seen).toHaveLength(1);
      expect(seen[0]?.payload).toEqual({ temperature: 0.4, topP: 0.7 });
    });

    it("reflects this call's own outcome, not stale pre-call stats", async () => {
      // 9 prior successful calls: below minInvocations (10), so advise() would
      // be a no-op if computed now. The 10th call below is what pushes this
      // tool over both minInvocations and the failure-rate threshold at once.
      record(store, "regression_tool", 0, 9);
      const advisor = new SamplingAdvisor({ memory: store });
      expect(advisor.advise("regression_tool", "srv")).toBeUndefined();

      const seen: Recommendation[] = [];
      client = new ThinClient({
        memory: store,
        gate,
        samplingAdvisor: advisor,
        onSamplingRecommendation: (rec) => void seen.push(rec),
      });
      await client.run(
        "regression_tool",
        async () => ({ ok: false, error: "boom" }),
        {},
        (ok, error) => recordTelemetry("regression_tool", "srv", ok, error),
        "srv",
      );

      expect(seen).toHaveLength(1);
      expect(seen[0]?.payload).toEqual({ temperature: 0.4, topP: 0.7 });
      expect(store.getTool("regression_tool", "srv")?.stats.invocations).toBe(10);
    });

    it("does not invoke the hook on a denied call", async () => {
      record(store, "deploy_service", 0, 40);
      gate = new ApprovalGate({ memory: store, policy: { denyTools: ["deploy_service"] } });
      const advisor = new SamplingAdvisor({ memory: store });
      const seen: Recommendation[] = [];
      client = new ThinClient({
        memory: store,
        gate,
        samplingAdvisor: advisor,
        onSamplingRecommendation: (rec) => void seen.push(rec),
      });
      const res = await client.run(
        "deploy_service",
        async () => ({ ok: true }),
        {},
        (ok, error) => recordTelemetry("deploy_service", "srv", ok, error),
        "srv",
      );
      expect(res.decision).toBe("deny");
      expect(seen).toHaveLength(0);
    });

    it("awaits an async onSamplingRecommendation before run() resolves", async () => {
      record(store, "flaky_tool", 0.15, 40);
      const advisor = new SamplingAdvisor({ memory: store });
      let settled = false;
      client = new ThinClient({
        memory: store,
        gate,
        samplingAdvisor: advisor,
        onSamplingRecommendation: async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          settled = true;
        },
      });
      await client.run(
        "flaky_tool",
        async () => ({ ok: true, output: "result" }),
        {},
        (ok, error) => recordTelemetry("flaky_tool", "srv", ok, error),
        "srv",
      );
      expect(settled).toBe(true);
    });
  });
});
