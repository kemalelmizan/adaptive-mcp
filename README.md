# Adaptive MCP

Adaptive MCP explores a simple question:

> MCP standardizes capabilities. Can the semantics surrounding those capabilities evolve over time?

Model Context Protocol (MCP) gives us a common language for exposing tools, resources, and prompts to models. It improves interoperability and debuggability by introducing explicit boundaries.

Adaptive MCP investigates what happens after those boundaries exist.

Rather than inventing new primitives, Adaptive MCP focuses on:

* observing how tools are actually used;
* attaching metadata to existing MCP primitives;
* learning from telemetry and evaluations;
* helping runtimes adapt over time.

## Motivation

Humans rarely think in tool calls.

We think in goals:

* "Fix the production outage."
* "Prepare me for tomorrow's meeting."
* "Help me onboard a new employee."

Meanwhile, agents operate on bounded actions:

```text
read_logs()

create_ticket()

send_email()
```

Somewhere between human intent and tool invocation lies a large amount of hidden logic:

* prompts;
* orchestration frameworks;
* Python glue code;
* workflows;
* institutional knowledge.

Adaptive MCP is an attempt to explore that missing layer.

## Philosophy

Adaptive MCP is built around several principles.

### MCP already solved important problems

MCP provides:

* capability discovery;
* tool invocation;
* resources;
* prompts;
* interoperability.

More importantly, it makes agent systems easier to reason about.

Adaptive MCP does not replace MCP.

It builds on top of it.

### Tools are meaningful boundaries

Operating systems expose mechanisms:

* files;
* processes;
* sockets;
* shell commands.

MCP exposes application-level boundaries:

* `search_customer()`;
* `deploy_service()`;
* `create_invoice()`.

Adaptive MCP treats tools as the smallest portable unit of agency.

### Metadata is valuable, but static

Static metadata:

```yaml
tool:
  name: deploy_service

metadata:
  risk: high
  owner: platform
```

Adaptive metadata:

```yaml
tool:
  name: deploy_service

insights:
  preferred_model: gpt-5-mini
  human_review_frequency: 82%
  observed_failure_rate: 12%
```

The goal is not to replace human judgment.

The goal is to allow systems to accumulate operational knowledge.

## Core hypothesis

Annotations are written.

Insights are learned.

Recommendations are suggested.

Adaptive MCP explores whether telemetry, memory, evaluation, and routing can continuously improve the metadata surrounding MCP primitives.

## Architecture

```text
┌─────────────────────────┐
│        Client           │
├─────────────────────────┤
│ Adaptive MCP Middleware │
├─────────────────────────┤
│      MCP Protocol       │
├─────────────────────────┤
│        Server           │
└─────────────────────────┘
```

Adaptive MCP intentionally lives at the runtime layer.

MCP servers remain lightweight and stateless.

## Planned capabilities

### Observation

* Telemetry
* Metrics
* Tracing
* Cost tracking

### Learning

* Evaluations
* Memory
* Pattern discovery
* Human feedback

### Adaptation

* Model routing
* Recommendations
* Approval policies
* Workflow suggestions

### Runtime

* Middleware pipeline
* Extension support
* Client SDK
* Thin client

## Monorepo layout

```text
adaptive-mcp/
├── apps/
│   ├── docs/
│   └── playground/
│
├── packages/
│   ├── spec/
│   ├── telemetry/
│   ├── memory/
│   ├── evaluation/
│   ├── routing/
│   ├── orchestration/
│   ├── approval/
│   ├── sdk/
│   └── thin-client/
│
├── examples/
├── scripts/
├── docs/
└── AGENTS.md
```

## Packages

### `@adaptivemcp/spec`

Extension identifiers, schemas, and shared types.

### `@adaptivemcp/telemetry`

Tool execution events and observability.

### `@adaptivemcp/memory`

Persistent operational knowledge.

### `@adaptivemcp/evaluation`

Outcome scoring and feedback loops.

### `@adaptivemcp/routing`

Model selection and cost optimization.

### `@adaptivemcp/orchestration`

Composition and execution strategies.

### `@adaptivemcp/approval`

Intent, plan, and tool approval experiments.

### `@adaptivemcp/sdk`

Middleware APIs and developer experience.

### `@adaptivemcp/thin-client`

Minimal MCP client implementation.

## NPM organization

Canonical namespace:

```text
@adaptivemcp/*
```

Examples:

```text
@adaptivemcp/sdk
@adaptivemcp/spec
@adaptivemcp/telemetry
```

## Status

Adaptive MCP is currently a research project and an exploration of ideas around adaptive metadata, runtime learning, and agent boundaries.

The project is intentionally opinionated, but its central question remains open:

> How should we bridge the gap between human intent and tool invocation?
