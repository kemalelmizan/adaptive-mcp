import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MemoryStore } from "@adaptivemcp/memory";
import { ApprovalGate } from "@adaptivemcp/approval";
import { Orchestrator } from "@adaptivemcp/orchestration";
import { ThinClient } from "./loop.js";
import type { Middleware, PlannedCall } from "@adaptivemcp/middleware";
import type { ToolExecutionEvent } from "@adaptivemcp/spec";

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
});
