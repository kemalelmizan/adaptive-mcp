import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Middleware } from "@adaptivemcp/middleware";
import adaptivePlugin, {
  AdaptiveMcpPlugin,
  createAdaptivePlugin,
  createOpenCodePlugin,
} from "./index.js";
import type {
  OpenCodeToolExecuteAfterInput,
  OpenCodeToolExecuteAfterOutput,
  OpenCodeToolExecuteBeforeInput,
  OpenCodeToolExecuteBeforeOutput,
  OpenCodeV2Registration,
  OpenCodeV2SetupContext,
  OpenCodeV2ToolExecuteAfterEvent,
  OpenCodeV2ToolExecuteBeforeEvent,
  OpenCodeV2ToolHookContext,
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

function captureMiddleware(): Middleware & {
  calls: string[];
  results: Array<{ ok: boolean; error?: string }>;
} {
  const calls: string[] = [];
  const results: Array<{ ok: boolean; error?: string }> = [];
  return {
    name: "capture",
    calls,
    results,
    beforeCall: () => {
      calls.push("before");
    },
    afterCall: (result) => {
      calls.push("after");
      results.push({ ok: result.ok, error: result.error });
    },
  };
}

/** A fake OpenCode **V2** setup context capturing registered tool hooks. */
function v2Harness(options?: Record<string, unknown>) {
  const hooks = new Map<string, (event: unknown) => void | Promise<void>>();
  const registrations: Array<{ disposed: boolean }> = [];
  const tool = {
    hook: async (name: string, callback: (event: unknown) => void | Promise<void>) => {
      hooks.set(name, callback);
      const registration: OpenCodeV2Registration & { disposed: boolean } = {
        disposed: false,
        async dispose() {
          registration.disposed = true;
          hooks.delete(name);
        },
      };
      registrations.push(registration);
      return registration;
    },
  };
  const ctx = {
    options,
    tool: tool as unknown as OpenCodeV2ToolHookContext,
  } satisfies OpenCodeV2SetupContext;
  return {
    ctx,
    registrations,
    /** Fire a registered hook; resolves even when nothing is registered. */
    fire(name: string, event: unknown): Promise<void> {
      const handler = hooks.get(name);
      return handler ? Promise.resolve(handler(event)) : Promise.resolve();
    },
    registered(): string[] {
      return [...hooks.keys()];
    },
  };
}

function v2Before(tool: string, id: string, input: unknown = {}): OpenCodeV2ToolExecuteBeforeEvent {
  return { tool, sessionID: "s1", id, input };
}

function v2AfterCompleted(
  tool: string,
  id: string,
  input: unknown = {},
): OpenCodeV2ToolExecuteAfterEvent {
  return {
    ...v2Before(tool, id, input),
    status: "completed",
    result: {
      output: { exit: 0, truncated: false, output: "ok\n", status: "completed" },
      content: [{ type: "text", text: "ok\n" }],
      metadata: { status: "completed", truncated: false, exit: 0 },
    },
  };
}

function v2AfterError(
  tool: string,
  id: string,
  message = "boom",
  input: unknown = {},
): OpenCodeV2ToolExecuteAfterEvent {
  return { ...v2Before(tool, id, input), status: "error", error: { message } };
}

describe("@adaptivemcp/opencode-plugin (OpenCode V1)", () => {
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
    expect(mw.results).toEqual([{ ok: true, error: undefined }]);
    await p.dispose();
  });

  it("tracks the session id from session.* events", async () => {
    const hooks = plugin.hooks();
    await hooks.event!({
      event: { type: "session.created", properties: { sessionID: "sess-42" } },
    });
    expect(plugin.currentSessionId()).toBe("sess-42");
    await hooks.event!({
      event: { type: "session.deleted", properties: { sessionID: "sess-42" } },
    });
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
    await expect(
      plugin.hooks()["tool.execute.before"]!(b.input, b.output),
    ).resolves.toBeUndefined();
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

describe("@adaptivemcp/opencode-plugin (OpenCode V2)", () => {
  let plugin: AdaptiveMcpPlugin;

  beforeEach(() => {
    plugin = new AdaptiveMcpPlugin({ dbPath: ":memory:", persistDebounceMs: 0 });
  });

  afterEach(async () => {
    await plugin.dispose();
  });

  it("setup registers execute.before/execute.after and its cleanup disposes them", async () => {
    const h = v2Harness();
    const cleanup = await plugin.setup(h.ctx);
    expect(h.registered().sort()).toEqual(["execute.after", "execute.before"]);
    expect(h.registrations).toHaveLength(2);

    await cleanup();
    expect(h.registrations.every((r) => r.disposed)).toBe(true);
  });

  it("throws a clear error when the host context has no tool.hook API", async () => {
    await expect(plugin.setup({} as OpenCodeV2SetupContext)).rejects.toThrow(/tool\.hook/);
  });

  it("is a no-op when setup runs after dispose", async () => {
    await plugin.dispose();
    const h = v2Harness();
    const cleanup = await plugin.setup(h.ctx);
    expect(cleanup).toBeTypeOf("function");
    expect(h.registered()).toEqual([]);
  });

  it("records one completed execution from a V2 before/after pair", async () => {
    const h = v2Harness();
    await plugin.setup(h.ctx);
    await h.fire("execute.before", v2Before("deploy_service", "call-1", { env: "prod" }));
    await h.fire("execute.after", v2AfterCompleted("deploy_service", "call-1", { env: "prod" }));

    const record = plugin.memory.getTool("deploy_service");
    expect(record?.stats.invocations).toBe(1);
    expect(record?.stats.failures).toBe(0);
    // debounce 0 → persist ran synchronously; the derived view includes the tool.
    expect(plugin.extension.view().tools.some((t) => t.name === "deploy_service")).toBe(true);
    // V2 carries sessionID on every tool event — tracked without a ctx.event subscription.
    expect(plugin.currentSessionId()).toBe("s1");
  });

  it("maps the V2 result onto {title, output, metadata}", async () => {
    const h = v2Harness();
    await plugin.setup(h.ctx);
    const complete = vi.spyOn(plugin.telemetry, "complete");
    await h.fire("execute.before", v2Before("shell", "call-1"));
    await h.fire("execute.after", v2AfterCompleted("shell", "call-1"));

    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0]?.[1].output).toMatchObject({
      title: "shell", // host sent no title → the tool name
      output: "ok\n", // text content blocks joined
      metadata: { exit: 0 },
    });
    complete.mockRestore();
  });

  it("records a V2 status:error event as a failure (the per-tool error path V1 lacked)", async () => {
    const mw = captureMiddleware();
    const p = new AdaptiveMcpPlugin({
      dbPath: ":memory:",
      persistDebounceMs: 0,
      middleware: [mw],
    });
    const h = v2Harness();
    await p.setup(h.ctx);

    await h.fire("execute.before", v2Before("edit", "call-1", { filePath: "/x" }));
    await h.fire("execute.after", v2AfterError("edit", "call-1", "permission denied"));

    const record = p.memory.getTool("edit");
    expect(record?.stats.invocations).toBe(1);
    expect(record?.stats.failures).toBe(1);
    // Mirror the thin client: classified failures reach middleware as
    // runAfter({ ok: false, error }), after the beforeCall from execute.before.
    expect(mw.calls).toEqual(["before", "after"]);
    expect(mw.results).toEqual([{ ok: false, error: "permission denied" }]);
    await p.dispose();
  });

  it("records a non-zero shell exit as a failure (default policy)", async () => {
    const h = v2Harness();
    await plugin.setup(h.ctx);
    await h.fire("execute.before", v2Before("shell", "call-1"));
    const failedExit = v2AfterCompleted("shell", "call-1");
    failedExit.result = {
      output: { exit: 2, truncated: false, output: "nope", status: "completed" },
      metadata: { exit: 2, status: "completed" },
    };
    await h.fire("execute.after", failedExit);

    const record = plugin.memory.getTool("shell");
    expect(record?.stats.invocations).toBe(1);
    expect(record?.stats.failures).toBe(1);
  });

  it("treatNonZeroExitAsFailure: 'gte2' ignores exit 1 but fails exit 2", async () => {
    const p = new AdaptiveMcpPlugin({
      dbPath: ":memory:",
      persistDebounceMs: 0,
      treatNonZeroExitAsFailure: "gte2",
    });
    const h = v2Harness();
    await p.setup(h.ctx);
    for (const [id, exit] of [
      ["c1", 1],
      ["c2", 2],
    ] as const) {
      await h.fire("execute.before", v2Before("shell", id));
      const ev = v2AfterCompleted("shell", id);
      ev.result = { output: { exit, status: "completed" }, metadata: { exit } };
      await h.fire("execute.after", ev);
    }
    const record = p.memory.getTool("shell");
    expect(record?.stats.invocations).toBe(2);
    expect(record?.stats.failures).toBe(1);
    await p.dispose();
  });

  it("treatNonZeroExitAsFailure: 'off' keeps the host verdict", async () => {
    const p = new AdaptiveMcpPlugin({
      dbPath: ":memory:",
      persistDebounceMs: 0,
      treatNonZeroExitAsFailure: "off",
    });
    const h = v2Harness();
    await p.setup(h.ctx);
    await h.fire("execute.before", v2Before("shell", "c1"));
    const ev = v2AfterCompleted("shell", "c1");
    ev.result = { output: { exit: 2, status: "completed" }, metadata: { exit: 2 } };
    await h.fire("execute.after", ev);
    const record = p.memory.getTool("shell");
    expect(record?.stats.invocations).toBe(1);
    expect(record?.stats.failures).toBe(0);
    await p.dispose();
  });

  it("attributes an MCP tool call to its server (serverName from ctx.mcp.list)", async () => {
    const p = new AdaptiveMcpPlugin({ dbPath: ":memory:", persistDebounceMs: 0 });
    const h = v2Harness();
    (h.ctx as unknown as { mcp: unknown }).mcp = {
      list: async () => ({ data: [{ name: "headroom" }, { name: "serena" }] }),
    };
    await p.setup(h.ctx);
    await h.fire("execute.before", v2Before("headroom_headroom_compress", "c1"));
    await h.fire("execute.after", v2AfterCompleted("headroom_headroom_compress", "c1"));
    const record = p.memory.getTool("headroom_compress", "headroom");
    expect(record?.stats.invocations).toBe(1);
    await p.dispose();
  });

  it("is guarded against the host calling setup() twice", async () => {
    const h = v2Harness();
    await plugin.setup(h.ctx);
    await plugin.setup(h.ctx); // second registration pass must be a no-op
    expect(h.registrations).toHaveLength(2); // one per hook, not four

    await h.fire("execute.before", v2Before("t", "c1"));
    await h.fire("execute.after", v2AfterCompleted("t", "c1"));
    expect(plugin.memory.getTool("t")?.stats.invocations).toBe(1);
  });

  it("ignores V2 events after dispose instead of throwing", async () => {
    const h = v2Harness();
    await plugin.setup(h.ctx);
    await plugin.dispose();
    await expect(h.fire("execute.before", v2Before("t", "c1"))).resolves.not.toThrow();
    await expect(h.fire("execute.after", v2AfterCompleted("t", "c1"))).resolves.not.toThrow();
  });
});

describe("@adaptivemcp/opencode-plugin — createOpenCodePlugin / default export", () => {
  it("is a dual-shape definition: id + setup + server, no construction at import", () => {
    expect(adaptivePlugin.id).toBe("adaptivemcp");
    expect(adaptivePlugin.setup).toBeTypeOf("function");
    expect(adaptivePlugin.server).toBeTypeOf("function");
    // No AdaptiveMcpPlugin was built by importing the module.
    expect(adaptivePlugin.plugin).toBeUndefined();
  });

  it("constructs the instance lazily on setup with ctx.options applied", async () => {
    const dir = mkdtempSync(join(tmpdir(), "adaptivemcp-plugin-"));
    try {
      const definition = createOpenCodePlugin();
      expect(definition.plugin).toBeUndefined();

      const h = v2Harness({
        dbPath: join(dir, "adaptive.db"),
        yamlPath: join(dir, "tools-metadata.yaml"),
        persistDebounceMs: 0,
        unknownOption: "ignored",
      });
      const cleanup = await definition.setup(h.ctx);
      expect(definition.plugin).toBeInstanceOf(AdaptiveMcpPlugin);

      await h.fire("execute.before", v2Before("read", "c1"));
      await h.fire("execute.after", v2AfterCompleted("read", "c1"));

      // persistDebounceMs: 0 → the derived YAML is on disk right after the call.
      expect(existsSync(join(dir, "tools-metadata.yaml"))).toBe(true);
      expect(existsSync(join(dir, "adaptive.db"))).toBe(true);

      await cleanup();
      // Cleanup disposes the instance and drops the reference for a clean reload.
      expect(definition.plugin).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("server() serves V1 hooks from the same lazily-built instance", async () => {
    const definition = createOpenCodePlugin({ dbPath: ":memory:", persistDebounceMs: 0 });
    const hooks = await definition.server({ directory: "/tmp/work" });
    expect(hooks["tool.execute.before"]).toBeTypeOf("function");
    expect(hooks["tool.execute.after"]).toBeTypeOf("function");
    expect(hooks.event).toBeTypeOf("function");
    expect(hooks.dispose).toBeTypeOf("function");
    expect(definition.plugin).toBeInstanceOf(AdaptiveMcpPlugin);
    await definition.plugin?.dispose();
  });

  it("ignores wrong-typed host options and keeps call options underneath", async () => {
    const definition = createOpenCodePlugin({ dbPath: ":memory:", persistDebounceMs: 0 });
    const h = v2Harness({ dbPath: 42, persistDebounceMs: "fast" });
    await definition.setup(h.ctx);
    // Wrong-typed host values were dropped; the call-level options still apply,
    // so the default in-memory store is used and calls still record.
    expect(definition.plugin).toBeInstanceOf(AdaptiveMcpPlugin);
    await h.fire("execute.before", v2Before("t", "c1"));
    await h.fire("execute.after", v2AfterCompleted("t", "c1"));
    expect(definition.plugin?.memory.getTool("t")?.stats.invocations).toBe(1);
    await definition.plugin?.dispose();
  });
});
