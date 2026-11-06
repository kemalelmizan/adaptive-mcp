# AGENTS.md

This document captures the architectural principles and development philosophy of Adaptive MCP.

## Project mission

Adaptive MCP explores adaptive behavior around MCP primitives.

The project does **not** attempt to replace MCP, redefine tools, or introduce entirely new protocol abstractions.

Instead, Adaptive MCP investigates:

- observations;
- annotations;
- insights;
- recommendations.

## Non-goals

Avoid introducing:

- `adaptiveTool`
- `adaptiveSkill`
- `adaptiveIntent`
- `adaptiveWorkflow`

as first-class protocol concepts.

Adaptive MCP should enrich existing MCP primitives instead of competing with them.

## Core principles

### MCP standardizes capabilities

MCP answers:

> What can the model do?

Adaptive MCP answers:

> What have we learned about how models and humans use those capabilities?

### Prefer application boundaries

Adaptive MCP operates on MCP primitives because they are intentional boundaries.

Avoid coupling to:

- shell commands;
- filesystems;
- processes;
- sockets;
- HTTP requests.

Those remain implementation details.

### Middleware is operational machinery

Middleware is not the product.

Middleware exists to:

- observe;
- evaluate;
- remember;
- route;
- recommend.

The adaptation loop:

```text
Tool execution
    ↓
Telemetry
    ↓
Evaluation
    ↓
Memory
    ↓
Routing
    ↓
Metadata update
```

## Architectural direction

### Thin client

The client should remain small:

- transport;
- capability negotiation;
- middleware hooks;
- execution lifecycle.

Business logic belongs in middleware packages.

### Stateless servers, governing clients

Assume MCP servers are:

- lightweight;
- stateless;
- replaceable.

Servers **govern**: they publish adaptive policy (annotations, cost budgets,
required approvals) as the `dev.adaptivemcp/tools-metadata` resource, following
the same control direction as the MCP Prompts primitive (server authors, client
discovers & applies).

Clients **execute and report**: they are the engine of dynamic learning
(telemetry, evaluation, routing, orchestration, approval) and report
observations back to the governing server. Clients accumulate knowledge; the
server folds reports into the published view.

### Extensions over frameworks

Prefer:

```text
MCP + extensions
```

over:

```text
Adaptive MCP protocol
```

Adaptive MCP should feel like a runtime ecosystem rather than an alternative protocol.

## Package responsibilities

### `spec`

Owns:

- extension identifiers;
- event schemas;
- shared interfaces.

Must remain dependency-light.

### `telemetry`

Owns:

- traces;
- events;
- metrics;
- execution history.

### `evaluation`

Owns:

- scoring;
- feedback collection;
- quality signals.

### `memory`

Owns:

- persistence;
- pattern extraction;
- historical context.

### `routing`

Owns:

- model selection;
- budget optimization;
- fallback strategies.

### `orchestration`

Owns:

- execution composition;
- retries;
- planning experiments.

### `approval`

Experimental package.

Research topics:

```text
Intent
    ↓
Plan
    ↓
Tool
```

Open questions:

- What should users approve?
- Can approval boundaries adapt?
- How much autonomy should agents receive?

## Repository conventions

Package naming:

```text
@adaptivemcp/<package>
```

Examples:

```text
@adaptivemcp/spec
@adaptivemcp/telemetry
@adaptivemcp/middleware
```

Monorepo structure:

```text
apps/
packages/
examples/
docs/
```

Use:

- TypeScript
- pnpm workspaces
- Changesets
- ESLint
- Prettier
- Vitest

**Type checking is a gate, not a side effect of building.** `pnpm typecheck`
runs one program over every package's source _and_ its tests, plus `examples/`
and `scripts/` (`tsconfig.check.json`, using `paths` so packages resolve each
other's source). Without it the test suites and `scripts/` went unchecked — 15
packages' worth — and 34 type errors had accumulated there: a private field a
test reached through, a `PackageJson` type missing `description`, and two
argument-reading bugs in the release scripts.

**Prettier caveat.** `pnpm format` (`prettier --write .`) rewrites files you did
not touch: the committed tree predates the current prettier's output for TS
argument wrapping and for markdown (`*` bullets and `*emphasis*` become `-` and
`_emphasis_`), and **no prettier version in the declared range is clean** (#49
measured 98–116 unformatted files across 3.3.3 / 3.5.3 / 3.7.4 / 3.9.5, and 114
with `printWidth: 120`). Run prettier on the files a change already touches, never
as a blanket sweep — a blanket run buries the real change in cosmetic churn across
~98 files.

`pnpm format:check` enforces exactly that rule in CI (`scripts/check-format.mjs`): a
**new** file, or a file that was already clean at the merge base, must be formatted;
a file that was already drifting is listed as a warning and not gated. So CI now
catches formatting regressions without a mass reformat, and it will never fail you
for drift you did not introduce. The gate compares against `origin/main` by default;
set `FORMAT_BASE=<ref>` to compare against something else.

## Long-term research questions

- Which tools naturally cluster together?
- Which metadata fields become stale?
- Which approval boundaries do humans prefer?
- Which models perform best for specific tools?
- Can workflows emerge from telemetry?
- Can metadata evolve safely?

## Standards & conformance

This repo is not an MCP SDK, so it has no SDK tier to claim — but
[`docs/sdk-tiers.md`](docs/sdk-tiers.md) grades it against the
[MCP SDK tiering requirements](https://modelcontextprotocol.io/community/sdk-tiers)
(conformance, feature tracking, triage labels, releases, docs, dependency policy,
roadmap) and names what is missing. Read it before claiming protocol support.

## Guiding sentence

When making design decisions, optimize for this statement:

> MCP standardizes capabilities.

> Adaptive MCP learns behavior.
