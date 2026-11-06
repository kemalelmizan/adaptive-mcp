/**
 * Turning one (task, strategy) pair into a row, and rows into a table.
 *
 * The metrics are defined narrowly so they cannot flatter a strategy:
 * - **success**: the exact answering string is in the context (availability);
 * - **recall**: the required document was loaded;
 * - **precision**: 1/loaded when the required document is among them, else 0;
 * - **pollution**: the share of loaded documents that were not required;
 * - **tokens**: the estimated context size — what the strategy costs;
 * - **reads / hops**: retrieval calls, and how many were caused by a pointer.
 */
import type { Document } from "./corpus.js";
import type { BenchTask } from "./tasks.js";
import type { Strategy } from "./strategies.js";

export interface TaskOutcome {
  taskId: string;
  strategy: string;
  hidden: boolean;
  success: boolean;
  tokens: number;
  precision: number;
  recall: number;
  reads: number;
  hops: number;
  pollution: number;
  loaded: string[];
  requiredLoaded: boolean;
}

export function runTask(task: BenchTask, corpus: Document[], strategy: Strategy): TaskOutcome {
  const result = strategy(task, corpus);
  const fact = corpus.find((doc) => doc.id === task.answerIn)?.fact;
  const requiredLoaded = result.loaded.includes(task.answerIn);
  const loaded = result.loaded.length;
  return {
    taskId: task.id,
    strategy: result.strategy,
    hidden: task.hiddenDependency === true,
    success: fact !== undefined && result.text.includes(fact),
    tokens: result.tokens,
    precision: loaded === 0 ? 0 : (requiredLoaded ? 1 : 0) / loaded,
    recall: requiredLoaded ? 1 : 0,
    reads: result.reads,
    hops: result.hops,
    pollution: loaded === 0 ? 0 : (loaded - (requiredLoaded ? 1 : 0)) / loaded,
    loaded: result.loaded,
    requiredLoaded,
  };
}

export interface StrategySummary {
  strategy: string;
  passed: number;
  total: number;
  tokens: number;
  precision: number;
  recall: number;
  reads: number;
  hops: number;
  pollution: number;
}

/** Mean over tasks — one row per strategy. */
export function summarise(outcomes: TaskOutcome[]): StrategySummary[] {
  const byStrategy = new Map<string, TaskOutcome[]>();
  for (const outcome of outcomes) {
    const group = byStrategy.get(outcome.strategy) ?? [];
    group.push(outcome);
    byStrategy.set(outcome.strategy, group);
  }
  const mean = (values: number[]): number =>
    values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
  return [...byStrategy.entries()].map(([strategy, group]) => ({
    strategy,
    passed: group.filter((outcome) => outcome.success).length,
    total: group.length,
    tokens: Math.round(mean(group.map((outcome) => outcome.tokens))),
    precision: mean(group.map((outcome) => outcome.precision)),
    recall: mean(group.map((outcome) => outcome.recall)),
    reads: mean(group.map((outcome) => outcome.reads)),
    hops: mean(group.map((outcome) => outcome.hops)),
    pollution: mean(group.map((outcome) => outcome.pollution)),
  }));
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

export function formatTable(summaries: StrategySummary[]): string {
  const rows = [
    ["strategy", "pass", "tokens", "precision", "recall", "reads", "hops", "pollution"],
    ...summaries.map((summary) => [
      summary.strategy,
      `${summary.passed}/${summary.total}`,
      String(summary.tokens),
      summary.precision.toFixed(2),
      summary.recall.toFixed(2),
      summary.reads.toFixed(1),
      summary.hops.toFixed(1),
      summary.pollution.toFixed(2),
    ]),
  ];
  const widths = [18, 6, 8, 10, 7, 6, 5, 10];
  return rows
    .map((row) => row.map((cell, index) => pad(cell, widths[index] ?? 8)).join(" "))
    .join("\n");
}
