---
"@adaptivemcp/spec": patch
"@adaptivemcp/extension": patch
"@adaptivemcp/routing": patch
"@adaptivemcp/runtime": minor
---

Fix the MCP resource URI and make the adaptation loop honest.

- **spec**: add `TOOLS_METADATA_RESOURCE_URI` (`dev.adaptivemcp://tools-metadata`), a valid URL form of the logical `TOOLS_METADATA_EXTENSION` identifier, for resource registration and reads.
- **extension**: `ExtensionController.resourceUri()` now returns the valid URI so clients can actually `readResource` it (previously the scheme-less identifier threw `Invalid URL`).
- **routing**: `Router` recommendation rationale now reflects the real heuristic — "Cheapest model for fast tool" vs "Lowest-latency model for slow tool… trades cost for speed" — instead of always claiming "cheapest".
- **runtime**: `AdaptiveRuntime.observeCompleted` now runs only the minimal `telemetry → evaluate → sync` loop. Routing, orchestration, and approval are explicit passes (`router.routeAll()` / `orchestrator.planAll()`) the caller invokes once enough signal has accumulated. This is a behavioral change to the public method, so it is a minor bump.
