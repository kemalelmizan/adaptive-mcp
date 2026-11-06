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

/** How many distinct question terms a document's text contains. */
function score(question: Set<string>, text: string): number {
  let hits = 0;
  for (const term of terms(text)) if (question.has(term)) hits += 1;
  return hits;
}

/** Every document's body, in one prompt. The cost baseline. */
export const allUpfront: Strategy = (task, corpus) => {
  const text = corpus.map((doc) => doc.body).join("\n\n");
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
      .sort((a, b) => b.score - a.score || a.doc.id.localeCompare(b.doc.id))
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
  return (task, corpus) => {
    const byId = new Map(corpus.map((doc) => [doc.id, doc]));
    const question = terms(task.question);
    const index = corpus.map((doc) => `- ${doc.id}: ${doc.summary}`).join("\n");
    const wanted = byId.get(task.answerIn)?.fact;

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
      bodies.push(doc.body);
      return true;
    };

    const queue = corpus
      .map((doc) => ({ doc, score: score(question, `${doc.title} ${doc.summary}`) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || a.doc.id.localeCompare(b.doc.id))
      .map((entry) => entry.doc.id);

    while (!found() && reads < maxReads) {
      const next = queue.shift();
      if (!next) break;
      read(next);
      const pointers = byId.get(next)?.seeAlso ?? [];
      for (const pointer of pointers) {
        if (found() || reads >= maxReads) break;
        if (read(pointer)) hops += 1;
      }
    }

    const text = [index, ...bodies].join("\n\n");
    return {
      strategy: "progressive",
      text,
      loaded,
      reads,
      hops,
      tokens: estimateTokens(text),
    };
  };
}
