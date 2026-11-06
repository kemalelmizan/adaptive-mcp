import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MemoryStore } from "./store.js";

const AT = "2026-11-06T00:00:00.000Z";

describe("context lifecycle", () => {
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

  it("round-trips a record with only its required fields", () => {
    store.setContextLifecycle({ item: "base", kind: "section", state: "active", updatedAt: AT });

    expect(store.contextLifecycle("base")).toEqual({
      item: "base",
      kind: "section",
      state: "active",
      updatedAt: AT,
    });
  });

  it("keeps every optional field it was given", () => {
    store.setContextLifecycle({
      item: "notes",
      kind: "resource",
      state: "archived",
      pinned: true,
      expiresAt: "2027-01-01T00:00:00.000Z",
      archivedAt: AT,
      reason: "superseded by v2",
      updatedAt: AT,
    });

    expect(store.contextLifecycle("notes")).toEqual({
      item: "notes",
      kind: "resource",
      state: "archived",
      pinned: true,
      expiresAt: "2027-01-01T00:00:00.000Z",
      archivedAt: AT,
      reason: "superseded by v2",
      updatedAt: AT,
    });
  });

  it("replaces rather than accumulates: the record is the current decision", () => {
    store.setContextLifecycle({ item: "base", kind: "section", state: "active", updatedAt: AT });
    store.setContextLifecycle({
      item: "base",
      kind: "section",
      state: "archived",
      archivedAt: AT,
      reason: "expired",
      updatedAt: "2026-11-07T00:00:00.000Z",
    });

    expect(store.contextLifecycles()).toHaveLength(1);
    expect(store.contextLifecycle("base")).toMatchObject({
      state: "archived",
      reason: "expired",
      updatedAt: "2026-11-07T00:00:00.000Z",
    });
  });

  it("clears a pin when a later record says it is unpinned", () => {
    store.setContextLifecycle({
      item: "base",
      kind: "section",
      state: "active",
      pinned: true,
      updatedAt: AT,
    });
    store.setContextLifecycle({ item: "base", kind: "section", state: "active", updatedAt: AT });

    // `pinned: false` is the same as absent — an unpinned record has no pin field.
    expect(store.contextLifecycle("base")?.pinned).toBeUndefined();
  });

  it("filters by state, and returns records in item order", () => {
    store.setContextLifecycle({ item: "z", kind: "skill", state: "archived", updatedAt: AT });
    store.setContextLifecycle({ item: "a", kind: "section", state: "active", updatedAt: AT });
    store.setContextLifecycle({ item: "m", kind: "resource", state: "active", updatedAt: AT });

    expect(store.contextLifecycles().map((record) => record.item)).toEqual(["a", "m", "z"]);
    expect(store.contextLifecycles({ state: "active" }).map((record) => record.item)).toEqual([
      "a",
      "m",
    ]);
    expect(store.contextLifecycles({ state: "archived" }).map((record) => record.item)).toEqual([
      "z",
    ]);
  });

  it("returns undefined for an item it has never seen", () => {
    expect(store.contextLifecycle("nothing")).toBeUndefined();
    expect(store.contextLifecycles()).toEqual([]);
  });

  it("keeps a pinned record pinned until it is explicitly rewritten", () => {
    store.setContextLifecycle({
      item: "base",
      kind: "section",
      state: "active",
      pinned: true,
      updatedAt: AT,
    });
    store.setContextLifecycle({ item: "other", kind: "skill", state: "active", updatedAt: AT });

    expect(store.contextLifecycle("base")?.pinned).toBe(true);
  });

  it("survives a reopen — retention is durable state, not a cache", () => {
    dir = mkdtempSync(join(tmpdir(), "context-lifecycle-"));
    const path = join(dir, "lifecycle.db");

    const first = new MemoryStore({ path });
    first.setContextLifecycle({
      item: "notes",
      kind: "resource",
      state: "archived",
      pinned: true,
      archivedAt: AT,
      updatedAt: AT,
    });
    first.close();

    const second = new MemoryStore({ path });
    try {
      expect(second.contextLifecycle("notes")).toEqual({
        item: "notes",
        kind: "resource",
        state: "archived",
        pinned: true,
        archivedAt: AT,
        updatedAt: AT,
      });
    } finally {
      second.close();
    }
  });

  it("stores records independently of edges and loads", () => {
    store.recordContext({ item: "api-payments", kind: "doc" });
    store.recordContextEdge({ from: "api-payments", to: "constraint-eu" });
    store.setContextLifecycle({
      item: "api-payments",
      kind: "doc",
      state: "active",
      updatedAt: AT,
    });

    expect(store.contextStats().map((stat) => stat.item)).toEqual(["api-payments"]);
    expect(store.contextEdges()).toHaveLength(1);
    expect(store.contextLifecycles()).toHaveLength(1);
  });
});
