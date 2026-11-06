import { describe, it, expect } from "vitest";
import { runTask, summarise } from "./bench.js";
import { CORPUS } from "./corpus.js";
import { allUpfront, lexical, progressive, terms } from "./strategies.js";
import { TASKS } from "./tasks.js";

const hiddenTasks = TASKS.filter((task) => task.hiddenDependency);
const directTasks = TASKS.filter((task) => !task.hiddenDependency);

describe("context bench", () => {
  it("has genuinely hidden dependencies: neither answer document shares a term with its question", () => {
    expect(hiddenTasks).toHaveLength(2);
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

  it("finds every direct answer lexically, and neither hidden dependency", () => {
    const outcomes = TASKS.map((task) => runTask(task, CORPUS, lexical()));
    const byId = new Map(outcomes.map((outcome) => [outcome.taskId, outcome]));

    for (const task of directTasks) expect(byId.get(task.id)?.success, task.id).toBe(true);
    for (const task of hiddenTasks) {
      expect(byId.get(task.id)?.success, task.id).toBe(false);
      expect(byId.get(task.id)?.requiredLoaded, task.id).toBe(false);
    }
  });

  it("reaches both hidden dependencies through pointers, and keeps the cost down", () => {
    const outcomes = TASKS.map((task) => runTask(task, CORPUS, progressive()));
    const byId = new Map(outcomes.map((outcome) => [outcome.taskId, outcome]));

    expect(outcomes.every((outcome) => outcome.success)).toBe(true);
    for (const task of hiddenTasks) {
      const outcome = byId.get(task.id)!;
      // One read to find it, one to follow the pointer.
      expect(outcome.reads, task.id).toBe(2);
      expect(outcome.hops, task.id).toBe(1);
      expect(outcome.loaded.length, task.id).toBeLessThan(CORPUS.length);
    }
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
