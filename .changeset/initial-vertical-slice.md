---
"@adaptivemcp/spec": minor
"@adaptivemcp/memory": minor
"@adaptivemcp/telemetry": minor
"@adaptivemcp/evaluation": minor
"@adaptivemcp/extension": minor
---

Initial adaptive implementation: spec foundation (extension identifiers, event
schemas, shared types), SQLite-backed memory store (SSOT), telemetry
(recorder + memory-backed store + queries), evaluation (insight generation from
observed stats), and the extension controller that derives the
`tools-metadata.yaml` view from the SQLite SSOT.
