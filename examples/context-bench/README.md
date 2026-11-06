# context-bench

A small, offline benchmark for **context strategies**: does the model get the
information it needs, and what does it cost?

It exists because progressive disclosure is usually argued for and rarely measured
([ADR-005](../../docs/adr/005-context-orchestration.md)). Three strategies run over the
same corpus and tasks:

| Strategy        | What the model sees                                                              |
| --------------- | -------------------------------------------------------------------------------- |
| `all-upfront`   | every document body                                                              |
| `lexical(top3)` | the best 3 documents by term overlap with the question, zero-score ones excluded |
| `progressive`   | an index (title + summary) and bodies read on demand, following pointers         |

## What it measures — and what it does not

The default run is **deterministic**: the reader is an oracle that knows which fact
answers the task and stops when it has it. That isolates _availability and cost_ from
sampling noise, and it is why the numbers are stable.

It does **not** measure model skill. `--model <baseURL>` adds a second table that asks
a real OpenAI-compatible model the same questions with the same contexts — that is the
half where pollution and reasoning show up. Two different questions, two tables.

Metrics:

| Metric           | Definition                                                                                   |
| ---------------- | -------------------------------------------------------------------------------------------- |
| `pass`           | the exact answering string is in the context (deterministic) / the answer matches it (model) |
| `tokens`         | estimated context tokens (chars/4) — the strategy's cost, not the model's usage              |
| `precision`      | required document loaded ? `1/loaded` : `0`                                                  |
| `recall`         | required document loaded                                                                     |
| `reads` / `hops` | retrieval calls, and how many were caused by following a pointer                             |
| `pollution`      | share of loaded documents that were not required                                             |

## The hidden-dependency task

Four tasks are answerable from a document whose vocabulary overlaps the question. The
fifth is not: _"I am changing the payments API default timeout. What else must I check
before shipping?"_ is answered by `constraint-eu` ("p99 under 2s"), a document that
shares **no terms** with the question. The only route is the pointer in
`api-payments`. A test asserts that disjointness, so the benchmark cannot silently
stop testing what it claims.

## Deterministic run

```bash
pnpm --filter @adaptivemcp/context-bench build
pnpm --filter @adaptivemcp/context-bench bench
```

```
strategy           pass   tokens   precision  recall  reads  hops  pollution
all-upfront        5/5    181      0.13       1.00    0.0    0.0   0.88
lexical(top3)      4/5    25       0.70       0.80    1.0    0.0   0.30
progressive        5/5    153      0.90       1.00    1.2    0.2   0.10
```

The hidden task: `lexical` loads only `api-payments` and misses; `progressive` reads
it, follows the pointer, and reaches the constraint in two reads.

## Live-model run

```bash
pnpm --filter @adaptivemcp/context-bench bench -- \
  --model http://127.0.0.1:8080/v1 --model-name qwen3-coder
```

Recorded 2026-11-06 against `Qwen3-Coder-30B-A3B-Instruct` (llama.cpp, temperature 0):

```
strategy           pass   tokens   mean ms
all-upfront        4/5    181      1183
lexical(top3)      4/5    25       1403
progressive        5/5    153      1425
```

**The interesting result is the disagreement between the tables.** The deterministic
oracle passes the hidden task with _all-upfront_ — the constraint is in the prompt.
The model does not: given all eight documents it misses the constraint, while given
the two documents reachable through the pointer it finds it. That is context
pollution, and it is invisible to a harness that only checks availability.

Caveats, because the sample is small: five tasks, one model, one run, one corpus.
Treat this as a hypothesis to expand, not a conclusion. It does, however, say
something useful already: _loading more context is not monotonically better_, which is
exactly what the strategy is supposed to improve.

## Design notes

- The corpus and tasks are data (`src/corpus.ts`, `src/tasks.ts`), so a larger pack is
  a data change, not a code change.
- Zero-score documents are not returned by `lexical`; padding the top-k would inflate
  recall and pollution by accident.
- The model mode is opt-in: it needs a server, is not deterministic, and CI stays
  offline. `answersCorrectly` normalises case and number words ("ten minutes" =
  "10 minutes") and nothing else.
