#!/usr/bin/env node
/**
 * Run the context benchmark and print the table.
 *
 *   pnpm --filter @adaptivemcp/context-bench bench
 *   pnpm --filter @adaptivemcp/context-bench bench -- --model http://127.0.0.1:8080/v1 --model-name local
 *
 * The deterministic run is the default and always runs offline. `--model` adds a
 * second table from a real OpenAI-compatible endpoint, using the same contexts — that
 * is the only way to see whether a strategy's advantage survives contact with a model.
 */
import { formatTable, runTask, summarise, type TaskOutcome } from "./bench.js";
import { CORPUS } from "./corpus.js";
import { deterministicOutcomes } from "./deterministic.js";
import { answersCorrectly, askModel, modelFromEnv } from "./model.js";
import { adaptive, learnFromTask, seedEdges } from "./adaptive.js";
import { representationRatio } from "./representation.js";
import { profileFromEnv, policyFor, routed } from "./routing.js";
import { allUpfront, compiled, idIndex, lexical, progressive } from "./strategies.js";
import { TASKS } from "./tasks.js";
import { MemoryStore } from "@adaptivemcp/memory";

const argv = process.argv.slice(2);
// Shared with `deterministic.test.ts`, which pins the table printed below.
const outcomes: TaskOutcome[] = deterministicOutcomes();

console.log(`context-bench — ${TASKS.length} tasks, ${CORPUS.length} documents\n`);
console.log(formatTable(summarise(outcomes)));
console.log(
  `\nrepresentation: dense keeps ${Math.round(representationRatio(CORPUS, "dense") * 100)}% of body characters`,
);

// Detail for the cases that carry the argument: the hidden dependency, and any miss.
const interesting = outcomes.filter((outcome) => outcome.hidden || !outcome.success);
if (interesting.length > 0) {
  console.log("\ndetail");
  for (const outcome of interesting) {
    const status = outcome.success ? "ok" : "MISS";
    console.log(
      `  ${outcome.strategy.padEnd(18)} ${outcome.taskId.padEnd(16)} ${status.padEnd(5)} ` +
        `loaded=[${outcome.loaded.join(", ")}] reads=${outcome.reads} hops=${outcome.hops}`,
    );
  }
}

const model = modelFromEnv(argv);
if (model) {
  const profile = profileFromEnv(argv);
  console.log(
    `\nmodel: ${model.model} at ${model.baseURL}${model.strict ? " (strict answers)" : ""}` +
      `\nrouted: ${profile} → ${policyFor(profile)} the working set`,
  );
  interface LiveRow {
    strategy: string;
    taskId: string;
    hidden: boolean;
    ok: boolean;
    tokens: number;
    durationMs: number;
    answer: string;
  }
  const live: LiveRow[] = [];
  // A fresh warm session for the model half: a silent training pass, then a new
  // working set, so the model sees what a returning host would see.
  const liveStore = new MemoryStore({ path: ":memory:" });
  seedEdges(liveStore, CORPUS);
  const trainer = adaptive(liveStore, { name: "adaptive-warm" });
  for (const task of TASKS) {
    const before = new Set(trainer.session());
    runTask(task, CORPUS, trainer);
    learnFromTask(
      liveStore,
      CORPUS,
      task,
      trainer.session().filter((id) => !before.has(id)),
    );
  }
  // The routed arm: the policy the declared capability selects, so the table shows what
  // a host that knows its model would actually do.
  const liveStrategies = [
    allUpfront,
    lexical(),
    progressive(),
    compiled(),
    idIndex(),
    adaptive(liveStore, { name: "adaptive-warm" }),
    routed(profile, {
      retain: adaptive(liveStore, { name: "routed", session: true }),
      fresh: progressive(),
    }),
  ];
  for (const strategy of liveStrategies) {
    for (const task of TASKS) {
      const result = strategy(task, CORPUS);
      const answer = await askModel(model, result.text, task.question);
      live.push({
        strategy: result.strategy,
        taskId: task.id,
        hidden: task.hiddenDependency === true,
        ok: answersCorrectly(answer.text, task.answer),
        tokens: result.tokens,
        durationMs: answer.durationMs,
        answer: answer.text.replace(/\s+/g, " ").slice(0, 80),
      });
    }
  }

  const rows = [["strategy", "pass", "tokens", "mean ms"], ...summariseLive(live)];
  const widths = [18, 6, 8, 9];
  console.log(
    "\n" +
      rows
        .map((row) =>
          row
            .map((cell, index) =>
              (cell + " ".repeat(widths[index] ?? 8)).slice(0, widths[index] ?? 8),
            )
            .join(" "),
        )
        .join("\n"),
  );

  const misses = live.filter((row) => !row.ok);
  if (misses.length > 0) {
    console.log("\nmodel misses");
    for (const miss of misses) {
      console.log(
        `  ${miss.strategy.padEnd(18)} ${miss.taskId.padEnd(16)} ` +
          `${miss.hidden ? "(hidden) " : ""}answered "${miss.answer}"`,
      );
    }
  }
}

/** Group live rows by strategy: pass count, token cost, mean latency. */
function summariseLive(
  live: Array<{ strategy: string; ok: boolean; tokens: number; durationMs: number }>,
): string[][] {
  const byStrategy = new Map<string, typeof live>();
  for (const row of live) {
    const group = byStrategy.get(row.strategy) ?? [];
    group.push(row);
    byStrategy.set(row.strategy, group);
  }
  return [...byStrategy.entries()].map(([strategy, group]) => [
    strategy,
    `${group.filter((row) => row.ok).length}/${group.length}`,
    String(Math.round(group.reduce((sum, row) => sum + row.tokens, 0) / group.length)),
    String(Math.round(group.reduce((sum, row) => sum + row.durationMs, 0) / group.length)),
  ]);
}
