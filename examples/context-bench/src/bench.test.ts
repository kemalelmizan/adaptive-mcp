import { describe, it, expect } from "vitest";
import { runTask, summarise } from "./bench.js";
import { CORPUS } from "./corpus.js";
import { allUpfront, lexical, progressive, terms } from "./strategies.js";
import { TASKS } from "./tasks.js";

const hiddenTask = TASKS.find((task) => task.hiddenDependency)!;
const hiddenDoc = CORPUS.find((doc) => doc.id === hiddenTask.answerIn)!;

describe("context bench", () => {
  it("has a genuinely hidden dependency: the answering document shares no terms with the question", () => {
    const asked = terms(hiddenTask.question);
    const inIndex = terms(`${hiddenDoc.title} ${hiddenDoc.summary}`);
    const overlap = [...inIndex].filter((term) => asked.has(term));

    // If this ever stops being true, the benchmark stops testing what it claims.
    expect(overlap).toEqual([]);
  });

  it("loads everything upfront: every task is answerable, at full cost", () => {
    const outcomes = TASKS.map((task) => runTask(task, CORPUS, allUpfront));

    expect(outcomes.every((outcome) => outcome.success)).toBe(true);
    expect(outcomes.every((outcome) => outcome.loaded.length === CORPUS.length)).toBe(true);
    expect(outcomes.every((outcome) => outcome.pollution > 0.8)).toBe(true);
  });

  it("finds the direct answers lexically, but not the hidden dependency", () => {
    const outcomes = TASKS.map((task) => runTask(task, CORPUS, lexical()));
    const hidden = outcomes.find((outcome) => outcome.taskId === hiddenTask.id)!;

    expect(outcomes.filter((outcome) => !outcome.hidden).every((outcome) => outcome.success)).toBe(
      true,
    );
    expect(hidden.success).toBe(false);
    expect(hidden.requiredLoaded).toBe(false);
  });

  it("reaches the hidden dependency through the pointer, and keeps the cost down", () => {
    const outcomes = TASKS.map((task) => runTask(task, CORPUS, progressive()));
    const hidden = outcomes.find((outcome) => outcome.taskId === hiddenTask.id)!;

    expect(outcomes.every((outcome) => outcome.success)).toBe(true);
    // The pointer is what makes it reachable: one read to find it, one to follow.
    expect(hidden.reads).toBe(2);
    expect(hidden.hops).toBe(1);
    // And it does not read the whole corpus to get there.
    expect(hidden.loaded.length).toBeLessThan(CORPUS.length);
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
