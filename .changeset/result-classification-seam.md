---
"@adaptivemcp/spec": minor
"@adaptivemcp/thin-client": minor
---

Add a **result-classification seam**. Some MCP servers report logical failures
in-band — a successful transport result whose JSON payload carries an error
status (e.g. `{ "status": "error", "error": "POLICY_DENIED" }`) — instead of the
protocol-level `isError` flag. Previously `ThinClient` recorded those as
successes, corrupting every derived signal.

- `@adaptivemcp/spec`: new `ToolCallOutcome`, `ToolResultClassification`,
  `ToolResultContext`, and `ToolResultClassifier` types.
- `@adaptivemcp/thin-client`: `ThinClientOptions.classifyResult` runs on each
  attempt, before the outcome is recorded and before the retry decision (so a
  reclassified failure counts as a failure and can trigger retry). Adds an
  `envelopeClassifier()` helper for the common status/error envelope shape.
