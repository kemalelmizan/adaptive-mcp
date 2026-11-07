/**
 * The deterministic run behind the published table.
 *
 * Extracted from `run.ts` so the numbers in `README.md` can be pinned by a test
 * instead of living only in prose. The runner and the test now share one code path,
 * which is the point: a strategy that drifts cannot keep a stale row in the docs.
 *
 * The order matters. `adaptive-cold`, `adaptive-warm` and `adaptive-select` share one
 * store, and each pass learns after measuring, so a task never benefits from what it
 * just taught. Reordering them would change the recorded numbers, not just their
 * presentation.
 */
import { MemoryStore } from "@adaptivemcp/memory";
import { runTask, type TaskOutcome } from "./bench.js";
import { CORPUS } from "./corpus.js";
import { adaptive, learnFromTask, seedEdges } from "./adaptive.js";
import { allUpfront, compiled, idIndex, lexical, progressive } from "./strategies.js";
import { TASKS } from "./tasks.js";

/** A pass with the adaptive strategy, learning after each task. */
function adaptivePass(
  store: MemoryStore,
  label: string,
  options: { session: boolean },
): TaskOutcome[] {
  const strategy = adaptive(store, { name: label, session: options.session });
  return TASKS.map((task) => {
    const before = new Set(strategy.session());
    const outcome = runTask(task, CORPUS, strategy);
    const learned = strategy.session().filter((id) => !before.has(id));
    learnFromTask(store, CORPUS, task, learned);
    return outcome;
  });
}

/** Every deterministic (no model) outcome, in the order the table prints them. */
export function deterministicOutcomes(): TaskOutcome[] {
  const fixed: TaskOutcome[] = [
    allUpfront,
    lexical(),
    progressive(),
    compiled(),
    idIndex(),
  ].flatMap((strategy) => TASKS.map((task) => runTask(task, CORPUS, strategy)));

  const store = new MemoryStore({ path: ":memory:" });
  try {
    seedEdges(store, CORPUS);
    return [
      ...fixed,
      ...adaptivePass(store, "adaptive-cold", { session: true }),
      ...adaptivePass(store, "adaptive-warm", { session: true }),
      // Selection alone: a warm prior, but no carry-over between tasks, so the token
      // column is directly comparable with the fixed strategies'.
      ...adaptivePass(store, "adaptive-select", { session: false }),
    ];
  } finally {
    store.close();
  }
}
