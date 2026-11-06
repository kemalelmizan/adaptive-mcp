import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore } from "./store.js";

describe("context edges", () => {
  let store: MemoryStore;
  let dir: string | undefined;

  beforeEach(() => {
    store = new MemoryStore({ path: ":memory:" });
  });

  afterEach(() => {
    store.close();
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("records a directed edge and reads it back", () => {
    store.recordContextEdge({
      from: "api-payments",
      to: "constraint-eu",
      reason: "EU traffic constraint",
      createdAt: "2026-11-06T00:00:00.000Z",
    });

    expect(store.contextEdges()).toEqual([
      {
        from: "api-payments",
        to: "constraint-eu",
        relation: "requires",
        reason: "EU traffic constraint",
        createdAt: "2026-11-06T00:00:00.000Z",
      },
    ]);
  });

  it("is idempotent per relation: re-recording replaces, it does not pile up", () => {
    store.recordContextEdge({ from: "a", to: "b", reason: "first" });
    store.recordContextEdge({ from: "a", to: "b", reason: "second" });

    expect(store.contextEdges()).toHaveLength(1);
    expect(store.contextEdges()[0]?.reason).toBe("second");
  });

  it("keeps `requires` and `see-also` apart for the same pair", () => {
    store.recordContextEdge({ from: "a", to: "b" });
    store.recordContextEdge({ from: "a", to: "b", relation: "see-also" });

    expect(store.contextEdges().map((edge) => edge.relation)).toEqual(["requires", "see-also"]);
  });

  it("filters by the item an edge leaves, and returns nothing for an unknown item", () => {
    store.recordContextEdge({ from: "a", to: "b" });
    store.recordContextEdge({ from: "b", to: "c" });

    expect(store.contextEdges("b").map((edge) => edge.to)).toEqual(["c"]);
    expect(store.contextEdges("nope")).toEqual([]);
  });

  it("orders deterministically, by from then relation then to", () => {
    store.recordContextEdge({ from: "b", to: "a" });
    store.recordContextEdge({ from: "a", to: "z" });
    store.recordContextEdge({ from: "a", to: "y", relation: "see-also" });

    expect(store.contextEdges().map((edge) => `${edge.from}:${edge.relation}:${edge.to}`)).toEqual([
      "a:requires:z",
      "a:see-also:y",
      "b:requires:a",
    ]);
  });

  it("survives a reopen — an edge is durable state, like a task", () => {
    dir = mkdtempSync(join(tmpdir(), "context-edges-"));
    const path = join(dir, "edges.db");

    const first = new MemoryStore({ path });
    first.recordContextEdge({ from: "api-payments", to: "constraint-eu", relation: "see-also" });
    first.close();

    const second = new MemoryStore({ path });
    try {
      expect(second.contextEdges()).toEqual([
        expect.objectContaining({ from: "api-payments", to: "constraint-eu", relation: "see-also" }),
      ]);
    } finally {
      second.close();
    }
  });
});
