import { describe, it, expect } from "vitest";
import { MemoryStore } from "@adaptivemcp/memory";
import { MiddlewareChain } from "./chain.js";
import { HeadroomMiddleware } from "./headroom.js";
import type { Compressor } from "./compressor.js";
import type { Middleware, PlannedCall } from "./middleware.js";

const store = new MemoryStore({ path: ":memory:" });

function makeChain(): MiddlewareChain {
  return new MiddlewareChain({ store, toolName: "run_shell_command", serverName: "srv" });
}

describe("@adaptivemcp/middleware chain", () => {
  it("runs beforeCall in registration order and afterCall in reverse", async () => {
    const order: string[] = [];
    const a: Middleware = {
      name: "a",
      beforeCall: (c) => { order.push(`a:before:${c.input}`); },
      afterCall: (_r, c) => { order.push(`a:after:${c.output}`); },
    };
    const b: Middleware = {
      name: "b",
      beforeCall: (c) => { order.push(`b:before:${c.input}`); },
      afterCall: (_r, c) => { order.push(`b:after:${c.output}`); },
    };
    const chain = makeChain().use(a).use(b);
    const call: PlannedCall = { toolName: "run_shell_command", input: "in" };
    await chain.runBefore(call);
    call.output = "out";
    await chain.runAfter({ ok: true }, call);
    expect(order).toEqual(["a:before:in", "b:before:in", "b:after:out", "a:after:out"]);
  });

  it("collects contributeView fragments keyed by name", async () => {
    const chain = makeChain().use({ name: "x", contributeView: () => ({ ok: 1 }) });
    expect(chain.contributeView()).toEqual({ x: { ok: 1 } });
  });

  it("HeadroomMiddleware compresses string output and surfaces hash", async () => {
    const compressor: Compressor = {
      compress: async (content) => ({
        compressed: `<compressed ${content.length}>`,
        hash: "h123",
        savingsPercent: 50,
      }),
    };
    const mw = new HeadroomMiddleware({ compressor });
    const call: PlannedCall = { toolName: "run_shell_command", input: {}, output: "a".repeat(100) };
    await mw.afterCall({ ok: true }, call, { store, toolName: "run_shell_command" });
    expect(call.output).toBe("<compressed 100>");
    expect(mw.contributeView()).toEqual({ hash: "h123", savingsPercent: 50 });
  });

  it("HeadroomMiddleware passes through original output on compressor failure (D9)", async () => {
    const compressor: Compressor = {
      compress: async () => { throw new Error("down"); },
    };
    const mw = new HeadroomMiddleware({ compressor });
    const call: PlannedCall = { toolName: "run_shell_command", input: {}, output: "original" };
    await mw.afterCall({ ok: true }, call, { store, toolName: "run_shell_command" });
    expect(call.output).toBe("original");
    expect(mw.contributeView()).toEqual({ error: "down" });
  });

  it("HeadroomMiddleware skips non-string output", async () => {
    const compressor: Compressor = { compress: async () => { throw new Error("should not run"); } };
    const mw = new HeadroomMiddleware({ compressor });
    const call: PlannedCall = { toolName: "t", input: {}, output: { json: true } };
    await mw.afterCall({ ok: true }, call, { store, toolName: "t" });
    expect(call.output).toEqual({ json: true });
    expect(mw.contributeView()).toEqual({ skipped: true });
  });
});
