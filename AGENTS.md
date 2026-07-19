# AGENTS.md

This document captures the architectural principles and development philosophy of Adaptive MCP.

## Project mission

Adaptive MCP explores adaptive behavior around MCP primitives.

The project does **not** attempt to replace MCP, redefine tools, or introduce entirely new protocol abstractions.

Instead, Adaptive MCP investigates:

* observations;
* annotations;
* insights;
* recommendations.

## Non-goals

Avoid introducing:

* `adaptiveTool`
* `adaptiveSkill`
* `adaptiveIntent`
* `adaptiveWorkflow`

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

* shell commands;
* filesystems;
* processes;
* sockets;
* HTTP requests.

Those remain implementation details.

### Middleware is operational machinery

Middleware is not the product.

Middleware exists to:

* observe;
* evaluate;
* remember;
* route;
* recommend.

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

* transport;
* capability negotiation;
* middleware hooks;
* execution lifecycle.

Business logic belongs in middleware packages.

### Stateless servers, governing clients

Assume MCP servers are:

* lightweight;
* stateless;
* replaceable.

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

* extension identifiers;
* event schemas;
* shared interfaces.

Must remain dependency-light.

### `telemetry`

Owns:

* traces;
* events;
* metrics;
* execution history.

### `evaluation`

Owns:

* scoring;
* feedback collection;
* quality signals.

### `memory`

Owns:

* persistence;
* pattern extraction;
* historical context.

### `routing`

Owns:

* model selection;
* budget optimization;
* fallback strategies.

### `orchestration`

Owns:

* execution composition;
* retries;
* planning experiments.

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

* What should users approve?
* Can approval boundaries adapt?
* How much autonomy should agents receive?

## Repository conventions

Package naming:

```text
@adaptivemcp/<package>
```

Examples:

```text
@adaptivemcp/sdk
@adaptivemcp/spec
@adaptivemcp/telemetry
```

Monorepo structure:

```text
apps/
packages/
examples/
docs/
```

Use:

* TypeScript
* pnpm workspaces
* Changesets
* ESLint
* Prettier
* Vitest

## Long-term research questions

* Which tools naturally cluster together?
* Which metadata fields become stale?
* Which approval boundaries do humans prefer?
* Which models perform best for specific tools?
* Can workflows emerge from telemetry?
* Can metadata evolve safely?

## Guiding sentence

When making design decisions, optimize for this statement:

> MCP standardizes capabilities.

> Adaptive MCP learns behavior.
