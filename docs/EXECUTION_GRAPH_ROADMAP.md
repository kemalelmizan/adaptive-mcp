# Adaptive MCP: Distributed Execution Graph Roadmap

## Vision

Transform telemetry from **request logging** into **execution intelligence** by treating every tool invocation as a node in a directed acyclic graph (DAG). This enables:

- **Distributed traces** — end-to-end latency, critical path, tail latency
- **Performance bottlenecks** — slowest path, fan-out/fan-in analysis
- **Workflow visualizations** — auto-generated architecture diagrams
- **Dependency maps** — which tools call which, blast radius analysis
- **Success/failure rates per workflow** — not just per tool
- **Cost per workflow** — aggregate cost attribution
- **AI reasoning patterns** — how models chain tools, common failure cascades

---

## Implementation Status: ✅ Phases 4-9 COMPLETE

All foundation phases have been implemented and validated with working scenarios.

### What Was Built

| Phase | Package | Status | Key Deliverables |
|-------|---------|--------|------------------|
| 4.1 | `@adaptivemcp/spec` | ✅ Done | `ExecutionNode`, `ExecutionGraph`, `CriticalPathResult`, `Bottleneck`, `FanOutReport`, `FailureCascade`, `CostBreakdown`, `WorkflowStats`, `WorkflowPattern` types. Extended `ToolExecutionEvent` with `parentId`, `workflowId`. Extended `Store` interface with graph methods. |
| 4.2 | `@adaptivemcp/memory` | ✅ Done | New `execution_nodes` SQLite table with indexes. Methods: `recordExecutionNode`, `getExecutionNode`, `getNodesBySession`, `getNodesByWorkflow`, `getChildren`, `getParent`, `getRootNodes`, `getLeafNodes`, `updateChildrenIds`. |
| 4.3 | `@adaptivemcp/telemetry` | ✅ Done | New `TelemetryRecorder` methods: `startWorkflow()`, `startChild(parentId)`, `completeNode()`, `failNode()` — auto-links parent/child. |
| 5.1 | `@adaptivemcp/graph-analysis` | ✅ Done | **NEW** package with `GraphAnalyzer`: critical path, bottlenecks, fan-out, failure cascades, cost breakdown, workflow stats, pattern detection, anomaly detection. |
| 5.2 | `@adaptivemcp/evaluation` | ✅ Done | Added `evaluateWorkflow(sessionId)` and `evaluateAllWorkflows()` — emits graph-level insights (`critical_path_duration_ms`, `bottleneck_tool`, `fan_out_factor`, `failure_blast_radius`, `cost_per_workflow`). |
| 6.1 | `@adaptivemcp/extension` | ✅ Done | New MCP resources: `dev.adaptivemcp/execution-graph/{sessionId}`, `dev.adaptivemcp/workflow-graph/{workflowId}`, `dev.adaptivemcp/graph-insights/{sessionId}`, plus Mermaid diagram support. |
| 7.1 | `@adaptivemcp/thin-client` | ✅ Done | New `GraphTrackingMiddleware` — auto-propagates `sessionId`/`parentId` via middleware chain hooks (`beforeCall`/`afterCall`/`onError`). |
| 8.x | `examples` | ✅ Done | Three working scenarios: `execution-graph`, `failure-cascade`, `cost-optimization`. |

---

## Working Scenarios

```bash
# Execution graph intelligence
pnpm --filter @adaptivemcp/examples scenario:execution-graph

# Failure cascade analysis  
pnpm --filter @adaptivemcp/examples scenario:failure-cascade

# Cost optimization analysis
pnpm --filter @adaptivemcp/examples scenario:cost-optimization

# All existing scenarios still work
pnpm --filter @adaptivemcp/examples scenario
pnpm --filter @adaptivemcp/examples scenario:adaptive
pnpm --filter @adaptivemcp/examples quickstart
```

### Key Outputs Demonstrated

- **Critical Path**: `deploy_release → argocd.sync → kubernetes.apply → kubernetes.wait` (45.5s)
- **Bottlenecks**: `kubernetes.apply` (12s duration), `deploy_release` (fan-out=4)
- **Failure Cascades**: `kubernetes.apply` failure → blast radius 1 (`kubernetes.wait`)
- **Cost Breakdown**: Total $0.0101, critical path $0.0080, per-tool attribution
- **Workflow Stats**: Aggregated across sessions (success rate, avg duration, avg cost, patterns)
- **MCP Resources**: Graph data + Mermaid diagrams exposed as `dev.adaptivemcp/*` resources

---

## Backward Compatibility

- All existing scenarios work unchanged
- Graph tracking is **opt-in** via `enableGraph: true` in `AdaptiveRuntimeOptions`
- Events without `sessionId`/`parentId` treated as root nodes
- No breaking changes to existing APIs

---

## Next Phases: Production Hardening & Advanced Intelligence

### Phase 9: Production Hardening (Priority: HIGH)

| Task | Package | Effort | Description |
|------|---------|--------|-------------|
| 9.1 | `@adaptivemcp/memory` | Medium | Add WAL mode, connection pooling, and migration framework for `execution_nodes` table |
| 9.2 | `@adaptivemcp/graph-analysis` | Medium | Add incremental/streaming analysis for long-running workflows (don't recompute full graph on every event) |
| 9.3 | `@adaptivemcp/extension` | Low | Add ETag/If-None-Match support for graph MCP resources |
| 9.4 | `@adaptivemcp/thin-client` | Medium | Add `AsyncLocalStorage`-based context propagation for true async call stacks (not just middleware chain) |
| 9.5 | `@adaptivemcp/memory` | Medium | Add TTL-based cleanup for old execution nodes (configurable retention) |

### Phase 10: Advanced Graph Intelligence (Priority: MEDIUM)

| Task | Package | Effort | Description |
|------|---------|--------|-------------|
| 10.1 | `@adaptivemcp/graph-analysis` | High | **Causal inference**: Detect root causes vs symptoms in failure cascades using counterfactual reasoning |
| 10.2 | `@adaptivemcp/graph-analysis` | High | **Predictive modeling**: Forecast workflow duration/cost/failure probability from partial graph |
| 10.3 | `@adaptivemcp/graph-analysis` | Medium | **Subgraph isomorphism**: Detect recurring anti-patterns (e.g., "diamond dependency", "sequential bottleneck") |
| 10.4 | `@adaptivemcp/evaluation` | Medium | **Multi-session learning**: Aggregate patterns across workflow runs to improve recommendations |
| 10.5 | `@adaptivemcp/routing` | Medium | **Graph-aware routing**: Route based on workflow position (e.g., cheaper model for leaf nodes, premium for critical path) |

### Phase 11: MCP Ecosystem Integration (Priority: MEDIUM)

| Task | Package | Effort | Description |
|------|---------|--------|-------------|
| 11.1 | `@adaptivemcp/extension` | Medium | Implement `dev.adaptivemcp/execution-graph` as a **readable MCP resource** with pagination/cursors |
| 11.2 | `@adaptivemcp/extension` | Medium | Add **subscription/notification** for graph updates (SSE or MCP notifications) |
| 11.3 | `@adaptivemcp/spec` | Low | Define standard `ExecutionGraph` schema for cross-server graph federation |
| 11.4 | `@adaptivemcp/thin-client` | Medium | **Distributed tracing headers**: Propagate `traceparent`/`tracestate` (W3C TraceContext) across MCP servers |

### Phase 12: Visualization & UX (Priority: LOW)

| Task | Package | Effort | Description |
|------|---------|--------|-------------|
| 12.1 | `adaptivemcp.github.io` | Medium | Interactive graph explorer in docs (Mermaid + D3.js) |
| 12.2 | `@adaptivemcp/extension` | Low | GraphViz DOT export alongside Mermaid |
| 12.3 | `examples` | Low | Scenario: "debugging a failed deployment" — walk through graph inspection |

---

## Migration Strategy (Unchanged)

1. **Backward compatible**: Existing `ToolExecutionEvent` without `sessionId`/`parentId` still works (treated as root nodes)
2. **Opt-in graph**: Thin-client middleware off by default; enable via `AdaptiveRuntimeOptions.enableGraph = true`
3. **Progressive enhancement**: Graph insights appear in YAML only when graph data exists
4. **No schema breaking changes**: New tables, new columns nullable, new types additive

---

## Success Metrics (Updated)

- [x] `deploy_release` scenario prints full Mermaid graph in YAML
- [x] `graphAnalyzer.getCriticalPath()` returns correct path for multi-phase scenario
- [x] `failure_blast_radius` insight triggers approval recommendation
- [x] Cost per workflow aggregated correctly across 100+ simulated runs
- [x] Thin-client middleware automatically builds graph without manual instrumentation
- [x] MCP client can fetch `dev.adaptivemcp/execution-graph/{sessionId}` resource
- [ ] Production deployment with WAL mode and connection pooling
- [ ] Incremental graph analysis for 10,000+ node workflows
- [ ] Cross-server trace propagation with W3C TraceContext

---

## Related Documents

- `docs/ROADMAP.md` — Main project roadmap (Phases 0-4 complete)
- `docs/sep-2133-tools-metadata.md` — MCP extension spec (graph resource to be added)
- `packages/spec/src/types.ts` — Core type definitions (extended with graph types)
- `packages/memory/src/store.ts` — SQLite SSOT (extended with execution_nodes table)