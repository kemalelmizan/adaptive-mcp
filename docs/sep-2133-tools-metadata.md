# SEP: Adaptive MCP `tools-metadata` Resource

- **Status**: Draft (proposal)
- **Type**: Extensions Track
- **Extension identifier**: `dev.adaptivemcp/tools-metadata`
- **Vendor prefix**: `dev.adaptivemcp` (reversed domain of `adaptivemcp.dev`, owned by the author)
- **Depends on**: MCP core (resources), SEP-2133 (extension identifiers)

## Abstract

This proposal defines a single, optional MCP **resource** that servers publish to
**govern** how clients should adapt their use of the server's tools. The resource
is identified by `dev.adaptivemcp/tools-metadata` and carries a YAML document
describing, per tool: the server's static **governance** (annotations, cost
budgets, required approvals) and the **observed behavior** the client has
reported back (failure rates, latencies, learned insights, suggested
recommendations).

The extension follows the same control direction as the MCP **Prompts** primitive:
the **server authors the definition**, and the **client discovers and applies
it**. Unlike Prompts (which return LLM-facing text), this resource returns
machine-enforced *client policy*. The server governs; the client learns and
reports; the server folds reports back into the published view.

## Motivation

MCP standardizes *what a server can do* (tools, resources, prompts) and lets the
server **govern** how clients interact with those primitives (e.g. a server
declares a prompt; a client invokes it). MCP does not standardize how a runtime
learns *how those capabilities are actually used* over time, nor how a server can
publish adaptive policy for clients to follow.

This extension gives servers a uniform, optional surface to **govern** tool
adaptation. It declares risk, budgets, and required approvals, while letting the
client remain the engine of dynamic learning. Clients that do not understand the
resource simply ignore it (graceful degradation).

## Scope

**In scope**

- The resource URI `dev.adaptivemcp/tools-metadata`.
- The resource MIME type `application/yaml`.
- The document schema (see *Schema*): server governance + client-reported
  observations.
- A client→server **observation report** channel (see *Observation reporting*),
  so the client can feed learned behavior back to the server that governs it.

**Out of scope**

- How the client *enforces* policy (gate, retry, model selection). The client is
  the executor; the server is the governor.
- Any change to `tools/list`, `tools/call`, or tool schemas.
- Transport, auth, or discovery beyond core MCP.

## Specification

### Resource

A supporting server registers one resource:

| Field | Value |
| --- | --- |
| URI | `dev.adaptivemcp/tools-metadata` |
| Name | `tools-metadata` |
| Title | `Adaptive MCP Tools Metadata` |
| MIME type | `application/yaml` |

The resource contents are the YAML document defined below. The document is
**server-governed**: the server owns the `annotation` (static governance) and
publishes it; the `insights`, `recommendations`, and `stats` fields are
**client-reported** and folded into the view by the server.

### Document schema

```yaml
version: <string>            # schema version of this document (e.g. "0.1.0")
generated_at: <ISO-8601>     # when the view was rendered
tools:
  - name: <string>           # tool identifier (matches tools/list name)
    server: <string?>        # originating server name, if known
    annotation:              # STATIC GOVERNANCE: authored by the server
      risk: <string?>        # e.g. "low" | "medium" | "high"
      owner: <string?>
      tags: <string[]?>
      description: <string?>
      budget:                # optional cost guardrails the server sets
        limit: <number?>
        window: <string?>
      require_approval: <boolean?>  # server mandates confirmation before call
    insights:                # CLIENT-REPORTED: learned from observed behavior
      <key>:
        value: <any>
        confidence: <number> # 0..1
        source: <string>     # e.g. "evaluation" | "telemetry"
    recommendations:         # CLIENT-REPORTED: suggested adaptations
      - type: <string>       # e.g. "model" | "approval" | "workflow" | "routing"
        payload: <any>
        rationale: <string>
    stats:                   # CLIENT-REPORTED: folded from execution events
      invocations: <number>
      failures: <number>
      failure_rate: <number> # 0..1
      avg_duration_ms: <number | null>
      total_cost: <number>
      last_observed_at: <ISO-8601 | null>
    updated_at: <ISO-8601>
```

### Observation reporting (client → server)

The client is the engine of dynamic learning. To close the loop, it reports
observations back to the governing server. This proposal reuses existing MCP
surfaces rather than inventing a new method:

- **Preferred**: the client sends `notifications/message` (logging level) or a
  dedicated `logging` entry carrying a structured observation payload
  (`{ tool, status, duration_ms, cost, timestamp }`). The server subscribes and
  folds these into the published view.
- **Alternative**: the server exposes a small `report_observation` **tool**; the
  client calls it after each `tools/call`. This keeps reporting on the standard
  tool surface but adds a round-trip per execution.

The server remains free to ignore reports (e.g. a stateless server that only
publishes static governance). Reporting is best-effort and MUST NOT block tool
execution.

### Advertising support (SEP-2133)

When the host SDK supports `capabilities.extensions`, a server advertises the
extension in `initialize`:

```json
{
  "capabilities": {
    "extensions": {
      "dev.adaptivemcp/tools-metadata": {}
    }
  }
}
```

An empty settings object indicates no per-extension configuration. Servers that
register the resource but run on an SDK without `capabilities.extensions` simply
omit the advertisement; the resource remains discoverable via `resources/list`.

### Graceful degradation

- Clients that do not recognize `dev.adaptivemcp/tools-metadata` MUST ignore it.
- The resource is read-only from the client's perspective. A server MAY return an
  error if a client attempts to write to it; clients MUST NOT assume writability.
- Absence of the resource does not change any tool's behavior.
- A server that publishes only static `annotation` (no client reports) still
  provides useful governance; clients apply it without learned stats.

## Backwards compatibility

Purely additive. No core protocol change. Breaking changes to the document
schema MUST use a new extension identifier (e.g.
`dev.adaptivemcp/tools-metadata-v2`), per SEP-2133.

## Security considerations

- The document is advisory governance + reported observations, not executable.
  Clients MUST validate and treat all fields as untrusted, per SEP-2133.
- `recommendations` are suggestions; enforcement is the client's responsibility
  and is explicitly out of scope for this extension.
- Observation reports are client-supplied and MUST be validated by the server
  before being folded into the published view.
- No secrets, credentials, or PII SHOULD appear in the document or reports.

## Reference implementation

The `Adaptive MCP` project (`@adaptivemcp/extension`) renders this document from
a SQLite source of truth and registers it as the `dev.adaptivemcp/tools-metadata`
resource. The client-side learning packages (`@adaptivemcp/telemetry`,
`@adaptivemcp/evaluation`, `@adaptivemcp/routing`, `@adaptivemcp/orchestration`,
`@adaptivemcp/approval`, `@adaptivemcp/thin-client`) are the executor: they learn
dynamically and report observations back to the governing server.
