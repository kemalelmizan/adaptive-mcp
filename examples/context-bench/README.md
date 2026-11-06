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

## The pack

10 tasks over 13 documents. Eight tasks are answerable from a document whose
vocabulary overlaps the question; **two are not** — their answer lives in a document
sharing no terms with the question, reachable only by following a pointer:

| Hidden task                  | Route                                             |
| ---------------------------- | ------------------------------------------------- |
| payments API timeout change  | `api-payments` → `constraint-eu` ("p99 under 2s") |
| billing export format change | `billing-export` → `retention-policy` ("90 days") |

Five `legacy` documents are deliberate distractors: they match the questions' words
and hold the wrong facts, so precision and pollution mean something. A test asserts
that each hidden answer document shares no term with its question, so the benchmark
cannot quietly stop testing what it claims.

## What it measures — and what it does not

The default run is **deterministic**: the reader is an oracle that knows which fact
answers the task and stops when it has it. That isolates _availability and cost_ from
sampling noise.

It does **not** measure model skill. `--model <baseURL>` adds a second table that asks
a real OpenAI-compatible model the same questions with the same contexts — that is the
half where pollution and extraction failures show up. Two different questions, two
tables.

| Metric           | Definition                                                                                   |
| ---------------- | -------------------------------------------------------------------------------------------- |
| `pass`           | the exact answering string is in the context (deterministic) / the answer matches it (model) |
| `tokens`         | estimated context tokens (chars/4) — the strategy's cost, not the model's usage              |
| `precision`      | required document loaded ? `1/loaded` : `0`                                                  |
| `recall`         | required document loaded                                                                     |
| `reads` / `hops` | retrieval calls, and how many were caused by a pointer                                       |
| `pollution`      | share of loaded documents that were not required                                             |

## Deterministic run

```bash
pnpm --filter @adaptivemcp/context-bench build
pnpm --filter @adaptivemcp/context-bench bench
```

```
strategy           pass   tokens   precision  recall  reads  hops  pollution
all-upfront        10/10  280      0.08       1.00    0.0    0.0   0.92
lexical(top3)      8/10   45       0.43       0.80    1.0    0.0   0.57
progressive        10/10  249      0.85       1.00    1.3    0.2   0.15
```

`lexical` misses both hidden tasks: it loads `api-payments` / `billing-export` and
never the documents they point at. `progressive` reads two documents per hidden task —
one to find the pointer, one to follow it.

## Live-model runs

```bash
pnpm --filter @adaptivemcp/context-bench bench -- \
  --model http://127.0.0.1:8080/v1 --model-name qwen3-coder --no-think
```

Recorded 2026-11-06, llama.cpp, temperature 0, one run per model. `--no-think` sets
`chat_template_kwargs: { enable_thinking: false }`, without which Qwen3 spends the
whole budget on `reasoning_content` and returns empty content — a 0/10 that measures
the template, not the strategy.

**Qwen3-Coder-30B-A3B (GPU):**

```
strategy           pass   tokens   mean ms
all-upfront        9/10   280      781
lexical(top3)      8/10   45       968
progressive        10/10  249      779
```

**Qwen3-8B (CPU):**

```
strategy           pass   tokens   mean ms
all-upfront        9/10   280      7037
lexical(top3)      7/10   45       1435
progressive        8/10   249      1599
```

### Reading the tables together

- The deterministic table says the information is **available**: progressive 10/10.
- The 30B model reproduces the original finding at twice the size: **all-upfront
  misses a hidden task that progressive gets**, despite loading the answering
  document. Lexical misses both, as designed.
- The 8B is the interesting counter-case: its misses are **extraction**, not
  retrieval. Given everything, it answers the pointer sentence ("Read the retention
  policy…") instead of the fact; given the index it echoes the title ("Retention
  policy") or the line ("- constraint-eu"). A smaller model is the bottleneck, not
  the strategy.
- So the gain from progressive disclosure is **model-dependent**, and on this pack it
  is largest where the model can use what it is given. That is a useful constraint on
  any adaptive selection: the policy should not outrun the model's ability to read.

## Caveats

10 tasks, one corpus, one run per model, temperature 0. The matcher is exact
(case- and number-word-insensitive: "ten minutes" = "10 minutes") and rewards the
fact, not a paraphrase — which is why one task's key is a number ("5 minutes") rather
than a sentence: an imperative sentence was measuring paraphrasing, not retrieval.
Treat the tables as a direction to test further, not a conclusion.

## Design notes

- The corpus and tasks are data (`src/corpus.ts`, `src/tasks.ts`); a task owns its
  answer, so one document can answer several questions.
- Zero-score documents are not returned by `lexical`; padding the top-k would inflate
  recall and pollution by accident.
- The model mode is opt-in: it needs a server, is not deterministic, and CI stays
  offline.
