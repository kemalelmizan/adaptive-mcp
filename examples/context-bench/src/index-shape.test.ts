import { describe, it, expect } from "vitest";

import { CORPUS } from "./corpus.js";
import { compiled, idIndex, progressive } from "./strategies.js";
import { TASKS } from "./tasks.js";

const task = TASKS.find((entry) => entry.id === "payments-change")!;

describe("index shape", () => {
  it("carries summaries in the titled index", () => {
    const result = progressive()(task, CORPUS);

    expect(result.text).toContain("api-payments: Payments API reference");
  });

  it("shows ids only in the id-only index — nothing answerable to copy", () => {
    const result = idIndex()(task, CORPUS);

    expect(result.text).toContain("- api-payments");
    expect(result.text).not.toContain("Payments API reference: timeouts");
  });

  it("selects the same documents as the dense strategy", () => {
    // The experiment is only about what the prompt shows: if selection changed, a
    // difference in the tables could not be attributed to the index.
    for (const entry of TASKS) {
      const dense = compiled()(entry, CORPUS);
      const ids = idIndex()(entry, CORPUS);
      expect(ids.loaded, entry.id).toEqual(dense.loaded);
      expect(ids.reads, entry.id).toBe(dense.reads);
      expect(ids.hops, entry.id).toBe(dense.hops);
    }
  });

  it("is much cheaper, because the summaries were most of the prompt", () => {
    const dense = compiled()(task, CORPUS).tokens;
    const ids = idIndex()(task, CORPUS).tokens;

    expect(ids).toBeLessThan(dense / 2);
  });
});
