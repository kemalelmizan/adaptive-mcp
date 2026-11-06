/**
 * Three ways to decide what the model sees, over the same corpus.
 *
 * These are *mechanics*, not models: the "agent" here is an oracle that knows which
 * fact answers the task and stops when it has it. That is deliberate — it isolates
 * whether a strategy makes the information available and what it costs, with no
 * sampling noise. Whether a real model uses it well is a separate question, and the
 * harness says so rather than pretending otherwise.
 */
import type { Document } from "./corpus.js";
import { renderDocument, type Representation } from "./representation.js";
import type { BenchTask } from "./tasks.js";

export interface ContextResult {
  strategy: string;
  /** What would be put in the prompt. */
  text: string;
  /** Document ids whose bodies entered the context. */
  loaded: string[];
  /** Retrieval calls made (searches and reads). */
  reads: number;
  /** Reads caused by following a pointer. */
  hops: number;
  tokens: number;
}

export type Strategy = (task: BenchTask, corpus: Document[]) => ContextResult;

/** Roughly four characters per token; the same estimate the host prints. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "does",
  "what",
  "when",
  "how",
  "long",
  "are",
  "is",
  "a",
  "an",
  "of",
  "to",
  "in",
  "on",
  "it",
  "must",
  "before",
  "with",
  "that",
  "this",
]);

/** Crude stemming: enough to match "tokens" with "token" without a parser. */
function stem(term: string): string {
  return term.length > 3 && term.endsWith("s") ? term.slice(0, -1) : term;
}

export function terms(text: string): Set<string> {
  const found = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 3 || STOPWORDS.has(raw)) continue;
    found.add(stem(raw));
  }
  return found;
}

/**
 * Whether a document advertises itself as superseded.
 *
 * Corpora do carry this mark in the name — `legacy`, `deprecated`, `retired`,
 * `superseded` — and a retired document that repeats the current question's words is the
 * most expensive kind of distractor: it matches, it is plausible, and its answer is
 * wrong. The signal is a naming convention, not semantics: a corpus without such labels
 * gets no benefit from this, which is why it is a tie-break rather than a filter.
 */
export function isStale(doc: Document): boolean {
  return /\b(legacy|deprecated|retired|superseded|obsolete)\b/i.test(
    `${doc.id} ${doc.title} ${doc.summary}`,
  );
}

/** How many distinct question terms a document's text contains. */
export function score(question: Set<string>, text: string): number {
  let hits = 0;
  for (const term of terms(text)) if (question.has(term)) hits += 1;
  return hits;
}

/** Every document's body, in one prompt. The cost baseline. */
export const allUpfront: Strategy = (task, corpus) => {
  const text = corpus.map((doc) => renderDocument(doc, "full")).join("\n\n");
  return {
    strategy: "all-upfront",
    text,
    loaded: corpus.map((doc) => doc.id),
    reads: 0,
    hops: 0,
    tokens: estimateTokens(text),
  };
};

/**
 * Rank documents by term overlap with the question and take the best few.
 *
 * Zero-score documents are **not** returned: a retriever that pads its top-k with
 * irrelevant documents would look better on recall by accident, and worse on
 * pollution on purpose.
 */
export function lexical(topK = 3): Strategy {
  return (task, corpus) => {
    const question = terms(task.question);
    const ranked = corpus
      .map((doc) => ({ doc, score: score(question, `${doc.title} ${doc.summary} ${doc.body}`) }))
      .filter((entry) => entry.score > 0)
      .sort(
        (a, b) =>
          b.score - a.score ||
          Number(isStale(a.doc)) - Number(isStale(b.doc)) ||
          a.doc.id.localeCompare(b.doc.id),
      )
      .slice(0, topK)
      .map((entry) => entry.doc);
    const text = ranked.map((doc) => doc.body).join("\n\n");
    return {
      strategy: `lexical(top${topK})`,
      text,
      loaded: ranked.map((doc) => doc.id),
      reads: 1,
      hops: 0,
      tokens: estimateTokens(text),
    };
  };
}

/**
 * An index in the prompt, and bodies read on demand.
 *
 * The reader picks from the **index** (title + summary), not the bodies, then follows
 * any pointer the document it just read names. That is how a dependency that shares no
 * vocabulary with the question is still reachable.
 */
export function progressive(maxReads = 3): Strategy {
  return progressiveWith("full", "progressive", maxReads);
}

/**
 * The same selection, rendered densely: the model-aware representation experiment.
 *
 * Selection is identical to `progressive` on purpose — the only variable is how each
 * selected document is rendered, so a difference in the tables is attributable to the
 * representation and not to what was chosen.
 */
export function compiled(maxReads = 3): Strategy {
  return progressiveWith("dense", "compiled", maxReads);
}

/**
 * The index without prose: bare ids, no summaries.
 *
 * This is the experiment the last pass pointed at. The 8B's misses were copies of
 * **index lines** (`"- constraint-eu"`, `"Retention policy"`), not wrong documents, so
 * the suspicion is that an index written as answerable-looking sentences *is* the
 * distraction. If the index is only ids, there is nothing to copy and the model has to
 * answer from what it read.
 *
 * Selection is unchanged — the lexical ranking still uses title and summary — so the
 * only variable is what the prompt shows.
 */
export function idIndex(maxReads = 3): Strategy {
  return progressiveWith("dense", "index-ids", maxReads, "ids");
}

export type IndexShape = "titled" | "ids";

/**
 * An index in the prompt, and bodies read on demand.
 *
 * The reader picks from the index, not the bodies, then follows any pointer the
 * document it just read names. That is how a dependency that shares no vocabulary with
 * the question is still reachable.
 */
function progressiveWith(
  representation: Representation,
  name: string,
  maxReads: number,
  indexShape: IndexShape = "titled",
): Strategy {
  return (task, corpus) => {
    const byId = new Map(corpus.map((doc) => [doc.id, doc]));
    const question = terms(task.question);
    const index = corpus
      .map((doc) => (indexShape === "ids" ? `- ${doc.id}` : `- ${doc.id}: ${doc.summary}`))
      .join("\n");
    const wanted = task.answer;

    const loaded: string[] = [];
    const bodies: string[] = [];
    let reads = 0;
    let hops = 0;
    const found = (): boolean =>
      wanted !== undefined && bodies.some((body) => body.includes(wanted));
    const read = (id: string): boolean => {
      if (reads >= maxReads || loaded.includes(id)) return false;
      const doc = byId.get(id);
      if (!doc) return false;
      reads += 1;
      loaded.push(id);
      bodies.push(renderDocument(doc, representation));
      return true;
    };

    /**
     * Follow a document's pointers, and their pointers.
     *
     * One hop is not enough: a constraint can point at the rule that implements it,
     * and then the answer is two links from the question. Depth is bounded by the read
     * budget, not by a separate limit, because every hop costs a real read.
     */
    const follow = (id: string): void => {
      for (const pointer of byId.get(id)?.seeAlso ?? []) {
        if (found() || reads >= maxReads) return;
        if (loaded.includes(pointer)) continue;
        if (read(pointer)) {
          hops += 1;
          follow(pointer);
        }
      }
    };

    const queue = corpus
      .map((doc) => ({ doc, score: score(question, `${doc.title} ${doc.summary}`) }))
      .filter((entry) => entry.score > 0)
      .sort(
        (a, b) =>
          b.score - a.score ||
          Number(isStale(a.doc)) - Number(isStale(b.doc)) ||
          a.doc.id.localeCompare(b.doc.id),
      )
      .map((entry) => entry.doc.id);

    while (!found() && reads < maxReads) {
      const next = queue.shift();
      if (!next) break;
      read(next);
      follow(next);
    }

    // Each body is labelled with its id. Without it the model sees a pile of
    // unattributed prose (or, with an id-only index, no way to connect a name to a
    // body at all), which is a defect rather than a representation choice.
    const text = [index, ...loaded.map((id, position) => `${id}:\n${bodies[position] ?? ""}`)].join(
      "\n\n",
    );
    return {
      strategy: name,
      text,
      loaded,
      reads,
      hops,
      tokens: estimateTokens(text),
    };
  };
}
