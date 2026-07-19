# SEP: Adaptive MCP `tools-metadata` Resource

- **Status**: Draft (proposal)
- **Type**: Extensions Track
- **Extension identifier**: `dev.adaptivemcp/tools-metadata`
- **Vendor prefix**: `dev.adaptivemcp` (reversed domain of `adaptivemcp.dev`, owned by the author)
- **Depends on**: MCP core (resources), SEP-2133 (extension identifiers)

## Abstract

This proposal defines a single, optional MCP **resource** that servers publish to
**suggest** how clients should adapt their use of the server's tools. The resource
is identified by `dev.adaptivemcp/tools-metadata` and carries a document (YAML or
JSON, via content negotiation) describing, per tool: the server's static
**suggestions** (annotations, cost budgets, required approvals) and the
**observed behavior** the client has reported back (failure rates, latencies,
learned insights, suggested recommendations).

The extension follows the same control direction as the MCP **Prompts** primitive:
the **server authors the definition**, and the **client discovers and applies
it**. Unlike Prompts (which return LLM-facing text), this resource returns
*advisory client policy* — the server **suggests**, the **client enforces**. The
client learns and reports; the server MAY fold reports back into the published
view. Enforcement is always the client's responsibility, never the server's.

## Motivation

MCP standardizes *what a server can do* (tools, resources, prompts) and lets the
server **hint** how clients interact with those primitives (e.g. a server declares
a prompt; a client invokes it). MCP does not standardize how a runtime learns
*how those capabilities are actually used* over time, nor how a server can publish
adaptive *suggestions* for clients to follow.

This extension gives servers a uniform, optional surface to **suggest** tool
adaptation. It declares risk, budgets, and required approvals, while letting the
client remain the engine of dynamic learning. Clients that do not understand the
resource simply ignore it (graceful degradation). The server's declarations are
**hints**, not commands: the client decides whether and how to apply them.

## Scope

**In scope**

- The resource URI `dev.adaptivemcp/tools-metadata`.
- The resource MIME types `application/yaml` and `application/json`, selected via
  content negotiation (YAML for humans, JSON as the standard machine target).
- The document schema (see *Schema*): server suggestions + client-reported
  observations.
- A client→server **observation report** channel (see *Observation reporting*),
  so the client can feed learned behavior back to the server that publishes it.

**Out of scope**

- How the client *enforces* suggestions (gate, retry, model selection). The
  client is the enforcer; the server only suggests.
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
| MIME type | `application/yaml` or `application/json` (content negotiation) |

The resource contents are the document defined below, serialized as YAML or JSON
according to the client's preference (see *Content negotiation*). The document is
**server-suggested, client-enforced**: the server owns the `annotation` (static
suggestions) and publishes it; the `insights`, `recommendations`, and `stats`
fields are **client-reported** and MAY be folded into the view by the server. A
server that does not persist reports simply publishes the static `annotation` and
omits the client-reported fields.

### Document schema

```yaml
version: <string>            # schema version of this document (e.g. "0.1.0")
etag: <string>               # opaque cache token; changes when the view changes
generated_at: <ISO-8601>     # when the view was rendered
tools:
  - name: <string>           # tool identifier (matches tools/list name)
    server: <string?>        # originating server name, if known
    annotation:              # STATIC SUGGESTIONS: authored by the server
      risk: <"low"|"medium"|"high">?   # see Risk taxonomy below
      owner: <string?>
      tags: <string[]?>
      description: <string?>
      budget:                # optional cost guardrails the server SUGGESTS
        limit: <number?>     # numeric limit; unit given by `unit`
        unit: <"calls"|"usd"|"tokens">?  # what `limit` counts
        window: <ISO-8601 duration>?     # e.g. "PT1H", "P1D" (RFC 3339 duration)
      require_approval: <boolean?>  # server SUGGESTS confirmation before call
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

**Risk taxonomy.** `annotation.risk` is advisory and carries no protocol-enforced
meaning. Suggested interpretation:
- `low`: safe to call autonomously; no human confirmation expected.
- `medium`: the client SHOULD surface the call or apply a lightweight gate.
- `high`: the client SHOULD require explicit human approval before calling.
Servers MUST NOT rely on clients honoring `risk`; it is a hint only.

**Content negotiation.** A client that requests `application/json` receives the
JSON form; otherwise the server returns YAML by default. Both forms are
semantically identical. Servers that cannot negotiate MAY return a single format.

**Freshness.** The `etag` field is an opaque token that changes whenever the view
changes. Clients SHOULD subscribe to the resource (`resources/subscribe` on
`dev.adaptivemcp/tools-metadata`) and re-read on `notifications/resources/updated`;
the `etag` lets a client skip re-parsing an unchanged view.
```

### Observation reporting (client → server)

The client is the engine of dynamic learning. To close the loop, it reports
observations back to the publishing server. Reporting uses **only** surfaces that
exist in the current MCP protocol (no new notifications are required):

- **Preferred**: the server exposes a `report_observation` **tool**. The client
  calls it after each `tools/call` with a structured payload
  (`{ tool, status, duration_ms, cost, timestamp }`). This keeps reporting on the
  standard tool surface and works on every released SDK today.
- **Not used**: `notifications/message` (logging) is a **server→client**
  notification only and is on the deprecation path (SEP-2577); it cannot carry
  client→server reports and MUST NOT be used for this purpose.

The server remains free to ignore reports (e.g. a stateless server that only
publishes static suggestions). Reporting is best-effort and MUST NOT block tool
execution. A `report_observation` tool is identified by name; clients discover it
via `tools/list` and call it only if present.

**`report_observation` tool schema**

```json
{
  "name": "report_observation",
  "description": "Report a tool execution observation back to the server.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "tool": { "type": "string" },
      "status": { "type": "string", "enum": ["success", "failure", "error"] },
      "duration_ms": { "type": "number" },
      "cost": { "type": "number" },
      "timestamp": { "type": "string", "format": "date-time" }
    },
    "required": ["tool", "status", "timestamp"]
  }
}
```
SEP-2133 defines an `extensions` capability, but at the time of writing it is not
yet present in the released `ClientCapabilities`/`ServerCapabilities` schemas (it
is specified as a future addition). Until SDKs expose `capabilities.extensions`,
servers SHOULD advertise support through the existing `experimental` capability:

```json
{
  "capabilities": {
    "experimental": {
      "dev.adaptivemcp/tools-metadata": {}
    }
  }
}
```

When `capabilities.extensions` becomes available in a target SDK, servers SHOULD
move the advertisement there. In all cases, the resource remains discoverable via
`resources/list`, which is the mandatory fallback for clients that do not parse
capabilities. An empty settings object indicates no per-extension configuration.

### Graceful degradation

- Clients that do not recognize `dev.adaptivemcp/tools-metadata` MUST ignore it.
- The resource is read-only from the client's perspective. A server MAY return an
  error if a client attempts to write to it; clients MUST NOT assume writability.
- Absence of the resource does not change any tool's behavior.
- A server that publishes only static `annotation` (no client reports) still
  provides useful suggestions; clients apply them without learned stats.

## Backwards compatibility

Purely additive. No core protocol change. Breaking changes to the document
schema MUST use a new extension identifier (e.g.
`dev.adaptivemcp/tools-metadata-v2`), per SEP-2133.

## Security considerations

- The document is advisory suggestions + reported observations, not executable.
  Clients MUST validate and treat all fields as untrusted, per SEP-2133.
- `recommendations` and `require_approval` are suggestions; enforcement is the
  client's responsibility and is explicitly out of scope for this extension. A
  client MAY ignore any field without consequence.
- Observation reports are client-supplied and MUST be validated by the server
  before being folded into the published view.
- **Parser safety.** When serving or consuming the YAML form, implementations
  MUST use a strict YAML parser that does not instantiate arbitrary objects
  (e.g. disable custom tags / `!!` constructors). Prefer the JSON form for
  machine parsing to avoid YAML deserialization hazards entirely.
- No secrets, credentials, or PII SHOULD appear in the document or reports.

## Reference implementation

The `Adaptive MCP` project (`@adaptivemcp/extension`) renders this document from a
Store (the persistence boundary defined in `@adaptivemcp/spec`) and registers it
as the `dev.adaptivemcp/tools-metadata` resource, serving both YAML and JSON via
content negotiation. The learning Store is **client-owned**: `@adaptivemcp/runtime`
holds it and learns locally; reporting to the server via the `report_observation`
tool is best-effort and optional. A conforming server registers `report_observation`
as a real MCP tool (see `ExtensionController.reportObservationTool()` and the
example server in `examples/src/server.ts`) so clients can discover and call it.
The client-side learning packages
(`@adaptivemcp/telemetry`, `@adaptivemcp/evaluation`, `@adaptivemcp/routing`,
`@adaptivemcp/orchestration`, `@adaptivemcp/approval`, `@adaptivemcp/thin-client`)
are the executor: they learn dynamically and report observations back to the
publishing server.
