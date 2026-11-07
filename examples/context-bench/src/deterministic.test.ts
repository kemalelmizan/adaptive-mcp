import { describe, expect, it } from "vitest";
import { summarise } from "./bench.js";
import { deterministicOutcomes } from "./deterministic.js";

/**
 * The published deterministic table, as a test.
 *
 * `README.md` prints this table and several documents quote from it, so a silent change
 * in a strategy would leave the docs describing a benchmark that no longer exists. The
 * run is deterministic by construction (a reader oracle, no model), which is what makes
 * an exact pin honest rather than flaky: same code, same numbers, every time.
 *
 * When a strategy changes on purpose, update the row here *and* in `README.md` in the
 * same commit — the test is the thing that makes that pairing unavoidable.
 */
const RECORDED = [
  // strategy          pass  tokens precision recall reads hops pollution
  {
    strategy: "all-upfront",
    passed: 11,
    tokens: 408,
    precision: 0.05,
    recall: 1,
    reads: 0,
    hops: 0,
    pollution: 0.95,
  },
  {
    strategy: "lexical(top3)",
    passed: 8,
    tokens: 56,
    precision: 0.39,
    recall: 0.73,
    reads: 1,
    hops: 0,
    pollution: 0.61,
  },
  {
    strategy: "progressive",
    passed: 11,
    tokens: 365,
    precision: 0.76,
    recall: 1,
    reads: 1.5,
    hops: 0.4,
    pollution: 0.24,
  },
  {
    strategy: "compiled",
    passed: 11,
    tokens: 358,
    precision: 0.76,
    recall: 1,
    reads: 1.5,
    hops: 0.4,
    pollution: 0.24,
  },
  {
    strategy: "index-ids",
    passed: 11,
    tokens: 124,
    precision: 0.76,
    recall: 1,
    reads: 1.5,
    hops: 0.4,
    pollution: 0.24,
  },
  {
    strategy: "adaptive-cold",
    passed: 11,
    tokens: 442,
    precision: 0.29,
    recall: 1,
    reads: 1,
    hops: 0.2,
    pollution: 0.71,
  },
  {
    strategy: "adaptive-warm",
    passed: 11,
    tokens: 440,
    precision: 0.3,
    recall: 1,
    reads: 1.2,
    hops: 0.4,
    pollution: 0.7,
  },
  {
    strategy: "adaptive-select",
    passed: 11,
    tokens: 360,
    precision: 0.74,
    recall: 1,
    reads: 1.6,
    hops: 0.4,
    pollution: 0.26,
  },
] as const;

describe("the recorded deterministic table", () => {
  const summaries = summarise(deterministicOutcomes());

  it("has one row per recorded strategy, in order", () => {
    expect(summaries.map((summary) => summary.strategy)).toEqual(
      RECORDED.map((row) => row.strategy),
    );
    expect(summaries.every((summary) => summary.total === 11)).toBe(true);
  });

  for (const row of RECORDED) {
    it(`reproduces the ${row.strategy} row`, () => {
      const summary = summaries.find((entry) => entry.strategy === row.strategy);
      expect(summary, row.strategy).toBeDefined();
      expect({
        passed: summary?.passed,
        tokens: summary?.tokens,
        precision: Number(summary?.precision.toFixed(2)),
        recall: Number(summary?.recall.toFixed(2)),
        reads: Number(summary?.reads.toFixed(1)),
        hops: Number(summary?.hops.toFixed(1)),
        pollution: Number(summary?.pollution.toFixed(2)),
      }).toEqual({
        passed: row.passed,
        tokens: row.tokens,
        precision: row.precision,
        recall: row.recall,
        reads: row.reads,
        hops: row.hops,
        pollution: row.pollution,
      });
    });
  }

  it("keeps the two claims the table exists to support", () => {
    const byName = new Map(summaries.map((summary) => [summary.strategy, summary]));

    // Progressive reads on demand and still answers everything, at less cost.
    expect(byName.get("progressive")?.passed).toBe(11);
    expect(byName.get("progressive")?.tokens ?? 0).toBeLessThan(
      byName.get("all-upfront")?.tokens ?? 0,
    );
    // Similarity alone cannot reach the hidden dependencies.
    expect(byName.get("lexical(top3)")?.passed).toBeLessThan(11);
    // The dense index cuts cost without losing availability.
    expect(byName.get("index-ids")?.tokens ?? 0).toBeLessThan(
      byName.get("progressive")?.tokens ?? 0,
    );
    expect(byName.get("index-ids")?.passed).toBe(11);
  });
});
