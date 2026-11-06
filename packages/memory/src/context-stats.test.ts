import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { CONTEXT_SCOPE, MemoryStore } from "./store.js";

describe("context telemetry", () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore({ path: ":memory:" });
  });

  afterEach(() => {
    store.close();
  });

  it("folds loads into per-item counters, most-loaded first", () => {
    store.recordContext({ item: "skills", kind: "skills", tokens: 30, reason: "listing" });
    store.recordContext({ item: "skills", kind: "skills", tokens: 30 });
    store.recordContext({ item: "base", kind: "base", tokens: 17 });

    expect(store.contextStats()).toEqual([
      { item: "skills", kind: "skills", loads: 2, tokens: 60, lastSeen: expect.any(String) },
      { item: "base", kind: "base", loads: 1, tokens: 17, lastSeen: expect.any(String) },
    ]);
  });

  it("keeps kinds apart: the same id in two kinds is two rows", () => {
    store.recordContext({ item: "notes", kind: "resource" });
    store.recordContext({ item: "notes", kind: "skill" });

    expect(store.contextStats().map((stat) => `${stat.kind}:${stat.item}`)).toEqual([
      "resource:notes",
      "skill:notes",
    ]);
  });

  it("does not create a tool record or tool cells — context is not a tool", () => {
    store.recordContext({ item: "base", kind: "base", tokens: 17 });

    expect(store.getTool(CONTEXT_SCOPE)).toBeUndefined();
    expect(store.allTools()).toEqual([]);
    expect(store.metricCells({ toolName: CONTEXT_SCOPE })).toHaveLength(1);
    expect(store.metricCells({ toolName: "base" })).toEqual([]);
  });

  it("counts a load that reports no tokens", () => {
    store.recordContext({ item: "resource:notes.md", kind: "resource" });

    expect(store.contextStats()[0]).toMatchObject({ loads: 1, tokens: 0 });
  });

  it("stays bounded: repeated loads fold into one cell", () => {
    for (let i = 0; i < 50; i += 1) {
      store.recordContext({ item: "skills", kind: "skills", tokens: 1 });
    }

    expect(store.metricCells({ toolName: CONTEXT_SCOPE })).toHaveLength(1);
    expect(store.contextStats()[0]).toMatchObject({ loads: 50, tokens: 50 });
  });

  it("returns nothing for a store that never recorded a context load", () => {
    expect(store.contextStats()).toEqual([]);
  });
});
