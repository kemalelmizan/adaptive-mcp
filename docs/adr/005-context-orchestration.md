# ADR-005: Context orchestration is a host concern

**Status:** Accepted (2026-11-04).

## Context

A context orchestrator is proposed to sit beside Adaptive MCP: a catalog of what an
agent _could_ know, with lazy loading, multi-resolution representations, token
budgets, dependencies, lifecycle (pin/expire/archive/evict/restore), telemetry, and
eventually adaptive selection and model-aware compilation. Framed as a lifecycle:

```
UNKNOWN → DISCOVERED → RESOLVED → LOADED → ACTIVE → ARCHIVED
```

with an explicit reason and policy behind each transition.

Most of the machinery already exists here, in fragments:

| Needed               | Already present                                                                                                       |
| -------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Catalog              | `AggregateToolset.listTools`, `discoverSkills`; **`ResourceToolset.listResources()` exists and is called by nothing** |
| Lazy loading         | `skillsPrompt` + `skills_read_skill` — progressive disclosure, read through `AgentRuntime.execute`                    |
| Multi-resolution     | skill description → body (+ bundled-file list); headroom's compressed tool output                                     |
| Archive / restore    | the compression hash store and `/retrieve`                                                                            |
| Dependencies         | `Task.dependsOn` and the store's `readyTasks`                                                                         |
| History with reasons | `ActionStep` / `PlanStep` in `spec`, persisted by `memory`                                                            |
| Learning loop        | `MetricCell` dimensions, `Recommendation`, and the advisor pattern (`Router`, `SamplingAdvisor`, `DecodingAdvisor`)   |
| Model hook           | `ChatModel.capabilities`, already consumed by decoding                                                                |

What is missing is structural: **there is no context assembly point.** In the agent
host the system prompt is a string literal assembled in `src/cli.ts` (base + mode +
server instructions + skills + tasks), with the learned context injected separately,
and nothing counts, records or bounds what goes in. `ChatUsage.inputTokens` is only
known after the call; there is no token estimator at all.

## Decision

**The host owns context orchestration.** The library supplies what it already
supplies for tool behaviour: recording, aggregation and advisory recommendations.

1. **Four separate concerns, four seams** — availability (catalog), selection
   (policy), representation (compiler), retention (store/eviction). Keeping them
   apart is the point: retrieval algorithms can change without touching the catalog,
   and neither is coupled to MCP, to a framework, or to a model.
2. **No new package, no new protocol noun.** This follows
   [ADR-004](004-archetype-component-ownership.md): delegation is host-only until a
   second host exists; the step model extends `orchestration` rather than becoming a
   package. There is no `adaptiveContext`, and only `dev.adaptivemcp/tools-metadata`
   is a proposed MCP extension (`packages/spec/src/extensions.ts`).
3. **Host records first; `spec` only on a second consumer.** Transition records stay
   in the host, like `Suspension` did. A `ContextStep` joins `spec` when something
   other than the agent host needs to read it — not before.
4. **MCP resources are a first-class source.** `listResources()`/`readResource()`
   already exist on both transports; the read is an ordinary tool call, so it takes
   the gate, telemetry and execution graph without new plumbing.
5. **Measurement precedes retrieval.** `examples/context-bench` lands before any
   adaptive selection. A progressive-disclosure benefit that cannot be measured at
   this scale cannot justify a retrieval rewrite.
6. **`ACTIVE` needs a rule or it does not exist.** Every loaded item stays loaded
   today, so "still relevant" is the only genuinely new state. It is earned by a
   testable policy (e.g. an item used in a successful step stays pinned); without one
   the state is decoration and is omitted.

## Consequences

- The first change is structural and behaviour-preserving: one assembly point that
  takes sections as data (`{ id, source, kind, text, tokens, reason }`), orders them,
  estimates tokens, and returns the same string the literal produced. The estimate is
  labelled as an estimate, not usage.
- Context spend becomes visible the way planning and decision costs already are
  (`plans=`, `decisions=` in the run summary) and through a `/context` command.
- The learning half reuses existing machinery — a `contextItem` key on
  `MetricDimensions` and `Recommendation` entries — rather than a second store table.
- Eviction and restore reuse the compression archive where the item came from a tool
  call, so `ARCHIVED` is not a new subsystem.
- Deliberately out of scope until the benchmark says otherwise: an embedding index, a
  retrieval rewrite, and per-model representation. Each is a variable in the
  benchmark, not an assumed improvement.

## Alternatives considered

- **A new `@adaptivemcp/context` package.** Rejected by ADR-004's precedent: a
  package, a name and a published surface for a concern that has one host.
- **Implementing it as middleware.** Rejected: middleware is per tool call by
  contract (`Middleware.beforeCall/afterCall`); context assembly happens per model
  turn, before any call exists.
- **A protocol extension for context items.** Rejected: MCP governs capabilities, not
  a client's working set, and only `tools-metadata` is proposed as an extension.
- **Putting the lifecycle record in `spec` now.** Deferred: it is a shape with one
  consumer. Promote it when a second host records the same transitions.

## Phases

1. **P0** — assembly point + token estimate; a catalog with `/context`; lazy MCP
   resources; per-category budgets.
2. **P1** — dependency edges; pin/expire/evict/restore; context telemetry as a metric
   dimension.
3. **P2** — adaptive selection (an advisor over context metric cells) and
   model-aware representation, each only if the benchmark shows headroom.
