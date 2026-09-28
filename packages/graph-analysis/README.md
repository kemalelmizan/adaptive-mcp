# @adaptivemcp/graph-analysis

Graph intelligence for Adaptive MCP execution DAGs: critical paths, bottlenecks,
failure cascades, anti-patterns, and workflow forecasting.

> **Status:** implemented and tested, and a dependency of
> `@adaptivemcp/routing` and `@adaptivemcp/evaluation`. Not yet on npm — this
> package is being prepared for a future release.

`graph-analysis` reads the execution graph that
[`@adaptivemcp/thin-client`](https://www.npmjs.com/package/@adaptivemcp/thin-client)'s
`GraphTrackingMiddleware` records into the store
([`@adaptivemcp/memory`](https://www.npmjs.com/package/@adaptivemcp/memory)) and
derives structural insights about how a workflow actually ran. It is pure and
read-only: every method takes a `sessionId`/`workflowId`, queries the nodes, and
returns a value. It never writes to the store.

## Install

```bash
npm i @adaptivemcp/graph-analysis @adaptivemcp/memory
```

Requires **Node 22+** (Node 26 recommended).

## Usage

```ts
import { MemoryStore } from "@adaptivemcp/memory";
import { GraphAnalyzer } from "@adaptivemcp/graph-analysis";

const memory = new MemoryStore();
const analyzer = new GraphAnalyzer(memory);

const critical = analyzer.getCriticalPath(sessionId);
const bottlenecks = analyzer.getBottlenecks(sessionId, 3);
const antiPatterns = analyzer.detectAntiPatterns(sessionId);
const forecast = analyzer.getWorkflowForecast(sessionId, workflowId);
```

## `GraphAnalyzer` API

| Method | Returns | Purpose |
| --- | --- | --- |
| `getCriticalPath(sessionId)` | `CriticalPathResult` | The longest-duration path through the session DAG. |
| `getBottlenecks(sessionId, topN?)` | `Bottleneck[]` | Slowest nodes by self-plus-descendant duration (default top 5). |
| `getFanOutAnalysis(sessionId)` | `FanOutReport` | Branching shape: widest fan-out and per-node child counts. |
| `getFailureCascade(sessionId)` | `FailureCascade[]` | Failures and the healthy descendants they took down. |
| `getCausalCascade(sessionId)` | `CausalCascade` | Orders failures into root cause vs. downstream symptom using ancestry. |
| `getCostBreakdown(sessionId)` | `CostBreakdown` | Cost accumulated per node/tool for a session. |
| `getWorkflowStats(workflowId)` | `WorkflowStats` | Aggregates every session in a workflow (duration, success, cost). |
| `getWorkflowForecast(sessionId, workflowId)` | `WorkflowForecast` | Historical-baseline projection (duration/cost/failure probability) for an in-progress session. |
| `detectAntiPatterns(sessionId)` | `AntiPattern[]` | `sequential_bottleneck` and `diamond_dependency` detectors. |
| `detectCommonPatterns(workflowId, minOccurrences?)` | `WorkflowPattern[]` | Tool sequences repeated across sessions (default ≥ 3). |
| `detectAnomalies(sessionId)` | `{ type, node, description }[]` | Outlier nodes versus the rest of the session. |

All result types (`CriticalPathResult`, `Bottleneck`, `FanOutReport`,
`FailureCascade`, `CausalCascade`, `AntiPattern`, `CostBreakdown`,
`WorkflowStats`, `WorkflowPattern`, `WorkflowForecast`) are defined in
[`@adaptivemcp/spec`](https://www.npmjs.com/package/@adaptivemcp/spec).

## `IncrementalGraphAnalyzer`

`GraphAnalyzer` re-queries and re-scans the full node set on every call. For a
long-running or repeatedly-polled workflow — e.g. an extension resource read
against a session that is still accumulating nodes — that is wasted work while
nothing has changed. `IncrementalGraphAnalyzer` is an opt-in subclass that caches
the flat node list per session/workflow and only re-queries when the cache is
stale:

```ts
import { IncrementalGraphAnalyzer } from "@adaptivemcp/graph-analysis";

const analyzer = new IncrementalGraphAnalyzer(memory, { maxCacheAgeMs: 5_000 });
const critical = analyzer.getCriticalPath(sessionId); // first read queries the store
const again = analyzer.getCriticalPath(sessionId); // served from cache
analyzer.invalidate(sessionId); // force the next read to re-query
```

`maxCacheAgeMs` defaults to `5000`. This is deliberately **not** streaming — there
is no event bus from store writes to analyzer instances — so callers that write
new nodes and want the next read to see them should call `invalidate(id)`.

## License

Released under the [MIT License](../../LICENSE). Copyright (c) 2026 Kemal Elmizan.
