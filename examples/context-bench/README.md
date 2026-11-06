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
lexical(top3)      7/11   56       0.36       0.64    1.0    0.0   0.64
progressive        11/11  367      0.74       1.00    1.6    0.4   0.26
compiled           11/11  359      0.74       1.00    1.6    0.4   0.26
index-ids          11/11  126      0.74       1.00    1.6    0.4   0.26
adaptive-cold      10/11  431      0.28       0.91    0.9    0.2   0.72
adaptive-warm      9/11   421      0.30       0.82    1.0    0.4   0.70
adaptive-select    10/11  359      0.73       0.91    1.5    0.4   0.27
```

`lexical` reaches 7 of 11: it misses all three hidden tasks, and one direct question is
lost to a `legacy` distractor that shares its vocabulary. `progressive`, `compiled` and
`index-ids` reach all 11 — including the two-hop chain, at 3 reads and 2 hops.

**The adaptive rows now fail the second hop, and the reason is a storage detail rather
than a ranking one.** `catalog-constraints` declares its pointers in priority order
(`catalog-approval` first), but `context_edges` returns them ordered by `(relation,
target)`, so `approval-rules-legacy` comes first, the read budget is spent there, and the
answer is never reached. Selection is not the bug; the record losing declared order is.
Tracked as [adaptive-mcp#79](https://github.com/kemalelmizan/adaptive-mcp/issues/79), and
a test asserts the current behaviour so a fix has to change it deliberately.

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
lexical(top3)      7/11   56       731
progressive        11/11  367      995
compiled           11/11  359      1287
index-ids          10/11  126      1482
adaptive-warm      7/11   421      692
```

**Qwen3-8B (CPU):**

```
strategy           pass   tokens   mean ms
all-upfront        10/11  408      3629
lexical(top3)      6/11   56       2266
progressive        8/11   367      2674
compiled           8/11   359      4523
index-ids          8/11   126      3560
adaptive-warm      7/11   421      2951
```

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

- The deterministic table says the information is **available**: progressive 11/11,
  including the two-hop chain.
- **The 30B gets the second hop after one is added**, which is the useful result: given
  the pointer chain, it reads `catalog-api`, follows to `catalog-constraints`, follows
  again, and answers "Two approvals" — 11/11. All-upfront (10/11) and `index-ids`
  (10/11) each miss one hidden task, so the pointer chain is doing work that volume does
  not.
- **The 8B is the counter-case**: all-upfront 10/11 beats progressive 8/11. Given the
  index it copies index entries (`"- constraint-eu"`, `"catalog-constraints,
catalog-approval"`), and given everything it answers the pointer sentence instead of
  the fact. Its bottleneck is extraction, not availability.
- **Vocabulary-overlap distractors cost everyone**: lexical falls to 7/11 (30B) and 6/11
  (8B), and it loses a _direct_ question (`deploy-rule`) to a `legacy` document that
  repeats the question's words. Similarity is neither necessary nor sufficient here.
- **Adaptive selection still does not pay for itself**, and the new pack shows two
  distinct reasons: the larger working set loses one-hop tasks with the 30B (7/11), and
  the store's edge ordering loses the second hop deterministically (see above). Both are
  recorded rather than tuned away.
- **Model-aware representation buys tokens, not accuracy.** `compiled` selects exactly
  what `progressive` selects and renders it densely (88% of the body characters): the same
  11/11 on the 30B for 8 fewer tokens, and the same 8/11 on the 8B.
- **The index shape remains the cheap win for the capable model**: `index-ids` reaches
  10/11 on the 30B at **126 tokens against 367** — a third of the prompt — but gives up
  the second hop, because with no summaries and no pointer sentence the model has less to
  follow. For the 8B it is 8/11 at 126, the same as progressive.
- **The answer constraint is counter-productive** on both models (30B 11 → 9), which is
  the second time it has been measured and the second time it failed.
- So the gain from progressive disclosure is **model-dependent**, and on this pack it is
  largest where the model can use what it is given. A selection policy that ignores the
  model's ability to read is _worse_ than no policy, which is why ADR-005 puts measurement
  before retrieval.

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
