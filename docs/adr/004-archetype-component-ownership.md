# ADR-004: Where archetype components live (agent or library)

**Status:** Accepted (2026-10-17). Catalogue and coverage:
`docs/archetypes.md`; host-side catalogue:
`../../agent/docs/archetypes/` (failover issues: adaptive-mcp #39–#43).

## Context

Reading five agent archetypes against six reference codebases
(`docs/archetypes.md`) turned up six components the framework has no home for —
pause/resume, delegation, a shared task list, a step/pipeline model, skills, and
planning/typed memory steps. Each arrived as a "library or host?" question, and
answering them one at a time risks the failure mode this repo already guards
against: **over-modularization** (see the dependency-closure and `check-deps`
guards). The decisions also gate the host work: every agent archetype issue sits
behind them.

Two existing rules constrain the answer, and both are load-bearing:

- **No first-class adaptive nouns** — no `adaptiveTool`/`adaptiveSkill`/
  `adaptiveIntent`/`adaptiveWorkflow`. The framework enriches MCP primitives; it
  does not invent protocol concepts.
- **Shell/process/network/session are implementation details.** The client stays
  thin; business logic lives in packages.

Plus the principle already stated in [ADR-003](003-decoding-resolver.md):
_a shared abstraction should be inferred from two real cases, not guessed._

## Decision

**No new packages.** Every component below is either an **existing package
extended**, a **shape in `spec`**, or explicitly a **host concern**. The split
follows one test: _is it host-agnostic and primitive-shaped (→ library), or does
it need a host's session lifecycle, UI, or model? (→ host)._

| Component                                            | Decision                                            | Where                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pause / resume _(the `interrupt`/`resume` contract)_ | **Shape + persistence are library; policy is host** | record type in `spec`, storage in `memory`; "what may suspend, who answers, how we resume" in the host                                                                                                                                                                 |
| Delegation _(spawn a sub-agent)_                     | **Host**                                            | it is sessions, derived permissions and background jobs — all host lifecycle. No library until a second host implements it.                                                                                                                                            |
| Shared task list                                     | **Shape is library; the coordinator is host**       | `Task` (status/assignee/dependencies/result) in `spec` for uniform recording; assignment/modes in the host                                                                                                                                                             |
| Step / pipeline model                                | **Extend `orchestration`**                          | it already owns _execution composition_ at the tool-call level; a step model generalises the same concern one level up. It does **not** get a new package, and it does **not** get a second name.                                                                      |
| Planning + typed memory steps                        | **Shape is library; the pass is host**              | `Task`/`Action`/`Plan` step records in `spec`, persisted by `memory`; producing a plan needs the model, so it is the host's                                                                                                                                            |
| Skills                                               | **Not a protocol concept**                          | the _loader_ is the host's (a `skills/` convention, like `llama.cpp`/`opencode`). A skill _corpus_ may later be published as a `dev.adaptivemcp/*` **resource** — the pattern already used for `tools-metadata` — and only then does `spec`/`extension` gain anything. |

Two consequences worth stating explicitly:

1. **`memory` becomes the suspension store too.** It already owns durable SQLite
   state; a suspension is state. This keeps "durable, resumable" in one place
   rather than inventing a checkpoint package beside it.
2. **`orchestration`'s name widens, not forks.** Its responsibility becomes
   "compose work" — at the tool-call level today, at the step level when the
   steps exist. That is the same package, the same version stream, and the same
   owner; the ADR settles the collision `docs/archetypes.md` flagged.

## Consequences

- **The host keeps the vocabulary.** The agent names its own archetypes
  (`resolveTool`, delegation, task list); the framework supplies shapes and
  primitives. An `adaptiveWorkflow` never appears.
- **Additive `spec` changes only.** New record types, no new protocol surface; a
  server that ignores them is unaffected (graceful degradation still holds).
- **Delegation and skill loading stay host-only for now** — which is honest: one
  host wants them, and ADR-003's rule says wait for the second.
- **Every host issue is now unblocked**: agent #35–#40 can proceed against these
  boundaries instead of guessing them per-feature.
- If a _second_ host needs delegation or a coordinator, that is the trigger to
  revisit — not a reason to pre-build it now.

## Alternatives considered

- **A `checkpoint` / `suspension` package beside `memory`.** Rejected: it would
  hold the same SQLite state `memory` already owns, and it is the exact
  over-modularization the dependency-closure guard exists to prevent.
- **A `team` / `agents` package for task lists and modes** (the `agno` shape).
  Rejected for now: `agno` ships that inside its **platform**, not as a
  protocol-level library, and a coordinator without a host is a data model
  looking for a caller. Shape in `spec`, coordinator in the host, revisit at the
  second host.
- **A fourth `adaptiveWorkflow`-style concept for pipelines.** Rejected on the
  non-goals: `orchestration` already is the composition seam.
- **Skills as a new protocol noun** (an `adaptiveSkill` resource _type_).
  Rejected: reuse the existing resource mechanism and the existing identifiers,
  exactly as `tools-metadata` does.
- **Deciding delegation/planning as libraries now.** Deferred under ADR-003's
  rule — infer from two real cases. The host is the first case; nothing is lost
  by waiting, because the record shapes already live in `spec`.
