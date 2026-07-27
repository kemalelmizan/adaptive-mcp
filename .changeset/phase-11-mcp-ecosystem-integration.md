---
"@adaptivemcp/spec": minor
"@adaptivemcp/extension": minor
"@adaptivemcp/thin-client": minor
"@adaptivemcp/runtime": minor
---

Phase 11 MCP ecosystem integration:

- `@adaptivemcp/spec`: new canonical `ExecutionGraphResource` wire schema and pure `buildExecutionGraph` builder (`execution-graph.ts`), replacing the dead, Map-based (non-JSON-serializable) `ExecutionGraph` type, which had zero consumers.
- `@adaptivemcp/extension`: `executionGraphResourceUri`/`workflowGraphResourceUri`/`graphInsightsResourceUri`/`executionGraphMermaidResourceUri` now return correctly-formed `dev.adaptivemcp://...` URIs (previously missing the `//`, a latent bug harmless until these were wired into real MCP protocol dispatch). `executionGraphResourceText` gains `cursor`/`pageSize` pagination options; edges are always returned in full regardless of the current node page.
- `@adaptivemcp/thin-client`: `GraphTrackingMiddleware` now generates a valid W3C `traceparent` per node (deterministically derived from existing `ExecutionNode` UUIDs — `traceId`/`spanId`/`parentSpanId`/`traceparent` on `metadata`), exposed via a new `getTraceParent()` method. This is a data-plane correlation primitive, not literal over-the-wire header propagation — no live MCP transport exists in this codebase to carry HTTP headers on.
- `@adaptivemcp/runtime`: `AdaptiveRuntimeOptions.enableGraph` plus `startWorkflow`/`startChild`/`completeNode`/`failNode` pass-throughs, bringing this package to parity with the example-local runtime's existing graph-tracking wiring.
- `examples/`: the execution-graph resource is now a real, working `ResourceTemplate` with pagination and `resources/subscribe`/`notifications/resources/updated`, verified end-to-end with a live stdio client/server run.
