import { describe, it, expect } from "vitest";

import { CORPUS } from "./corpus.js";
import { renderDocument, representationRatio } from "./representation.js";
import { TASKS } from "./tasks.js";

const byId = (id: string) => CORPUS.find((doc) => doc.id === id)!;

describe("representation", () => {
  it("leaves the body untouched at full fidelity", () => {
    for (const doc of CORPUS) expect(renderDocument(doc, "full")).toBe(doc.body);
  });

  it("keeps every answering fact at dense fidelity", () => {
    // The representation must not destroy the evidence: if it did, every table would
    // be measuring the renderer's omissions rather than the strategy.
    for (const task of TASKS) {
      const doc = byId(task.answerIn);
      expect(renderDocument(doc, "dense"), task.id).toContain(task.answer);
    }
  });

  it("drops narrative around the facts", () => {
    const dense = renderDocument(byId("api-payments"), "dense");

    expect(dense).toContain("900ms");
    expect(dense).not.toContain("see the pointer below");
  });

  it("does not shred a numbered list into bare ordinals", () => {
    const dense = renderDocument(byId("runbook-deploy"), "dense");

    // The trap: "1. Build. 2. Tag." splits into "1.", "2." on punctuation alone.
    expect(dense).toContain("Never tag by hand");
    expect(dense).not.toMatch(/^[\d.\s]+$/);
  });

  it("keeps a body whole when nothing in it looks like a fact", () => {
    const doc = byId("auth-tokens-legacy");
    expect(renderDocument(doc, "dense")).toBe(doc.body);
  });

  it("is smaller than the full corpus, but not by much — the bodies are already terse", () => {
    const ratio = representationRatio(CORPUS, "dense");

    expect(ratio).toBeLessThan(1);
    expect(ratio).toBeGreaterThan(0.5);
  });
});
