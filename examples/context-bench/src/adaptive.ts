/**
 * Adaptive selection: the P2 experiment, built on what the store already learned.
 *
 * The benchmark's question is whether *selecting* items beats a fixed strategy. To
 * answer it without inventing a new store, this reuses the three P1 shapes:
 *
 * - **edges** (`contextEdges`) for pointers the corpus declares;
 * - **telemetry** (`contextStats`) for what has been loaded, and how often;
 * - **lifecycle** (`contextLifecycle`) for what earned a pin by answering a task.
 *
 * Selection is deliberately a *policy over those records*, not a new subsystem:
 * pinned items first, then the most-loaded, then lexical relevance. Following an
 * edge is immediate, because a pointer is stronger evidence than a term overlap.
 *
 * The strategy is session-scoped: a document read for one task stays in the working
 * set, so a later task that needs it costs no extra read — but the prompt cost is
 * counted cumulatively, because that is what a host actually pays for.
 */
import { MemoryStore } from "@adaptivemcp/memory";

import { textIncludesAnswer } from "./bench.js";

import type { Document } from "./corpus.js";
import type { BenchTask } from "./tasks.js";
import {
  estimateTokens,
  isStale,
  score,
  terms,
  type ContextResult,
  type Strategy,
} from "./strategies.js";

const KIND = "doc";

/** Record the corpus's own pointers as edges. Idempotent, so re-running is free. */
export function seedEdges(store: MemoryStore, corpus: Document[]): void {
  for (const doc of corpus) {
    for (const pointer of doc.seeAlso ?? []) {
      store.recordContextEdge({
        from: doc.id,
        to: pointer,
        relation: "requires",
        reason: "the document says to read this before relying on it",
      });
    }
  }
}

/**
 * What a task taught the store.
 *
 * Called *after* a task is evaluated, so learning never influences the run that
 * produced it. `loaded` is what the strategy actually read; the answering document
 * earns a pin, which is the one rule ADR-005 allowed for `ACTIVE`.
 */
export function learnFromTask(
  store: MemoryStore,
  corpus: Document[],
  task: BenchTask,
  loaded: string[],
): void {
  const byId = new Map(corpus.map((doc) => [doc.id, doc]));
  for (const id of loaded) {
    const doc = byId.get(id);
    if (!doc) continue;
    store.recordContext({
      item: id,
      kind: KIND,
      tokens: estimateTokens(doc.body),
      reason: "read on demand",
    });
    if (doc.body.includes(task.answer)) {
      store.setContextLifecycle({
        item: id,
        kind: KIND,
        state: "active",
        pinned: true,
        reason: "contained an answer",
        updatedAt: new Date().toISOString(),
      });
    }
  }
}

export interface AdaptiveStrategy extends Strategy {
  /** The items the session is carrying, in read order. */
  session(): string[];
  reset(): void;
}

export interface AdaptiveOptions {
  maxReads?: number;
  name?: string;
  /**
   * Keep what earlier tasks read. `false` isolates *selection* from *retention*:
   * the working set starts empty for every task, so the only advantage left is
   * which items get picked and in what order.
   */
  session?: boolean;
}

/**
 * A session-scoped adaptive strategy.
 *
 * `maxReads` bounds one task, not the session: a host that stops reading after N
 * reads for one question may still answer the next one.
 */
export function adaptive(store: MemoryStore, options: AdaptiveOptions = {}): AdaptiveStrategy {
  const { maxReads = 3, name = "adaptive", session = true } = options;
  const loaded: string[] = [];

  const strategy = (task: BenchTask, corpus: Document[]): ContextResult => {
    if (!session) loaded.length = 0;
    const byId = new Map(corpus.map((doc) => [doc.id, doc]));
    const question = terms(task.question);
    const index = corpus.map((doc) => `- ${doc.id}: ${doc.summary}`).join("\n");
    const loads = new Map(store.contextStats().map((stat) => [stat.item, stat.loads]));
    const pinned = new Set(
      store
        .contextLifecycles({ state: "active" })
        .filter((record) => record.pinned)
        .map((record) => record.item),
    );

    let reads = 0;
    let hops = 0;
    // Boundary-aware, like the scorer: `"5 minutes"` is a substring of `"15 minutes"`,
    // so a plain `includes` stops the loop on a document that does not answer.
    const answerInWorkingSet = (): boolean =>
      loaded.some((id) => {
        const body = byId.get(id)?.body;
        return body !== undefined && textIncludesAnswer(body, task.answer);
      });

    const read = (id: string): boolean => {
      if (!byId.has(id) || reads >= maxReads) return false;
      if (loaded.includes(id)) return true; // already in the working set: free
      reads += 1;
      loaded.push(id);
      return true;
    };

    // Relevance dominates; telemetry and pins break ties and nudge known-useful
    // items up. Weighting a pin above relevance made an experienced host *worse*,
    // because a pinned item that matched no term still beat the document that did.
    // Relevance first, then whether the document advertises itself as superseded — a
    // retired document that repeats the question's words is a plausible wrong answer.
    const rank = (id: string, lexical: number): number =>
      lexical * 100 -
      (isStale(byId.get(id)!) ? 20 : 0) +
      (pinned.has(id) ? 5 : 0) +
      Math.min(loads.get(id) ?? 0, 5);

    /** Follow edges transitively; depth is bounded by the read budget. */
    const follow = (id: string): void => {
      for (const edge of store.contextEdges(id)) {
        if (answerInWorkingSet() || reads >= maxReads) return;
        if (loaded.includes(edge.to)) continue;
        if (read(edge.to)) {
          hops += 1;
          follow(edge.to);
        }
      }
    };

    const candidates = corpus
      .map((doc) => ({ id: doc.id, lexical: score(question, `${doc.title} ${doc.summary}`) }))
      .filter((entry) => entry.lexical > 0 || pinned.has(entry.id) || loads.has(entry.id))
      .sort((a, b) => rank(b.id, b.lexical) - rank(a.id, a.lexical) || a.id.localeCompare(b.id))
      .map((entry) => entry.id);

    // A document already in the working set still names pointers, and those targets may
    // not be loaded. Following them costs nothing for the source and one read per target.
    for (const id of [...loaded]) {
      if (!answerInWorkingSet() && reads < maxReads) follow(id);
    }

    while (!answerInWorkingSet() && reads < maxReads) {
      // Skip what the session already carries: re-consulting a loaded document costs a
      // turn without adding evidence, and with a full working set it stalls the loop.
      const position = candidates.findIndex((id) => !loaded.includes(id));
      if (position === -1) break;
      const next = candidates.splice(position, 1)[0]!;
      if (!read(next)) break;
      // A pointer is stronger evidence than a term overlap: follow it now.
      follow(next);
    }

    // The prompt carries the index plus the whole working set, so its cost is the
    // session's cost, not just this task's reads.
    const text = [index, ...loaded.map((id) => byId.get(id)?.body ?? "")].join("\n\n");
    return {
      strategy: name,
      text,
      loaded: [...loaded],
      reads,
      hops,
      tokens: estimateTokens(text),
    };
  };

  return Object.assign(strategy, {
    session: (): string[] => [...loaded],
    reset: (): void => {
      loaded.length = 0;
    },
  });
}
