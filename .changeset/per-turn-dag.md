---
"@adaptivemcp/thin-client": minor
---

Add `GraphTrackingMiddleware.runTurn(label, fn)`: runs a batch of top-level tool
calls under one execution-graph root, so a turn with several calls forms a single
DAG instead of one disconnected root per call. The root is completed when `fn`
resolves and failed when it rejects. Existing per-call-root behavior is unchanged
when `runTurn` is not used.
