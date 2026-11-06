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
progressive        10/10  254      0.85       1.00    1.3    0.2   0.15
compiled           10/10  246      0.85       1.00    1.3    0.2   0.15
index-ids          10/10  84       0.85       1.00    1.3    0.2   0.15
adaptive-cold      9/10   299      0.33       0.90    0.8    0.2   0.67
adaptive-warm      9/10   299      0.33       0.90    0.8    0.2   0.67
adaptive-select    10/10  250      0.80       1.00    1.4    0.2   0.20
```

`lexical` misses both hidden tasks: it loads `api-payments` / `billing-export` and
never the documents they point at. `progressive` reads two documents per hidden task —
one to find the pointer, one to follow it.

**`index-ids` is the strongest row here:** identical selection and reads to
`compiled`, same 10/10, at **84 tokens instead of 246** — because the summaries were
most of the prompt. Deterministically that is free; with a model it is the experiment
below.

**The adaptive rows are a negative result, and that is the finding.** They are built on
the store's own P1 records — `contextEdges` for pointers, `contextStats` for what has
been loaded, `contextLifecycle` pins for what actually answered — so they are the
honest test of P2, not a straw man:

- `adaptive-select` reads _more_ than `progressive` (1.4 vs 1.3 per task), costs about
  the same, and pollutes more (0.20 vs 0.15). Selection, without retention, adds
  nothing here: on a 13-document corpus the lexical ranking is already the right
  ranking, and pins/load counts only perturb ties.
- The session variants trade reads for tokens and lose a task (9/10). Keeping a working
  set means fewer reads (0.8) but a prompt that grows to carry everything read so far
  (299 tokens vs 249), and the one miss is a case where the working set was full of
  earlier answers and the right document never got read inside the read budget.
- `adaptive-cold` and `adaptive-warm` are identical, which is itself information: one
  pass of experience did not change a single selection on this pack.

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
all-upfront        9/10   280      673
lexical(top3)      8/10   45       877
progressive        10/10  254      998
compiled           9/10   246      977
index-ids          10/10  84       1191
adaptive-warm      8/10   299      688
```

**Qwen3-8B (CPU):**

```
strategy           pass   tokens   mean ms
all-upfront        9/10   280      2497
lexical(top3)      7/10   45       1743
progressive        8/10   254      2213
compiled           8/10   246      1873
index-ids          8/10   84       2066
adaptive-warm      7/10   299      1964
```

### With the answer constraint (`--strict`)

The same prompts, with an instruction that forbids quoting a list item, a line, or a
document title and demands the exact value:

```
qwen3-coder-30b        qwen3-8b
all-upfront   8/10     all-upfront   8/10
lexical       8/10     lexical       8/10
progressive   8/10     progressive   8/10
compiled      8/10     compiled      8/10
index-ids     8/10     index-ids     8/10
adaptive      7/10     adaptive      7/10
```

**The constraint makes things worse.** The 30B drops from 10/10 to 8/10; every hidden
task now answers a nearby value with confidence (`"two"`, `"900ms"`, `"api-payments"`)
instead of reasoning to the constraint. Forcing brevity removed the explanation that
was carrying the right answer.

### Reading the tables together

- The deterministic table says the information is **available**: progressive 10/10.
- The 30B model reproduces the original finding: **all-upfront misses a hidden task
  that progressive gets**, despite loading the answering document. Lexical misses both,
  as designed.
- The 8B is the interesting counter-case: its misses are **extraction**, not
  retrieval. Given everything, it answers the pointer sentence ("Read the retention
  policy…") instead of the fact; given the index it echoes the title ("Retention
  policy") or the line ("- constraint-eu"). A smaller model is the bottleneck, not the
  strategy.
- **Adaptive selection does not pay for itself on this pack.** With the 30B it drops to
  8/10 while progressive holds 10/10; with the 8B it ties progressive's weakest arm
  (7/10 vs 8/10). The larger, less focused prompt is the plausible cause — the extra
  documents are the ones learned to be "useful", which on a fresh task are not.
- **Model-aware representation buys tokens, not accuracy.** `compiled` selects exactly
  what `progressive` selects and renders it densely (83% of the body characters):
  the same pass counts as progressive for ~3% fewer tokens. It does **not** fix the
  8B's extraction failure, and on the 30B it now costs a hidden task (9/10): the
  sentences it drops are the ones the model uses to reason.
- **The index shape is where the cheap win is.** `index-ids` keeps the same selection
  and the same dense bodies but shows no summaries: **10/10 at 84 tokens on the 30B**
  (against 254) and 8/10 at 84 on the 8B (against 254). For the 30B that is a third of
  the prompt at identical accuracy. For the 8B it is the same accuracy at a third of
  the cost — but its misses move from `"- constraint-eu"` to `"constraint-eu"`: it now
  copies the **id**. Removing prose from the index did not stop the copying; it
  changed the string being copied.
- **The answer constraint is counter-productive.** With `--strict` every strategy
  loses the hidden tasks and answers a nearby value (`"two"`, `"900ms"`, `"api-payments"`).
  The 30B goes 10/10 → 8/10. Suppressing the explanation suppresses the reasoning that
  produced the right answer, so the constraint solves a symptom the benchmark already
  reported as a miss for the wrong reason.
- So the gain from progressive disclosure is **model-dependent**, and on this pack it
  is largest where the model can use what it is given. The corollary the data now
  supports: a selection policy that ignores the model's ability to read is _worse_ than
  no policy, which is exactly why ADR-005 puts measurement before retrieval.

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
