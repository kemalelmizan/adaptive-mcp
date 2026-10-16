---
"@adaptivemcp/approval": patch
"@adaptivemcp/evaluation": patch
"@adaptivemcp/extension": patch
"@adaptivemcp/graph-analysis": patch
"@adaptivemcp/mcp-binary": patch
"@adaptivemcp/memory": patch
"@adaptivemcp/middleware": patch
"@adaptivemcp/opencode-plugin": patch
"@adaptivemcp/orchestration": patch
"@adaptivemcp/routing": patch
"@adaptivemcp/runtime": patch
"@adaptivemcp/telemetry": patch
"@adaptivemcp/thin-client": patch
---

Internal dependencies now use caret ranges (`workspace:^`) instead of exact pins.

pnpm rewrote `workspace:*` to an exact version on publish, so a consumer mixing
`@adaptivemcp/*` packages from different releases could end up with two copies of
the same package (duplicate state, `instanceof` mismatches, no dedupe). The
ranges are now compatible (`^x.y.z`), so a resolver picks one copy.
