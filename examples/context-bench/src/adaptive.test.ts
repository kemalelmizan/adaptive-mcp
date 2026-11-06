import { describe, it, expect } from "vitest";
import { MemoryStore } from "@adaptivemcp/memory";

import { adaptive, learnFromTask, seedEdges } from "./adaptive.js";
import { runTask, textIncludesAnswer } from "./bench.js";
import { CORPUS } from "./corpus.js";
import { TASKS } from "./tasks.js";

function store(): MemoryStore {
  const memory = new MemoryStore({ path: ":memory:" });
  seedEdges(memory, CORPUS);
  return memory;
}

describe("answer matching", () => {
  it("does not accept a number inside a longer number", () => {
    // The bug this closed: "5 minutes" matched "15 minutes", so a document about
    // token lifetimes "answered" a question about paging.
    expect(textIncludesAnswer("Access tokens live for 15 minutes", "5 minutes")).toBe(false);
    expect(textIncludesAnswer("Access tokens live for 15 minutes", "15 minutes")).toBe(true);
  });

  it("ignores case and requires a whole token", () => {
    expect(textIncludesAnswer("Never tag by hand.", "never tag by hand")).toBe(true);
    expect(textIncludesAnswer("tagging by hand", "tag by hand")).toBe(false);
  });

  it("treats punctuation in the answer literally", () => {
    expect(
      textIncludesAnswer("written to s3://billing-nightly daily", "s3://billing-nightly"),
    ).toBe(true);
    expect(textIncludesAnswer("written to s3X//billing-nightly", "s3://billing-nightly")).toBe(
      false,
    );
  });
});

describe("adaptive selection", () => {
  it("records the corpus pointers as edges", () => {
    const memory = store();

    expect(memory.contextEdges("api-payments")).toEqual([
      expect.objectContaining({ from: "api-payments", to: "constraint-eu", relation: "requires" }),
    ]);
    expect(memory.contextEdges("billing-export").map((edge) => edge.to)).toEqual([
      "retention-policy",
    ]);
    memory.close();
  });

  it("pins the document that carried an answer, and only that one", () => {
    const memory = store();
    const task = TASKS.find((entry) => entry.id === "payments-change")!;

    learnFromTask(memory, CORPUS, task, ["api-payments", "constraint-eu"]);

    expect(memory.contextLifecycle("constraint-eu")?.pinned).toBe(true);
    expect(memory.contextLifecycle("api-payments")?.pinned).toBeUndefined();
    expect(memory.contextStats().every((stat) => stat.loads === 1)).toBe(true);
    memory.close();
  });

  it("solves the hidden tasks through the edges, without the prior", () => {
    const memory = store();
    const strategy = adaptive(memory, { name: "cold", session: false });

    for (const task of TASKS.filter((entry) => entry.hiddenDependency)) {
      const outcome = runTask(task, CORPUS, strategy);
      expect(outcome.success, task.id).toBe(true);
      expect(outcome.hops, task.id).toBe(1);
      expect(outcome.reads, task.id).toBeLessThanOrEqual(3);
    }
    memory.close();
  });

  it("carries a working set in session mode, and starts clean without it", () => {
    const memory = store();
    const task = TASKS.find((entry) => entry.id === "token-lifetime")!;

    const session = adaptive(memory, { name: "session", session: true });
    runTask(task, CORPUS, session);
    const afterFirst = session.session().length;
    runTask(
      TASKS.find((entry) => entry.id === "refresh-lifetime")!,
      CORPUS,
      session,
    );
    // The second token question needs the same document, so nothing new is read.
    expect(session.session()).toHaveLength(afterFirst);

    const perTask = adaptive(memory, { name: "select", session: false });
    runTask(task, CORPUS, perTask);
    runTask(
      TASKS.find((entry) => entry.id === "vacuum-schedule")!,
      CORPUS,
      perTask,
    );
    expect(perTask.session()).not.toContain("auth-tokens");
    memory.close();
  });
});
