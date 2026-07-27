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

## Implementation Status: ✅ Phases 4-11 COMPLETE

All foundation phases, Phase 9 (Production Hardening), Phase 10 (Advanced Graph Intelligence), and Phase 11 (MCP Ecosystem Integration) have been implemented and validated with working scenarios and tests, including a real end-to-end MCP client/server run (pagination, subscribe/notify). Phase 12 (Visualization & UX) is not yet started — see below.

### What Was Built

| Phase | Package | Status | Key Deliverables |
|-------|---------|--------|------------------|
| 4.1 | `@adaptivemcp/spec` | ✅ Done | `ExecutionNode`, `ExecutionGraph`, `CriticalPathResult`, `Bottleneck`, `FanOutReport`, `FailureCascade`, `CostBreakdown`, `WorkflowStats`, `WorkflowPattern` types. Extended `ToolExecutionEvent` with `parentId`, `workflowId`. Extended `Store` interface with graph methods. |
| 4.2 | `@adaptivemcp/memory` | ✅ Done | New `execution_nodes` SQLite table with indexes. Methods: `recordExecutionNode`, `getExecutionNode`, `getNodesBySession`, `getNodesByWorkflow`, `getChildren`, `getParent`, `getRootNodes`, `getLeafNodes`, `updateChildrenIds`. |
| 4.3 | `@adaptivemcp/telemetry` | ✅ Done | New `TelemetryRecorder` methods: `startWorkflow()`, `startChild(parentId)`, `completeNode()`, `failNode()` — auto-links parent/child. |
| 5.1 | `@adaptivemcp/graph-analysis` | ✅ Done | **NEW** package with `GraphAnalyzer`: critical path, bottlenecks, fan-out, failure cascades, cost breakdown, workflow stats, pattern detection, anomaly detection. |
| 5.2 | `@adaptivemcp/evaluation` | ✅ Done | `evaluateWorkflow(sessionId)` emits per-session insights (`workflow_duration_ms`, `workflow_cost`, `workflow_failure_rate`, `critical_path_bottleneck`, `workflow_fan_out`). `evaluateAllWorkflows()` was a stub returning `[]` until Phase 10.4 — it now genuinely enumerates workflows and sessions and persists a cross-session `workflow_common_pattern` insight. (Corrected from an earlier version of this table, which listed insight keys — `critical_path_duration_ms`, `bottleneck_tool`, `fan_out_factor`, `failure_blast_radius`, `cost_per_workflow` — that never existed in the code.) |
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

## Next Phases: Advanced Intelligence

### Phase 9: Production Hardening — ✅ Done

| Task | Package | Effort | Description |
|------|---------|--------|-------------|
| 9.1 | `@adaptivemcp/memory` | Medium | ✅ WAL mode + tuned PRAGMAs and a versioned migration framework for `execution_nodes`. `node:sqlite`'s `DatabaseSync` is a single synchronous connection per process, so "connection pooling" (as originally worded) does not apply and was scoped out. |
| 9.2 | `@adaptivemcp/graph-analysis` | Medium | ✅ `IncrementalGraphAnalyzer`, an opt-in `GraphAnalyzer` subclass that caches session/workflow node reads instead of re-querying the store on every call. Descoped from true event-driven streaming — no event bus exists from `MemoryStore` writes to analyzer instances anywhere in the codebase, so a cache with explicit `invalidate()` is the pragmatic fit. |
| 9.3 | `@adaptivemcp/extension` | Low | ✅ Real content-hash ETags for the 3 graph resource documents, plus an `ifNoneMatch` option returning `{ notModified: true, etag }`. |
| 9.4 | `@adaptivemcp/thin-client` | Medium | ✅ `AsyncLocalStorage`-based context propagation in `GraphTrackingMiddleware`, fixing a confirmed concurrency bug where parallel tool calls corrupted a shared parent/child stack. Required wrapping each call's full lifecycle in `runInContext` in `ThinClient.run()` — `enterWith` alone doesn't isolate calls kicked off back-to-back (e.g. via `Promise.all`). |
| 9.5 | `@adaptivemcp/memory` | Medium | ✅ `pruneExecutionNodes` + configurable `retention` option for TTL-based cleanup, backed by a new timestamp index. |

### Phase 10: Advanced Graph Intelligence — ✅ Done

This codebase has zero ML/statistics dependencies anywhere in the workspace — everything is hand-rolled heuristic TypeScript. Two items below (10.1, 10.2) were descoped from their literal wording (counterfactual replay, trained forecasting) to honest heuristics in that same style, rather than pretending to build infrastructure that doesn't exist.

| Task | Package | Effort | Description |
|------|---------|--------|-------------|
| 10.1 | `@adaptivemcp/graph-analysis` | High | ✅ `getCausalCascade(sessionId)` — ancestor-based causal ordering (a failed node with no failed ancestor is a root cause; one downstream of a failure is a symptom of the nearest one), not counterfactual replay (infeasible from static logs alone). Kept alongside the existing `getFailureCascade`. |
| 10.2 | `@adaptivemcp/graph-analysis` | High | ✅ `getWorkflowForecast(sessionId, workflowId)` — historical-baseline extrapolation (progress-proportional duration/cost projection, failure probability blended from historical rate + this session's failures so far), in the same ratio-vs-mean style as `detectAnomalies`. Not a trained model. |
| 10.3 | `@adaptivemcp/graph-analysis` | Medium | ✅ `detectAntiPatterns(sessionId)` — exactly two named detectors (`sequential_bottleneck` reusing `getFanOutAnalysis`'s `sequentialChains`, `diamond_dependency` via depth-capped BFS reconvergence), not general subgraph isomorphism (NP-hard, unnecessary for small execution DAGs). |
| 10.4 | `@adaptivemcp/evaluation` | Medium | ✅ `evaluateAllWorkflows()` now genuinely enumerates workflows (`MemoryStore.getWorkflowIds()`, new) and their sessions, then delegates to `GraphAnalyzer.getWorkflowStats` for the actual cross-session learning — persisted as a `workflow_common_pattern` insight. Also fixed a real bug in `detectCommonPatterns` that always attributed duration/success to the first session regardless of pattern. |
| 10.5 | `@adaptivemcp/routing` | Medium | ✅ `Router.routeByPosition(sessionId, analyzer)` — pure, non-persisting (workflow position is per-session; `Recommendation` storage is per-tool, so persisting would misrepresent facts that don't generalize across sessions). Critical-path nodes get the lowest-latency model, leaves get the cheapest. |

### Phase 11: MCP Ecosystem Integration — ✅ Done

This is the first phase requiring the MCP *protocol* itself (resources, pagination, subscribe/notify), not just library-level graph algorithms. `packages/mcp-binary` was ruled out as the integration point (explicitly documented as "the only sanctioned shell-out layer," a single-purpose CLI wrapper); `examples/src/server.ts`, which already registered the `tools-metadata` resource, was the correct existing extension point. Per `packages/spec/src/extensions.ts`'s own conservative stance (only `tools-metadata`/SEP-2133 is a formally proposed extension), the execution-graph resource here follows the same registration pattern but stays a demonstration in `examples/`, not a new formal SEP.

| Task | Package | Effort | Description |
|------|---------|--------|-------------|
| 11.1 | `@adaptivemcp/extension` | Medium | ✅ `dev.adaptivemcp://execution-graph/{sessionId}` registered as an MCP `ResourceTemplate` in `examples/src/server.ts`, paginated over `nodes` via hand-rolled `cursor`/`pageSize` (the SDK has no built-in pagination for a single resource read — `resources/list`'s `cursor`/`nextCursor` schema exists but even `McpServer`'s default list handler ignores it). Edges are always returned in full regardless of the current page. |
| 11.2 | `@adaptivemcp/extension` | Medium | ✅ `resources/subscribe`/`unsubscribe` + `notifications/resources/updated`, wired via the low-level `Server` `McpServer` exposes (`server.server`) since `McpServer` itself has no subscribe/notify convenience methods. Verified end-to-end with a real client/server run over stdio. |
| 11.3 | `@adaptivemcp/spec` | Low | ✅ New `ExecutionGraphResource`/`buildExecutionGraph` (`packages/spec/src/execution-graph.ts`) replaces the dead Map-based `ExecutionGraph` type (zero consumers, not JSON-serializable). "Federation" means a shared, importable schema + builder other servers' code can construct against — not an implemented multi-server aggregation/discovery protocol, which would need infrastructure that doesn't exist here. |
| 11.4 | `@adaptivemcp/thin-client` | Medium | ✅ Descoped from literal header propagation — no live MCP client/HTTP transport exists anywhere in this codebase to carry headers on. Instead, `GraphTrackingMiddleware` generates a valid W3C `traceparent` (deterministically derived from existing `ExecutionNode` UUIDs) recorded on `metadata.traceparent`/`traceId`/`spanId`/`parentSpanId`, surfaced through the execution-graph resource (`trace_parent` per node) — a data-plane correlation primitive ready for a future real transport to attach as a header. |

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
- [x] MCP client can fetch `dev.adaptivemcp://execution-graph/{sessionId}` resource, paginated, over a real stdio client/server connection
- [x] MCP client can subscribe and receive `notifications/resources/updated` for a session's execution graph
- [x] WAL mode for file-backed stores (connection pooling n/a — `node:sqlite` is a single-connection driver)
- [ ] Incremental graph analysis validated at 10,000+ node workflow scale (cache added in 9.2; not load-tested at this scale)
- [x] Valid W3C `traceparent` recorded per node and surfaced through the execution-graph resource (Phase 11.4) — descoped from literal cross-server header propagation, since no live MCP transport exists in this codebase to carry headers on

---

## Related Documents

- `docs/ROADMAP.md` — Main project roadmap (Phases 0-4 complete)
- `docs/sep-2133-tools-metadata.md` — MCP extension spec (graph resource to be added)
- `packages/spec/src/types.ts` — Core type definitions (extended with graph types)
- `packages/memory/src/store.ts` — SQLite SSOT (extended with execution_nodes table)