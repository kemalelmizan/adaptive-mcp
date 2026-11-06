import { describe, it, expect } from "vitest";
import { runTask, summarise } from "./bench.js";
import { CORPUS } from "./corpus.js";
import { allUpfront, lexical, progressive, terms } from "./strategies.js";
import { TASKS } from "./tasks.js";

const hiddenTasks = TASKS.filter((task) => task.hiddenDependency);

/** The catalog chain is the only two-hop route in this pack. */
const hopDepth = (taskId: string): number => (taskId === "catalog-change" ? 2 : 1);

describe("context bench", () => {
  it("has genuinely hidden dependencies: no answer document shares a term with its question", () => {
    expect(hiddenTasks).toHaveLength(3);
    for (const task of hiddenTasks) {
      const doc = CORPUS.find((entry) => entry.id === task.answerIn)!;
      const asked = terms(task.question);
      const inIndex = terms(`${doc.title} ${doc.summary}`);
      const overlap = [...inIndex].filter((term) => asked.has(term));

      // If this stops being true, the benchmark stops testing what it claims.
      expect(overlap, task.id).toEqual([]);
    }
  });

  it("loads everything upfront: every task is answerable, at full cost", () => {
    const outcomes = TASKS.map((task) => runTask(task, CORPUS, allUpfront));

    expect(outcomes.every((outcome) => outcome.success)).toBe(true);
    expect(outcomes.every((outcome) => outcome.loaded.length === CORPUS.length)).toBe(true);
    expect(outcomes.every((outcome) => outcome.pollution > 0.8)).toBe(true);
  });

  it("cannot reach any hidden dependency by similarity alone", () => {
    const outcomes = TASKS.map((task) => runTask(task, CORPUS, lexical()));
    const byId = new Map(outcomes.map((outcome) => [outcome.taskId, outcome]));

    for (const task of hiddenTasks) {
      expect(byId.get(task.id)?.success, task.id).toBe(false);
      expect(byId.get(task.id)?.requiredLoaded, task.id).toBe(false);
    }
  });

  it("is defeated by vocabulary overlap on at least one direct question", () => {
    // The legacy distractors share the question's words and hold the wrong value, so a
    // term-overlap ranker picks them. That is the second half of the argument: similarity
    // is neither necessary (hidden tasks) nor sufficient (this).
    const outcomes = TASKS.map((task) => runTask(task, CORPUS, lexical()));
    const defeated = outcomes.filter((outcome) => !outcome.hidden && !outcome.success);

    expect(defeated.length).toBeGreaterThan(0);
    for (const outcome of defeated) expect(outcome.requiredLoaded).toBe(false);
  });

  it("reaches every hidden dependency through pointers, including the second hop", () => {
    const outcomes = TASKS.map((task) => runTask(task, CORPUS, progressive()));
    const byId = new Map(outcomes.map((outcome) => [outcome.taskId, outcome]));

    expect(outcomes.every((outcome) => outcome.success)).toBe(true);
    for (const task of hiddenTasks) {
      const outcome = byId.get(task.id)!;
      const depth = hopDepth(task.id);
      // One read per document on the chain, starting from the one the question matches.
      expect(outcome.reads, task.id).toBe(depth + 1);
      expect(outcome.hops, task.id).toBe(depth);
      expect(outcome.loaded.length, task.id).toBeLessThan(CORPUS.length);
    }
  });

  it("has a real second hop: the question-matching document does not point at the answer", () => {
    const api = CORPUS.find((doc) => doc.id === "catalog-api")!;
    const constraints = CORPUS.find((doc) => doc.id === "catalog-constraints")!;

    expect(api.seeAlso).not.toContain("catalog-approval");
    expect(constraints.seeAlso).toContain("catalog-approval");
  });

  it("costs less than loading everything, across the pack", () => {
    const strategies = [allUpfront, lexical(), progressive()];
    const summaries = summarise(
      strategies.flatMap((strategy) => TASKS.map((task) => runTask(task, CORPUS, strategy))),
    );
    const upfront = summaries.find((summary) => summary.strategy === "all-upfront")!;
    const progressiveSummary = summaries.find((summary) => summary.strategy === "progressive")!;

    expect(progressiveSummary.tokens).toBeLessThan(upfront.tokens);
    expect(progressiveSummary.passed).toBe(upfront.passed);
    expect(progressiveSummary.pollution).toBeLessThan(upfront.pollution);
  });
});
