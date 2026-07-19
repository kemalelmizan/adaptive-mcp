# @adaptivemcp/memory

Persistent operational knowledge for Adaptive MCP, backed by SQLite
(`node:sqlite`).

`memory` is the **store**. Every other package reads
from or writes to it: telemetry folds execution events in, evaluation writes
derived insights back, and the extension derives its YAML view from it. The
YAML is a *projection*, never the source.

## Install

```bash
npm i @adaptivemcp/memory
```

Requires **Node 26** (the `node:sqlite` module is available without the
`--experimental-sqlite` flag).

## Usage

```ts
import { MemoryStore } from "@adaptivemcp/memory";

// :memory: for ephemeral; pass a file path to persist.
const store = new MemoryStore({ path: ":memory:" });

store.ensureTool("deploy_service", "ci");

// Record an observation (typically done by @adaptivemcp/telemetry).
store.recordExecution("deploy_service", {
  status: "completed",
  durationMs: 1200,
  model: "gpt-5-mini",
  cost: { amount: 0.0021, currency: "USD" },
});

// Static, human-authored metadata.
store.setAnnotation("deploy_service", { risk: "high", note: "Needs approval." });

// Derived, learned metadata (typically written by @adaptivemcp/evaluation).
store.addInsight("deploy_service", {
  key: "observed_failure_rate",
  value: 0.12,
  confidence: 0.9,
  source: "evaluation",
});

store.close();
```

## API

| Method | Purpose |
| --- | --- |
| `ensureTool(toolName, serverName?)` | Create a tool record if absent. |
| `getTool(toolName)` | Read a single `ToolRecord`. |
| `allTools()` | Read every `ToolRecord`. |
| `setAnnotation(toolName, annotation)` | Write a static `Annotation` (risk: low\|medium\|high). |
| `addInsight(toolName, insight)` | Append a learned `Insight`. |
| `addRecommendation(toolName, recommendation)` | Append an advised `Recommendation`. |
| `clearRecommendations(toolName)` | Drop stale recommendations before re-planning. |
| `recordExecution(toolName, partial)` | Fold a completed/failed execution into `ToolStats`. |
| `close()` | Close the underlying SQLite database. |

The store schema is a single `tools` table (`tool_name` PK) holding the
annotation, insights, recommendations, and stats as JSON columns.

## License

Released under the [MIT License](../../LICENSE). Copyright (c) 2026 Kemal Elmizan.
