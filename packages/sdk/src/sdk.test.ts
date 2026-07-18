import { describe, it, expect, vi } from "vitest";
import { AdaptiveClient, InsightEmitter } from "@adaptivemcp/sdk";
import { InMemoryTelemetryStore } from "@adaptivemcp/telemetry";

describe("@adaptivemcp/sdk", () => {
  it("observes tool execution through the middleware pipeline", async () => {
    const store = new InMemoryTelemetryStore();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const client = new AdaptiveClient({
      recorder: new (await import("@adaptivemcp/telemetry")).TelemetryRecorder({ store }),
      executor: async (call) => ({ output: { ok: true }, durationMs: 5 }),
      middleware: [new InsightEmitter({ store })],
    });

    const result = await client.call({ toolName: "deploy_service" });
    expect(result.output).toEqual({ ok: true });

    const events = store.byTool("deploy_service");
    expect(events).toHaveLength(1);
    expect(events[0]!.status).toBe("completed");
    warn.mockRestore();
  });

  it("records failures and dispatches them to middleware", async () => {
    const store = new InMemoryTelemetryStore();
    const { TelemetryRecorder } = await import("@adaptivemcp/telemetry");
    const client = new AdaptiveClient({
      recorder: new TelemetryRecorder({ store }),
      executor: async () => {
        throw new Error("boom");
      },
    });

    await expect(client.call({ toolName: "flaky_tool" })).rejects.toThrow("boom");
    expect(store.byTool("flaky_tool")[0]!.status).toBe("failed");
  });
});
