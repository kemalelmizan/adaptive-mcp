# SEP: Adaptive MCP `tools-metadata` Resource

- **Status**: Experimental / Incubating
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
| Extension identifier | `dev.adaptivemcp/tools-metadata` (scheme-less, per SEP-2133 naming) |
| Resource URI (wire) | `dev.adaptivemcp://tools-metadata` (the identifier with a `://` URI scheme) |
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
        limit: <number>      # numeric limit
        currency: <string?>  # e.g. "USD" (when the limit is monetary)
      require_approval: <boolean?>  # server SUGGESTS confirmation before call
    # NOTE: `budget` and `require_approval` are populated by the reference
    # implementation (`@adaptivemcp/extension`) from routing/approval
    # recommendations once one exists for a tool (see ROADMAP Phase 6f). They
    # remain optional per the schema; clients MUST treat them as suggestions.
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
    metrics:                 # CLIENT-REPORTED (optional): pre-aggregated rollups
      "<label>":             # window/dimension, e.g. "all", "hour:2026-09-29T13",
                             # "all model=qwen", "all decoding=deterministic@qwen/1.0.0"
        invocations: <number>
        failures: <number>
        failure_rate: <number>       # 0..1
        avg_duration_ms: <number | null>
        avg_input_tokens: <number?>  # when token usage is known
        avg_output_tokens: <number?>
        retry_rate: <number>         # (attempts - invocations) / invocations
        total_cost: <number>
        ewma_failure_rate: <number?> # recency-weighted failure rate
    updated_at: <ISO-8601>
```

**`metrics` (bounded pre-aggregation).** `stats` is one lifetime row per tool;
`metrics` optionally exposes *multi-dimensional* rollups so a consumer can read
rich, comparable metadata **without the server retaining an event log**. Each key
is a window/dimension label; each value is a folded cell (counters, token/cost
sums, a fixed-bucket latency histogram behind `avg_duration_ms`, retry rate, and
an EWMA for recency). Cardinality is bounded: `all` always exists, `hour:<...>`
windows cover drift, and per-`model`/per-`decoding-profile` labels are capped
(unknown values collapse into an `other` bucket).

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
      "duration_ms": { "type": "number", "minimum": 0 },
      "cost": { "type": "number", "minimum": 0 },
      "timestamp": { "type": "string", "format": "date-time" },
      "client_id": { "type": "string", "description": "Optional caller identifier for per-client aggregation." }
    },
    "required": ["tool", "status", "timestamp"]
  }
}
```

**Two-store model.** There are two distinct stores. (1) The **client-owned local
store** — the client learns from its own executions and improves *that client
only*; this is the primary value of the extension and works with no server
involvement. (2) The **server-published view** — a *separate, optional* cross-client
signal the server MAY assemble by folding `report_observation` reports. A stateless
server that ignores reports still publishes a useful static `annotation`, but its
view does **not** reflect any single client's learned behavior. Adopters MUST NOT
assume a stateless server's view reflects their local learning; the local store is
the source of truth for that client.

**Server handling of reports.** Reports are client-supplied and MUST be validated
by the server before being folded into the published view (see *Security
considerations*). A conforming server:

- MAY ignore reports entirely. A stateless server SHOULD still register the tool
  but treat it as a no-op (a *conformance signal*); folding is **opt-in** via a
  server flag (e.g. `foldReports`). When folding is disabled, the tool returns
  `accepted: false` and does not mutate state.
- MUST validate the payload: `duration_ms` and `cost` MUST be finite and
  non-negative (otherwise dropped); `timestamp` MUST be a parseable ISO-8601
  date (otherwise the server substitutes the receipt time so `stats.last_observed_at`
  stays meaningful).
- SHOULD `ensureTool` before recording so reports for not-yet-known tools are
  accepted gracefully rather than rejected.
- MAY record `client_id` (when supplied) so it can later support **per-client vs
  aggregated** semantics (see *Multi-client semantics*).

**Multi-client semantics.** When multiple clients report, the server decides
whether to fold reports into a single shared view (aggregated stats) or to keep
per-client views keyed by `client_id`. This extension does not mandate one model;
the default reference impl aggregates all reports into the published view, while
preserving `client_id` in the underlying event metadata for deployments that want
per-client isolation. The value proposition (per-client learning vs cross-client
aggregated signal) is a deployment choice, not a protocol requirement.
SEP-2133 defines an `extensions` capability, and it is now part of the released
wire schema (the TypeScript SDK exposes `extensions?: Record<string, object>` on
both `ClientCapabilities` and `ServerCapabilities` as of `@modelcontextprotocol/sdk@1.29.0`).
Servers SHOULD advertise support through the `extensions` capability:

```json
{
  "capabilities": {
    "extensions": {
      "dev.adaptivemcp/tools-metadata": {}
    }
  }
}
```

For SDKs older than the SEP-2133 Final cut, servers MAY fall back to advertising
under the existing `experimental` capability. In all cases, the resource remains
discoverable via `resources/list`, which is the mandatory fallback for clients
that do not parse capabilities. An empty settings object indicates no per-extension
configuration.

### Graceful degradation

- Clients that do not recognize `dev.adaptivemcp/tools-metadata` MUST ignore it.
- The resource is read-only from the client's perspective. A server MAY return an
  error if a client attempts to write to it; clients MUST NOT assume writability.
- Absence of the resource does not change any tool's behavior.
- A server that publishes only static `annotation` (no client reports) still
  provides useful suggestions; clients apply them without learned stats.

## Maturity & graduation

This extension is published as **Experimental / Incubating** under SEP-2133's
incubation pathway. It is usable and has a reference implementation, but it is not
yet on the track to **Final** for the following reason:

- SEP-2133 requires *"at least one reference implementation in an official SDK
  prior to review."* The current reference implementation lives in
  `@adaptivemcp/extension` (the Adaptive MCP project), **not** in an official
  MCP SDK (`@modelcontextprotocol/sdk`). Until a minimal conformance module is
  contributed upstream into an official SDK, this SEP remains Experimental.

**Graduation plan.** To reach Final, the following are planned (not yet done):

1. Contribute a minimal `toolsMetadata` module to `@modelcontextprotocol/sdk`
   (TypeScript) exporting: the `report_observation` tool definition, the
   `renderToolsMetadata` / `toDocument` helpers, and the `experimental`
   capability advertisement helper. `@adaptivemcp/extension` remains the
   canonical, richer implementation; the SDK module is the minimal conformance
   surface.
2. Engage **Server Card** (MCP issue #1649) as the likely long-term home for
   governance metadata — SEP-2133's own framing points there — so this
   extension complements rather than duplicates core governance work.
3. Publish a conformance test suite so other SDKs can self-verify against this
   document.

Until then, the extension is safe to adopt experimentally; breaking changes use a
new extension identifier per *Backwards compatibility*.

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
- **Precedence (governance overlap with the host consent UI).** Consent is a
  client/host responsibility per the MCP Tools spec ("there SHOULD always be a
  human in the loop"; clients SHOULD prompt on sensitive operations). Adaptive
  MCP's `require_approval` / `budget` are *server suggestions* about when that
  gate should fire, not an enforcement mechanism. The precedence is therefore:

  ```
  host consent UI  >  Adaptive MCP suggestion  >  nothing
  ```

  - The host MAY always prompt, regardless of `require_approval`.
  - `require_approval: true` is a request the host SHOULD honor but MAY ignore.
  - `require_approval: false` / `budget` NEVER lowers a gate the host already
    applies.
  - Static `risk` SHOULD be projected onto core `Tool.annotations` (via
    `riskToToolAnnotations`) rather than emitted as a parallel field, to avoid
    duplicating the protocol's native (untrusted) risk signal. The resource's
    `annotation.risk` is reserved for learned/observed risk. See doubts.md §10/§11.
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
publishing server. The derived view also exposes an optional bounded `metrics`
rollup (from `@adaptivemcp/memory`'s pre-aggregated `metric_cells`) so consumers
get rich, queryable metadata without an event log.
