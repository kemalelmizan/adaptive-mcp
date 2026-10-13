# ADR-002: Server suggestions are a floor, never an override

**Status:** Accepted (2026-09-29). Deep dive: `docs/doubts.md` §10/§11; extension
text: `docs/sep-2133-tools-metadata.md` §Security.

## Context

Adaptive MCP lets a server **govern** adaptation by publishing a
`dev.adaptivemcp/tools-metadata` resource (static annotations, `require_approval`,
cost budgets), while clients **execute and report**. This mirrors MCP Prompts
(server authors, client discovers and applies) and fits "stateless servers,
governing clients".

The open question was precedence: when a server's suggestion disagrees with the
host's own consent UI or with what the client has learned, who wins? A server is
also untrusted input (`SECURITY.md` threat 1), so a forged document must not be
able to weaken a gate.

## Decision

Precedence is fixed and one-directional:

```text
host consent UI  >  Adaptive MCP / server suggestion  >  learned  >  nothing
```

- A server's `require_approval: false` or `budget` NEVER lowers a gate the host
  already applies; the host MAY always prompt.
- Static `risk` is projected onto the protocol's native (untrusted)
  `ToolAnnotations` via `riskToToolAnnotations`, rather than treated as an
  authority; the resource's `annotation.risk` is reserved for learned risk.
- Neither server nor learned values are overwritten by the other in a way that
  reduces safety: agents apply server metadata as a **floor**.

Concretely, the first-party agent's `AgentRuntime.applyServerMetadata` only
seeds values that are **absent** (never overwrites human/learned values), and
`require_approval: true` raises risk to `high`.

## Consequences

- A malicious or buggy server cannot silently weaken a host's gate.
- Servers can still raise protections (owner/description, required approval,
  budgets) and steer learning.
- The host owns the final call; "advisory, never enforced" holds end to end.

## Alternatives considered

- **Server wins.** Rejected: lets untrusted input lower safety.
- **Learned wins over server.** Rejected: ignores explicit server policy and
  makes behavior unstable across fresh stores.
- **New enforcement primitive.** Rejected by the project's core principle: enrich
  MCP primitives, do not add `adaptive*` first-class concepts.
