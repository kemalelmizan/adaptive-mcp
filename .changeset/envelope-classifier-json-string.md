---
"@adaptivemcp/thin-client": minor
---

`envelopeClassifier` now also inspects JSON-**string** outputs. Most MCP servers
serialize an in-band envelope as text content (a plain `dict` return produces no
`structuredContent`), so the payload arrives as a string — for example a
FastMCP server returning `{ "status": "error", "error": "POLICY_DENIED" }` as
text. The parse is guarded (only strings starting with `{`) and can be disabled
with `parseJsonString: false`.
