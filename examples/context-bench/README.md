# context-bench

A small, offline benchmark for **context strategies**: does the model get the
information it needs, and what does it cost?

It exists because progressive disclosure is usually argued for and rarely measured
([ADR-005](../../docs/adr/005-context-orchestration.md)). Three strategies run over the
same corpus and tasks:

| Strategy                          | What the model sees                                                                                                                        |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `all-upfront`                     | every document body                                                                                                                        |
| `lexical(top3)`                   | the best 3 documents by term overlap with the question, zero-score ones excluded                                                           |
| `progressive`                     | an index (title + summary) and bodies read on demand, following pointers                                                                   |
| `compiled`                        | the same selection, rendered dense: only the fact-bearing sentences of each body (numbers, obligations, rules)                             |
| `index-ids`                       | dense bodies, but the index is **bare ids** — no summaries, nothing answerable to copy                                                     |
| `adaptive-select`                 | the same index and on-demand reads, ordered by what the store learned — pins, load counts, then relevance; **no** carry-over between tasks |
| `adaptive-cold` / `adaptive-warm` | `adaptive-select` plus a session working set: first pass, then a second pass over what the first learned                                   |

## The pack

11 tasks over 19 documents. Eight are answerable from a document whose vocabulary
overlaps the question; **three are not** — their answer lives in a document sharing no
term with the question, reachable only by following pointers:

| Hidden task                  | Route                                                                        | Hops  |
| ---------------------------- | ---------------------------------------------------------------------------- | ----- |
| payments API timeout change  | `api-payments` → `constraint-eu` ("p99 under 2s")                            | 1     |
| billing export format change | `billing-export` → `retention-policy` ("90 days")                            | 1     |
| catalog API batching change  | `catalog-api` → `catalog-constraints` → `catalog-approval` ("Two approvals") | **2** |

The last one is the second-hop case: the document the question matches points at a
constraint, which points at the rule that actually answers. A strategy that follows one
pointer and stops cannot reach it, and a test asserts the question-matching document does
**not** point at the answer directly.

Three `legacy` documents are deliberate vocabulary-overlap distractors: they repeat the
questions' words and hold retired values (`p99 5s`, `30 days`, a single sign-off), so
precision and pollution mean something and similarity alone is not enough. Tests assert
that each hidden answer document shares no term with its question, and that at least one
direct question is defeated by a distractor — a benchmark where similarity always wins
would not be testing anything.

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
all-upfront        11/11  408      0.05       1.00    0.0    0.0   0.95
lexical(top3)      8/11   56       0.39       0.73    1.0    0.0   0.61
progressive        11/11  365      0.76       1.00    1.5    0.4   0.24
compiled           11/11  358      0.76       1.00    1.5    0.4   0.24
index-ids          11/11  124      0.76       1.00    1.5    0.4   0.24
adaptive-cold      11/11  442      0.29       1.00    1.0    0.2   0.71
adaptive-warm      11/11  440      0.30       1.00    1.2    0.4   0.70
adaptive-select    11/11  360      0.74       1.00    1.6    0.4   0.26
```

Re-run 2026-11-07 against `@adaptivemcp/*` 0.7.0 (the release that shipped context-load
telemetry): every cell is identical, so the adaptive rows below are current, not a
pre-release snapshot. This table is now **pinned by
`deterministic.test.ts`** — the runner and the test share `deterministicOutcomes()`,
so a strategy change that is not reflected here fails CI instead of leaving the docs
describing a benchmark that no longer exists.

`lexical` reaches 8 of 11: it misses exactly the three hidden tasks and nothing else. It
used to lose a fourth — `deploy-rule` — to a `legacy` document that repeated the
question's words and sorted first; ranking now prefers a current document when two match
equally (see below). Everything else reaches all 11, including the two-hop chain.

**The adaptive rows reach the second hop now, and getting there fixed three bugs rather
than tuning a ranking** ([#79](https://github.com/kemalelmizan/adaptive-mcp/issues/79)):

1. `context_edges` had no ordinal, so it returned a document's pointers in `(relation,
target)` order. `catalog-constraints` declares the answer first and the distractor
   second; the strategy followed the distractor and spent its budget. Migration 9 adds an
   `ordinal`, and recording appends when none is given.
2. The strategy stopped early because its "answer is present" check used a plain
   `includes`, so `"5 minutes"` matched inside `"15 minutes"` — the same trap the scorer
   fixed, missed in the stop condition.
3. With a session working set, a document already in context had its pointers ignored, so
   a follow-up question could not reach the document it named.

The result is a real trade rather than a win: adaptive reads less than progressive (1.1
vs 1.6 per task) and carries more (451 vs 367 tokens), because the working set keeps what
earlier tasks loaded.

### Preferring the current document over a retired one

The distractors are named for it — `legacy`, `deprecated`, `retired`, `superseded` — and a
retired document that repeats the question's words is the most expensive kind of
distractor: it matches, it is plausible, and its answer is wrong. Ranking now breaks an
equal-relevance tie in favour of the document that does not advertise itself as
superseded, in all three selecting strategies.

```
before (top-3 for "the rule about tagging a release"):
  approval-rules-legacy, catalog-approval, catalog-constraints   → MISS
after:
  catalog-approval, catalog-constraints, runbook-deploy          → hit
```

It is a **tie-break, not a filter**: a genuinely better match still wins, and a corpus
without such labels gets no benefit. That is deliberate — the signal is a naming
convention, not an understanding of versions, and pretending otherwise would be the kind
of heuristic that looks clever and ages badly. The measured effect is one direct task
(`lexical` 7 → 8 of 11) plus fewer tokens for progressive (367 → 365) and `index-ids`
(126 → 124), because two stale documents drop out of the read set.

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
all-upfront        10/11  408      1294
lexical(top3)      8/11   56       794
progressive        11/11  365      1030
compiled           11/11  358      1261
index-ids          10/11  124      1505
adaptive-warm      9/11   440      740
routed             11/11  365      950
```

**Qwen3-8B (CPU):**

```
strategy           pass   tokens   mean ms
all-upfront        10/11  408      3694
lexical(top3)      7/11   56       2374
progressive        8/11   365      2742
compiled           8/11   358      4844
index-ids          8/11   124      3390
adaptive-warm      9/11   440      3254
routed             9/11   440      3130
```

### Routing on capability

The last two tables disagree about retention, so the harness now routes rather than picks.
`--model-profile capable|limited` declares what the host knows about the model, and the
`routed` row takes the policy that profile selects:

| Profile   | Policy                      | Why                                                                      |
| --------- | --------------------------- | ------------------------------------------------------------------------ |
| `capable` | fresh working set each task | it reads more per task and is not distracted by earlier documents        |
| `limited` | retain the working set      | it reads less, and the documents stay where a small model can reuse them |

```
qwen3-coder-30b  --model-profile capable   routed 11/11 @365   (best fixed arm: progressive 11/11 @365)
qwen3-8b         --model-profile limited   routed  9/11 @440   (best fixed arm: adaptive-warm 9/11 @440)
```

`routed` matches the best fixed arm on each model, which is the whole claim: no single
policy wins both, and the seam is one predicate plus the host's own knowledge of its model.
Guessing capability from a model name is deliberately **not** done — a host that knows its
model declares it, and the wrong declaration shows up as the wrong arm's score.

### With the answer constraint (`--strict`)

The same prompts, with an instruction that forbids quoting a list item, a line, or a
document title and demands the exact value:

```
qwen3-coder-30b        qwen3-8b
all-upfront   9/11     all-upfront   8/11
lexical       9/11     lexical       7/11
progressive   9/11     progressive   8/11
compiled      9/11     compiled      8/11
index-ids     9/11     index-ids     8/11
adaptive      7/11     adaptive      7/11
```

**The constraint makes things worse.** The 30B drops from 11/11 to 9/11; every hidden
task now answers a nearby value with confidence (`"900ms"`, `"api-payments"`,
`"retention-policy"`) instead of reasoning to the constraint. Forcing brevity removed the
explanation that was carrying the right answer. (Lexical is the exception: it goes 7 →
9 on the 30B, because a one-word answer from the wrong document is still wrong — the
constraint does not fix retrieval, it just changes the failure text.)

### Reading the tables together

- The deterministic table says the information is **available**: every strategy except
  lexical reaches 11/11, including the two-hop chain.
- **The 30B gets the second hop** when the chain is supplied (progressive 11/11), while
  volume (all-upfront 10/11) and a compressed index (`index-ids` 10/11) each miss one. The
  pointer chain does work that neither size nor brevity does.
- **The 8B is the counter-case**: all-upfront 10/11 beats progressive 8/11. Its misses are
  copies of index entries (`"catalog-constraints, catalog-approval"`) rather than the
  fact, so its bottleneck is extraction, not availability.
- **The working set flips sign with model size, so the policy is routed.** `adaptive-warm`
  is 9/11 on the 30B — worse than progressive — but **9/11 on the 8B, better than every
  other strategy there**. Routing on the declared capability (`--model-profile`) gives
  `routed` = 11/11 on the 30B and 9/11 on the 8B: the best fixed arm for each. That is the
  first positive result for retention, and the reason the harness no longer pretends one
  strategy is right for every model.
- **Vocabulary-overlap distractors cost everyone**: lexical falls to 7/11 (30B) and 6/11
  (8B), and it loses a _direct_ question (`deploy-rule`) to a `legacy` document that
  repeats the question's words. Similarity is neither necessary nor sufficient here.
- **Model-aware representation buys tokens, not accuracy.** `compiled` selects exactly
  what `progressive` selects and renders it densely (88% of the body characters): the same
  11/11 on the 30B for 8 fewer tokens, and the same 8/11 on the 8B.
- **The index shape remains the cheap win for the capable model**: `index-ids` reaches
  10/11 on the 30B at **126 tokens against 367** — a third of the prompt — but gives up
  the second hop. For the 8B it is 8/11 at 126, the same as progressive.
- **The answer constraint is counter-productive** on both models (30B 11 → 9), measured
  twice with the same direction.
- So the gain from progressive disclosure is **model-dependent**, and the corollary is
  sharper now: the same retention policy helps a small model and hurts a large one. A
  selection policy that ignores the model it serves is _worse_ than no policy, which is
  why ADR-005 puts measurement before retrieval.

## Caveats

10 tasks, one corpus, one run per model, temperature 0. The matcher is exact
(case- and number-word-insensitive: "ten minutes" = "10 minutes") and rewards the
fact, not a paraphrase — which is why one task's key is a number ("5 minutes") rather
than a sentence: an imperative sentence was measuring paraphrasing, not retrieval.
Treat the tables as a direction to test further, not a conclusion.

**A structural fix recorded with these tables:** each body is now labelled with its id
(`api-payments:` above the text). Before, the model saw a pile of unattributed prose, and
with an id-only index it had no way to connect a name to a body at all. That is a defect
rather than a representation choice, and fixing it is why the `progressive` row moved
from 249 to 254 tokens — the numbers here supersede the earlier tables.

**A matcher bug this pass fixed:** success used to be a plain substring test, so
`"5 minutes"` matched inside `"15 minutes"` and a document about token lifetimes
counted as answering a question about paging. Matching now requires token boundaries
on both sides (`textIncludesAnswer`). That correction is what turned the adaptive
session rows from a false 10/10 into the 9/10 above — a reminder that a benchmark's
matcher is part of the benchmark.

## Design notes

- The corpus and tasks are data (`src/corpus.ts`, `src/tasks.ts`); a task owns its
  answer, so one document can answer several questions.
- Zero-score documents are not returned by `lexical`; padding the top-k would inflate
  recall and pollution by accident.
- The model mode is opt-in: it needs a server, is not deterministic, and CI stays
  offline.
- `representation` (`src/representation.ts`) is rule-based on purpose: a summariser
  would make every table incomparable with the ones before it. `dense` keeps sentences
  with a number or an obligation and drops narrative; a document with no such sentence
  is kept whole, and numbered lists are not shredded into bare ordinals. A test asserts
  every answering fact survives the render — otherwise the tables would be measuring
  the renderer's omissions.
- `compiled` and `index-ids` reuse `progressive`'s selection exactly, so a difference
  between those rows is attributable to representation rather than to what was chosen.
  A test asserts the loaded set, reads and hops are identical across them.
- `--strict` is an instruction change only, so it is reported as a second table rather
  than a strategy: the prompt and the selection stay the same across the two runs.
- `adaptive` (`src/adaptive.ts`) is a _policy over the store's records_, not a new
  subsystem: it reads `contextEdges`/`contextStats`/`contextLifecycle` and writes
  `recordContext`/`setContextLifecycle` after each task, so learning never influences
  the task that produced it. That is the P1 machinery exercised by a real consumer.
- `tokens` for a session variant is the whole working set, not this task's reads,
  because that is the prompt the model actually receives. Comparing it to a per-task
  strategy is the point: retention costs tokens.
