import { DatabaseSync, type DatabaseSyncOptions } from "node:sqlite";
import type {
  Annotation,
  Insight,
  Recommendation,
  RecommendationType,
  Store,
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
  server_name: string;
  annotation: string;
  insights: string;
  recommendations: string;
  stats: string;
  updated_at: string;
}

/**
 * `server_name` is part of the primary key, not just a stored column: two
 * different MCP servers may expose a tool with the same name, and keying on
 * `tool_name` alone would let one server's record silently overwrite the
 * other's. It defaults to `''` (rather than being nullable) because SQLite
 * treats every NULL as distinct in a UNIQUE/PRIMARY KEY index, which would
 * defeat the composite key for the common case where the server is unknown.
 */
const UNKNOWN_SERVER = "";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tools (
  tool_name TEXT NOT NULL,
  server_name TEXT NOT NULL DEFAULT '',
  annotation TEXT NOT NULL,
  insights TEXT NOT NULL DEFAULT '[]',
  recommendations TEXT NOT NULL DEFAULT '[]',
  stats TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tool_name, server_name)
);
`;

/**
 * SQLite-backed store for Adaptive MCP.
 *
 * All tool metadata — annotations, learned insights, recommendations, and raw
 * stats — is persisted here. The YAML tools-metadata view is a *derived*
 * projection of this store, never the source of truth.
 */
export class MemoryStore implements Store {
  private db: DatabaseSync;

  constructor(options: MemoryStoreOptions = {}) {
    this.db = new DatabaseSync(options.path ?? ":memory:", options.dbOptions ?? {});
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  /**
   * Ensure a tool record exists, seeding it with an empty annotation.
   *
   * - When `serverName` is omitted, reuses whatever record already exists for
   *   that `toolName` (any server) rather than creating a second,
   *   disconnected row — callers that don't know the server shouldn't
   *   fragment a tool they've already ensured elsewhere with a known server.
   * - When `serverName` is given but no exact match exists, "claims" an
   *   unclaimed record (one created by a serverName-less caller, e.g. a human
   *   annotation set before any execution was observed) instead of
   *   fragmenting it into a second row — the first time a server becomes
   *   known for a tool, its prior annotation/insights/recommendations carry
   *   forward onto that server's row.
   */
  ensureTool(toolName: string, serverName?: string): ToolRecord {
    const existing = this.getTool(toolName, serverName);
    if (existing) return existing;

    if (serverName !== undefined) {
      const unclaimed = this.getTool(toolName, UNKNOWN_SERVER);
      if (unclaimed) return this.claimServer(unclaimed, serverName);
    }

    const now = new Date().toISOString();
    const record: ToolRecord = {
      toolName,
      serverName,
      annotation: { toolName, serverName },
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
        serverName ?? UNKNOWN_SERVER,
        JSON.stringify(record.annotation),
        JSON.stringify(record.insights),
        JSON.stringify(record.recommendations),
        JSON.stringify(record.stats),
        now,
      );
    return record;
  }

  /** Reassign an unclaimed row's `server_name` in place once it's learned. */
  private claimServer(record: ToolRecord, serverName: string): ToolRecord {
    const updated: ToolRecord = {
      ...record,
      serverName,
      annotation: { ...record.annotation, serverName },
      updatedAt: new Date().toISOString(),
    };
    this.db
      .prepare(
        `UPDATE tools SET server_name = ?, annotation = ?, updated_at = ? WHERE tool_name = ? AND server_name = ?`,
      )
      .run(serverName, JSON.stringify(updated.annotation), updated.updatedAt, record.toolName, UNKNOWN_SERVER);
    return updated;
  }

  /**
   * Read a single tool record. When `serverName` is given, looks up the exact
   * `(toolName, serverName)` row. Otherwise falls back to the most recently
   * updated row with that `toolName` — correct as long as the name isn't
   * shared across servers, ambiguous (but non-crashing) if it is.
   */
  getTool(toolName: string, serverName?: string): ToolRecord | undefined {
    const row =
      serverName !== undefined
        ? (this.db
            .prepare(`SELECT * FROM tools WHERE tool_name = ? AND server_name = ?`)
            .get(toolName, serverName) as unknown as ToolRow | undefined)
        : (this.db
            .prepare(`SELECT * FROM tools WHERE tool_name = ? ORDER BY updated_at DESC LIMIT 1`)
            .get(toolName) as unknown as ToolRow | undefined);
    return row ? deserialize(row) : undefined;
  }

  allTools(): ToolRecord[] {
    const rows = this.db
      .prepare(`SELECT * FROM tools ORDER BY tool_name, server_name`)
      .all() as unknown as ToolRow[];
    return rows.map(deserialize);
  }

  /** Persist a human-written annotation (the static metadata layer). */
  setAnnotation(annotation: Annotation): ToolRecord {
    const record = this.ensureTool(annotation.toolName, annotation.serverName);
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
    const record = this.ensureTool(insight.toolName, insight.serverName);
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
    const record = this.ensureTool(rec.toolName, rec.serverName);
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
  clearRecommendations(toolName: string, type: RecommendationType, serverName?: string): ToolRecord {
    const record = this.ensureTool(toolName, serverName);
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

  /** `server_name` is part of the primary key, so it's matched in WHERE, not reassigned in SET. */
  private write(record: ToolRecord): void {
    this.db
      .prepare(
        `UPDATE tools
         SET annotation = ?, insights = ?, recommendations = ?, stats = ?, updated_at = ?
         WHERE tool_name = ? AND server_name = ?`,
      )
      .run(
        JSON.stringify(record.annotation),
        JSON.stringify(record.insights),
        JSON.stringify(record.recommendations),
        JSON.stringify(record.stats),
        record.updatedAt,
        record.toolName,
        record.serverName ?? UNKNOWN_SERVER,
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
    serverName: row.server_name === UNKNOWN_SERVER ? undefined : row.server_name,
    annotation: JSON.parse(row.annotation) as Annotation,
    insights: JSON.parse(row.insights) as Insight[],
    recommendations: JSON.parse(row.recommendations) as Recommendation[],
    stats: JSON.parse(row.stats) as ToolStats,
    updatedAt: row.updated_at,
  };
}
