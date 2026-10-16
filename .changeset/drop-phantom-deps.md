---
"@adaptivemcp/approval": patch
"@adaptivemcp/evaluation": patch
"@adaptivemcp/extension": patch
"@adaptivemcp/mcp-binary": patch
"@adaptivemcp/opencode-plugin": patch
"@adaptivemcp/orchestration": patch
"@adaptivemcp/routing": patch
"@adaptivemcp/thin-client": patch
---

Drop dependencies that were declared but never imported.

`@adaptivemcp/evaluation` declared six internal dependencies
(approval, extension, orchestration, routing, telemetry, thin-client) that only
its cross-package conformance _test_ imports, so installing it pulled ten
transitive `@adaptivemcp/*` packages instead of three. They move to
`devDependencies`. Five packages declared `@adaptivemcp/memory` but only import it from
tests (their source takes the `Store` interface from `spec`) — it moves to
`devDependencies`. `@adaptivemcp/opencode-plugin` drops three and
`@adaptivemcp/mcp-binary` one. Fewer packages installed, and a declared
graph that matches the real one.
