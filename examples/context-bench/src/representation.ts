/**
 * Model-aware representation: the second half of ADR-005's P2.
 *
 * The measured failure mode that motivates it is narrow and specific. The 8B model
 * does not fail to *find* documents — progressive disclosure gives it the right one —
 * it fails to **extract** the fact: asked about the retention policy it answers
 * "Retention policy", asked about the EU constraint it echoes "- constraint-eu". Its
 * misses are the document's own headline, not a wrong document.
 *
 * A body is mostly connective prose around one or two facts. `dense` keeps the
 * sentences that carry a number or an obligation and drops the narrative, so the model
 * has less to copy and less to be distracted by. That is a *representation* change, not
 * a retrieval one: the same documents are selected, rendered differently.
 *
 * It is deliberately rule-based and inspectable rather than a model call: the harness
 * must stay deterministic and offline, and a summariser would make every table
 * incomparable with the ones before it.
 */
import type { Document } from "./corpus.js";

export type Representation = "full" | "dense";

/** Sentences that carry a fact: a quantity, an obligation, or a hard rule. */
const FACTFUL = /\d|\b(must|never|always|only|required|cannot|shall)\b|\bapplies\b/i;

/**
 * Render one document for the prompt.
 *
 * `full` is the body untouched — the control. `dense` keeps only the fact-bearing
 * sentences, with no title prefix: the index above already carries the document's name
 * and summary, so repeating it is pure cost. If a document has no fact-bearing
 * sentence, the body is kept whole rather than rendered empty, because an empty item is
 * worse than a verbose one.
 */
export function renderDocument(doc: Document, representation: Representation): string {
  if (representation === "full") return doc.body;

  const facts = splitSentences(doc.body).filter((sentence) => FACTFUL.test(sentence));
  if (facts.length === 0) return doc.body;
  return facts.join(" ");
}

/**
 * Split a body into sentences without butchering numbered lists.
 *
 * "1. Build. 2. Tag. 3. Publish." splits into `1.`, `2.`, `3.` on the punctuation
 * alone, and keeping only those fragments would render a step list as three numerals.
 * A bare ordinal is therefore re-attached to the sentence that follows it.
 */
function splitSentences(body: string): string[] {
  const parts = body
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const sentences: string[] = [];
  let pending = "";
  for (const part of parts) {
    if (/^\d+\.$/.test(part)) {
      pending += `${part} `;
      continue;
    }
    sentences.push(`${pending}${part}`.trim());
    pending = "";
  }
  if (pending.trim()) sentences.push(pending.trim());
  return sentences;
}

/** How much of a body the representation kept, for the run to report. */
export function representationRatio(docs: Document[], representation: Representation): number {
  const full = docs.reduce((sum, doc) => sum + doc.body.length, 0);
  const rendered = docs.reduce((sum, doc) => sum + renderDocument(doc, representation).length, 0);
  return full === 0 ? 0 : rendered / full;
}
