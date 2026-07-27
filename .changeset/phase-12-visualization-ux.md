---
"@adaptivemcp/extension": minor
---

Phase 12 visualization & UX:

- `@adaptivemcp/extension`: new `executionGraphDotResourceUri`/`executionGraphDotResourceText` — a GraphViz DOT export alongside the existing Mermaid export, at `dev.adaptivemcp://execution-graph/{sessionId}/dot`. Also removes a dead, unused `nodeMap` variable from `executionGraphMermaidResourceText`.
- `examples/`: new `debugging-deployment` scenario (`pnpm scenario:debugging-deployment`) demonstrating the Phase 10 graph-inspection tools no other scenario exercises — causal cascade (root causes vs. symptoms across two independent failure chains), anti-pattern detection, and workflow forecasting — plus Mermaid/DOT diagram exports of the failed graph. `AdaptiveRuntime.startWorkflow` (example-local runtime) gained an optional `sessionId` to support this.
