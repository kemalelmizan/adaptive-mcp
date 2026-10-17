# Agent archetypes and the `@adaptivemcp/*` libraries

The same five agent archetypes assessed in the sibling
[`agent/docs/archetypes/`](../../agent/docs/archetypes/README.md) (tool agent,
skills agent, sequential agent, human-in-the-loop agent, orchestrator agent) can
be read from two sides:

- **Host side** (`agent/docs/archetypes/`): which _components_ an agent needs, and
  what our agent has.
- **Library side** (this file): which of those components the `@adaptivemcp/*`
  packages already provide, and which have no home.

This is a **neutral catalogue**: it records what exists, what does not, and — for
each gap — whether it _could_ be a library at all. It does not decide.

## Component → package

| Component (see the host-side catalogue)                           | Provided by                                      | Status         |
| ----------------------------------------------------------------- | ------------------------------------------------ | -------------- |
| Tool/annotation metadata, event schemas, shared types             | `spec`                                           | ✅             |
| Derived `tools-metadata` view + MCP resources                     | `extension`                                      | ✅             |
| Execution loop + middleware hooks                                 | `thin-client`, `middleware`                      | ✅             |
| Outcome/quality signal from events                                | `evaluation`                                     | ✅             |
| Persistence + historical context                                  | `memory`                                         | ✅             |
| Traces, events, metrics, execution history                        | `telemetry`                                      | ✅             |
| Execution-DAG intelligence (critical path, bottlenecks, cascades) | `graph-analysis`                                 | ✅             |
| Model selection, budget, fallback                                 | `routing`                                        | ✅             |
| Decoding policy (intent → sampling), backend-agnostic             | `routing` (`DecodingAdvisor`/`DecodingResolver`) | ✅             |
| Approval decision (allow/deny/require_confirmation)               | `approval`                                       | ✅             |
| One-wire-it-up entry point                                        | `runtime`                                        | ✅             |
| CLI-binary → MCP server wrapper (the sanctioned shell-out layer)  | `mcp-binary`                                     | ✅             |
| OpenCode host adapter                                             | `opencode-plugin`                                | ✅             |
| **MCP client / transport / namespacing**                          | _none_ — lives in the host (`agent/src/mcp/`)    | — host concern |
| **Model seam** (the completion call itself)                       | _none_ — by design: the host owns its LLM calls  | — host concern |
| **Configuration** (flags + config file)                           | _none_ — host concern                            | — host concern |
| **Typed memory steps** (task/action/plan records)                 | `spec` (records) + `memory` (history)            | 🟡             |
| **Pause / resume** (`interrupt`/`resume` over durable state)      | `spec` (`Suspension`) + `memory`                 | 🟡             |
| **Delegation + sub-agent sessions**                               | _none_                                           | ❌             |
| **Shared task list + orchestration modes**                        | `spec` (`Task`) + `memory` (`readyTasks`)        | 🟡             |
| **Pipeline / step model** (condition, loop, parallel, router)     | _none_                                           | ❌             |
| **Skills** (`SKILL.md`, progressive disclosure, supply chain)     | _none_                                           | ❌             |
| **Planning passes**                                               | _none_ for the pass; the record is in `spec`     | ❌             |

Legend for the status column: **✅** provided end to end. **🟡** the host-agnostic
half is provided and the rest is deliberately the host's — `Task` (its
dependencies, and the store's `readyTasks` ordering), `ActionStep`/`PlanStep`,
`Suspension` and the methods that persist and read them back as one history are in
`spec`/`memory`, while the coordinator, the planning pass and the pause policy are
the host's. **❌** no home yet.

The first host to exercise both halves is `@adaptivemcp/agent`, which is the
evidence that the split works: it records an `ActionStep` per attempted call,
persists a `PlanStep` from a `--plan-interval` planning pass that re-plans from
`getSteps`, and keeps its task list ordered by `readyTasks` — with none of that
policy in this repo (ROADMAP Phase 9).

Two clarifications, because the names mislead:

- **`orchestration` is not agent orchestration.** Per `AGENTS.md` it owns
  "execution composition, retries, planning experiments" at the **tool-call**
  level. The orchestrator archetype (assigning work to other agents, a shared task
  list with dependencies) has no library — only its record does.
- **`approval` is the decision, not the interaction.** It answers _may I?_; it has
  no notion of _waiting_ for a human. That is `Suspension` (in `spec`), which
  `approval` produces and knows nothing about.

## What the framework deliberately does not do

Worth stating, because it narrows where new libraries could even be justified
(from the workspace `AGENTS.md` and this repo's `AGENTS.md`):

- **No first-class adaptive concepts.** No `adaptiveTool`/`adaptiveSkill`/
  `adaptiveIntent`/`adaptiveWorkflow`. The framework enriches existing MCP
  primitives (tools, resources); it does not add new protocol nouns.
- **Shell/filesystem/process/network are implementation details**, confined to
  `mcp-binary`.
- **The client stays thin** — transport, capability negotiation, middleware hooks,
  execution lifecycle. Business logic lives in middleware packages.
- **Servers govern, clients execute** — a server publishes policy; the client
  applies it as a floor.

That last point matters for the gaps below: a "skills" library would be a _new
protocol noun_ unless it is framed as something the host loads and the server can
point at (e.g. a resource), which is exactly the kind of question an ADR would
have to settle.

## Framework gaps, and whether they are even ours

**Decided in [ADR-004](adr/004-archetype-component-ownership.md)** (2026-10-17).
The question for each missing component was **library or host?**, and the answer
adds **no new packages**: shapes go in `spec`, persistence in `memory`, the step
model extends `orchestration`, and the rest stays with the host.

| Gap                           | Decision                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------ |
| Pause/resume                  | shape in `spec`, storage in `memory`, policy in the host                                   |
| Delegation                    | **host** (sessions, derived permissions, background jobs)                                  |
| Shared task list              | `Task` shape in `spec`, coordinator in the host                                            |
| Step/pipeline model           | **extends `orchestration`** (no new package, no second name)                               |
| Typed memory steps + planning | shape in `spec`/`memory`; the plan pass is the host's                                      |
| Skills                        | not a protocol concept — host loader; a corpus may later be a `dev.adaptivemcp/*` resource |

The criteria that produced those calls, for reference:

| Signal                                                               | Suggests                                             |
| -------------------------------------------------------------------- | ---------------------------------------------------- |
| Host-agnostic, protocol/primitive-shaped, and useful to any MCP host | **library** (like `approval`, `memory`, `telemetry`) |
| Needs the host's session lifecycle, UI, or process model             | **host** (like the MCP client, the model seam)       |
| Observational analytics over what happened                           | **library** (like `evaluation`, `graph-analysis`)    |

## What we already have that is relevant (and under-used)

- **The execution graph.** `graph-analysis` already finds critical paths,
  bottlenecks, failure and causal cascades in a recorded DAG. An orchestrator's
  _reporting_ problem ("what did my children actually do?") is close to a problem
  we have already solved for tool calls — the missing half is _executing_
  a decomposition, not analysing one.
- **`learnedProcedure()`** (host side) surfaces a repeated tool sequence from
  telemetry. We can _notice_ a pipeline; we cannot _define_ or _replay_ one. That
  asymmetry is the natural starting point for a sequential-agent library.
- **`routing`'s `DecodingResolver`** is the template for how a _policy_ component
  should look here: backend-agnostic profile in, backend-specific settings out, no
  host coupling. Any new component (a step model, a task list) should be judged
  against that shape.

## Companion documents

- Host-side catalogue and coverage matrix: `agent/docs/archetypes/README.md`.
- Per-component contracts and references: `agent/docs/archetypes/components.md`.
- The five archetypes: `agent/docs/archetypes/{tool,skills,sequential,human-in-the-loop,orchestrator}-agent.md`.
