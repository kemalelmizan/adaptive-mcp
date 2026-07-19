import { DatabaseSync, type DatabaseSyncOptions } from "node:sqlite";
import type {
  Annotation,
  Insight,
  Recommendation,
  RecommendationType,
  ToolExecutionEvent,
  ToolRecord,
  ToolStats,
} from "@adaptivemcp/spec";

export interface MemoryStoreOptions {
  /** Path to the SQLite database file. Use ":memory:" for an in-memory store. */
  path?: string;
  dbOptions?: DatabaseSyncOptions;
}

interface ToolRow {
  tool_name: string;
  server_name: string | null;
  annotation: string;
  insights: string;
  recommendations: string;
  stats: string;
  updated_at: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tools (
  tool_name TEXT PRIMARY KEY,
  server_name TEXT,
  annotation TEXT NOT NULL,
  insights TEXT NOT NULL DEFAULT '[]',
  recommendations TEXT NOT NULL DEFAULT '[]',
  stats TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);
`;

/**
 * SQLite-backed store for Adaptive MCP.
 *
 * All tool metadata — annotations, learned insights, recommendations, and raw
 * stats — is persisted here. The YAML tools-metadata view is a *derived*
 * projection of this store, never the source of truth.
 */
export class MemoryStore {
  private db: DatabaseSync;

  constructor(options: MemoryStoreOptions = {}) {
    this.db = new DatabaseSync(options.path ?? ":memory:", options.dbOptions ?? {});
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  /** Ensure a tool record exists, seeding it with an empty annotation. */
  ensureTool(toolName: string, serverName?: string): ToolRecord {
    const existing = this.getTool(toolName);
    if (existing) return existing;

    const now = new Date().toISOString();
    const record: ToolRecord = {
      toolName,
      serverName,
      annotation: { toolName },
      insights: [],
      recommendations: [],
      stats: emptyStats(),
      updatedAt: now,
    };
    this.db
      .prepare(
        `INSERT INTO tools (tool_name, server_name, annotation, insights, recommendations, stats, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        toolName,
        serverName ?? null,
        JSON.stringify(record.annotation),
        JSON.stringify(record.insights),
        JSON.stringify(record.recommendations),
        JSON.stringify(record.stats),
        now,
      );
    return record;
  }

  getTool(toolName: string): ToolRecord | undefined {
    const row = this.db
      .prepare(`SELECT * FROM tools WHERE tool_name = ?`)
      .get(toolName) as unknown as ToolRow | undefined;
    return row ? deserialize(row) : undefined;
  }

  allTools(): ToolRecord[] {
    const rows = this.db
      .prepare(`SELECT * FROM tools ORDER BY tool_name`)
      .all() as unknown as ToolRow[];
    return rows.map(deserialize);
  }

  /** Persist a human-written annotation (the static metadata layer). */
  setAnnotation(annotation: Annotation): ToolRecord {
    const record = this.ensureTool(annotation.toolName);
    const updated: ToolRecord = {
      ...record,
      annotation: { ...record.annotation, ...annotation },
      updatedAt: new Date().toISOString(),
    };
    this.write(updated);
    return updated;
  }

  /** Record a learned insight derived from observed behavior. */
  addInsight(insight: Insight): ToolRecord {
    const record = this.ensureTool(insight.toolName);
    const insights = [...record.insights.filter((i) => i.key !== insight.key), insight];
    const updated: ToolRecord = {
      ...record,
      insights,
      updatedAt: new Date().toISOString(),
    };
    this.write(updated);
    return updated;
  }

  /** Store a suggested adaptation. */
  addRecommendation(rec: Recommendation): ToolRecord {
    const record = this.ensureTool(rec.toolName);
    const updated: ToolRecord = {
      ...record,
      recommendations: [...record.recommendations, rec],
      updatedAt: new Date().toISOString(),
    };
    this.write(updated);
    return updated;
  }

  /**
   * Remove all recommendations of a given type for a tool. Used by the routing,
   * orchestration, and approval packages so each adaptation pass recomputes its
   * own recommendations instead of appending duplicates on every observation.
   */
  clearRecommendations(toolName: string, type: RecommendationType): ToolRecord {
    const record = this.ensureTool(toolName);
    const updated: ToolRecord = {
      ...record,
      recommendations: record.recommendations.filter((r) => r.type !== type),
      updatedAt: new Date().toISOString(),
    };
    this.write(updated);
    return updated;
  }

  /** Fold a tool execution event into the persisted stats. */
  recordExecution(event: ToolExecutionEvent): ToolRecord {
    const record = this.ensureTool(event.toolName, event.serverName);
    const stats = foldEvent(record.stats, event);
    const updated: ToolRecord = {
      ...record,
      serverName: record.serverName ?? event.serverName,
      stats,
      updatedAt: new Date().toISOString(),
    };
    this.write(updated);
    return updated;
  }

  private write(record: ToolRecord): void {
    this.db
      .prepare(
        `UPDATE tools
         SET server_name = ?, annotation = ?, insights = ?, recommendations = ?, stats = ?, updated_at = ?
         WHERE tool_name = ?`,
      )
      .run(
        record.serverName ?? null,
        JSON.stringify(record.annotation),
        JSON.stringify(record.insights),
        JSON.stringify(record.recommendations),
        JSON.stringify(record.stats),
        record.updatedAt,
        record.toolName,
      );
  }
}

function emptyStats(): ToolStats {
  return {
    invocations: 0,
    failures: 0,
    failureRate: 0,
    avgDurationMs: null,
    totalCost: 0,
    lastObservedAt: null,
  };
}

function foldEvent(stats: ToolStats, event: ToolExecutionEvent): ToolStats {
  const invocations = stats.invocations + 1;
  const failures = stats.failures + (event.status === "failed" ? 1 : 0);
  const durations = event.durationMs != null ? [event.durationMs] : [];
  const prevAvg = stats.avgDurationMs ?? 0;
  const avgDurationMs =
    durations.length > 0
      ? (prevAvg * (invocations - 1) + durations[0]!) / invocations
      : stats.avgDurationMs;
  const totalCost = stats.totalCost + (event.cost?.amount ?? 0);
  return {
    invocations,
    failures,
    failureRate: failures / invocations,
    avgDurationMs,
    totalCost,
    lastObservedAt: event.timestamp,
  };
}

function deserialize(row: ToolRow): ToolRecord {
  return {
    toolName: row.tool_name,
    serverName: row.server_name ?? undefined,
    annotation: JSON.parse(row.annotation) as Annotation,
    insights: JSON.parse(row.insights) as Insight[],
    recommendations: JSON.parse(row.recommendations) as Recommendation[],
    stats: JSON.parse(row.stats) as ToolStats,
    updatedAt: row.updated_at,
  };
}
