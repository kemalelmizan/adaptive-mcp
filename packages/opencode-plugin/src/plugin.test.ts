import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Middleware } from "@adaptivemcp/middleware";
import { AdaptiveMcpPlugin, createAdaptivePlugin } from "./index.js";
import type {
  OpenCodeToolExecuteAfterInput,
  OpenCodeToolExecuteAfterOutput,
  OpenCodeToolExecuteBeforeInput,
  OpenCodeToolExecuteBeforeOutput,
} from "./types.js";

function before(
  tool: string,
  callID: string,
  args: unknown = {},
): { input: OpenCodeToolExecuteBeforeInput; output: OpenCodeToolExecuteBeforeOutput } {
  return { input: { tool, sessionID: "s1", callID }, output: { args } };
}

function after(
  tool: string,
  callID: string,
  output = "ok",
): { input: OpenCodeToolExecuteAfterInput; output: OpenCodeToolExecuteAfterOutput } {
  return {
    input: { tool, sessionID: "s1", callID, args: {} },
    output: { title: tool, output, metadata: {} },
  };
}

function captureMiddleware(): Middleware & { calls: string[] } {
  const calls: string[] = [];
  return {
    name: "capture",
    calls,
    beforeCall: () => {
      calls.push("before");
    },
    afterCall: () => {
      calls.push("after");
    },
  };
}

describe("@adaptivemcp/opencode-plugin", () => {
  let plugin: AdaptiveMcpPlugin;

  beforeEach(() => {
    plugin = new AdaptiveMcpPlugin({ dbPath: ":memory:", persistDebounceMs: 0 });
  });

  afterEach(async () => {
    await plugin.dispose();
  });

  it("exposes exactly the real OpenCode V1 hooks", () => {
    const hooks = plugin.hooks();
    expect(Object.keys(hooks).sort()).toEqual([
      "dispose",
      "event",
      "tool.execute.after",
      "tool.execute.before",
    ]);
    expect(hooks["tool.execute.before"]).toBeTypeOf("function");
    expect(hooks["tool.execute.after"]).toBeTypeOf("function");
  });

  it("records one completed execution (not an extra 'started') from before+after", async () => {
    const hooks = plugin.hooks();
    const b = before("deploy_service", "c1", { env: "prod" });
    await hooks["tool.execute.before"]!(b.input, b.output);
    const a = after("deploy_service", "c1", "deployed");
    await hooks["tool.execute.after"]!(a.input, a.output);

    const record = plugin.memory.getTool("deploy_service");
    expect(record?.stats.invocations).toBe(1);
    expect(record?.stats.failures).toBe(0);
    // persist() ran synchronously (debounce 0), so the view includes the tool.
    expect(plugin.extension.view().tools.some((t) => t.name === "deploy_service")).toBe(true);
  });

  it("runs middleware beforeCall then afterCall around the call", async () => {
    const mw = captureMiddleware();
    const p = new AdaptiveMcpPlugin({ dbPath: ":memory:", persistDebounceMs: 0, middleware: [mw] });
    const hooks = p.hooks();

    const b = before("t", "c1");
    await hooks["tool.execute.before"]!(b.input, b.output);
    const a = after("t", "c1");
    await hooks["tool.execute.after"]!(a.input, a.output);

    expect(mw.calls).toEqual(["before", "after"]);
    await p.dispose();
  });

  it("tracks the session id from session.* events", async () => {
    const hooks = plugin.hooks();
    await hooks.event!({ event: { type: "session.created", properties: { sessionID: "sess-42" } } });
    expect(plugin.currentSessionId()).toBe("sess-42");
    await hooks.event!({ event: { type: "session.deleted", properties: { sessionID: "sess-42" } } });
    expect(plugin.currentSessionId()).toBeUndefined();
  });

  it("debounces evaluation and view sync across many calls", async () => {
    vi.useFakeTimers();
    try {
      const p = new AdaptiveMcpPlugin({ dbPath: ":memory:", persistDebounceMs: 100 });
      const spy = vi.spyOn(p, "persist");
      const hooks = p.hooks();

      for (const callID of ["c1", "c2", "c3"]) {
        const b = before("t", callID);
        await hooks["tool.execute.before"]!(b.input, b.output);
        const a = after("t", callID);
        await hooks["tool.execute.after"]!(a.input, a.output);
      }

      expect(spy).not.toHaveBeenCalled();
      vi.advanceTimersByTime(100);
      expect(spy).toHaveBeenCalledTimes(1);
      await p.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("records failures through recordToolFailure", () => {
    plugin.recordToolFailure(
      "deploy_service",
      { message: "upstream timeout", code: "ETIMEDOUT" },
      { durationMs: 50 },
    );
    const record = plugin.memory.getTool("deploy_service");
    expect(record?.stats.invocations).toBe(1);
    expect(record?.stats.failures).toBe(1);
  });

  it("closes the store and ignores calls after dispose", async () => {
    const b = before("t", "c1");
    // Dispose before recording; the before/after hooks must be no-ops, not throw.
    await plugin.dispose();
    await expect(plugin.hooks()["tool.execute.before"]!(b.input, b.output)).resolves.toBeUndefined();
    await expect(plugin.dispose()).resolves.toBeUndefined();
  });

  it("createAdaptivePlugin returns a host-shaped factory with the instance attached", async () => {
    const factory = createAdaptivePlugin({ dbPath: ":memory:", persistDebounceMs: 0 });
    const hooks = await factory({ directory: "/tmp/work" });
    expect(hooks["tool.execute.before"]).toBeTypeOf("function");
    expect(typeof factory.plugin.getToolsMetadata()).toBe("string");
    await factory.plugin.dispose();
  });
});
