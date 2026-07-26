import { DatabaseSync, type DatabaseSyncOptions } from "node:sqlite";
import type {
  Annotation,
  Insight,
  Recommendation,
  RecommendationType,
  ToolExecutionEvent,
  ToolRecord,
  ToolStats,
  ExecutionNode,
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

interface ExecutionNodeRow {
  id: string;
  tool_name: string;
  server_name: string | null;
  session_id: string;
  workflow_id: string | null;
  parent_id: string | null;
  children_ids: string;
  timestamp: string;
  duration_ms: number | null;
  status: string;
  input: string | null;
  output: string | null;
  error: string | null;
  model: string | null;
  cost: string | null;
  metadata: string | null;
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

CREATE TABLE IF NOT EXISTS execution_nodes (
  id TEXT PRIMARY KEY,
  tool_name TEXT NOT NULL,
  server_name TEXT,
  session_id TEXT NOT NULL,
  workflow_id TEXT,
  parent_id TEXT,
  children_ids TEXT NOT NULL DEFAULT '[]',
  timestamp TEXT NOT NULL,
  duration_ms INTEGER,
  status TEXT NOT NULL,
  input TEXT,
  output TEXT,
  error TEXT,
  model TEXT,
  cost TEXT,
  metadata TEXT,
  FOREIGN KEY (parent_id) REFERENCES execution_nodes(id)
);

CREATE INDEX IF NOT EXISTS idx_nodes_session ON execution_nodes(session_id);
CREATE INDEX IF NOT EXISTS idx_nodes_workflow ON execution_nodes(workflow_id);
CREATE INDEX IF NOT EXISTS idx_nodes_tool ON execution_nodes(tool_name);
CREATE INDEX IF NOT EXISTS idx_nodes_parent ON execution_nodes(parent_id);
`;

/**
 * SQLite-backed single source of truth for Adaptive MCP.
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

  /** Record an execution node in the graph. */
  recordExecutionNode(node: ExecutionNode): ExecutionNode {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT OR REPLACE INTO execution_nodes (id, tool_name, server_name, session_id, workflow_id, parent_id, children_ids, timestamp, duration_ms, status, input, output, error, model, cost, metadata)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        node.id,
        node.toolName,
        node.serverName ?? null,
        node.sessionId,
        node.workflowId ?? null,
        node.parentId ?? null,
        JSON.stringify(node.childrenIds ?? []),
        node.timestamp,
        node.durationMs ?? null,
        node.status,
        node.input ? JSON.stringify(node.input) : null,
        node.output ? JSON.stringify(node.output) : null,
        node.error ? JSON.stringify(node.error) : null,
        node.model ?? null,
        node.cost ? JSON.stringify(node.cost) : null,
        node.metadata ? JSON.stringify(node.metadata) : null,
      );
    return node;
  }

  /** Get an execution node by ID. */
  getExecutionNode(id: string): ExecutionNode | undefined {
    const row = this.db
      .prepare(`SELECT * FROM execution_nodes WHERE id = ?`)
      .get(id) as unknown as ExecutionNodeRow | undefined;
    return row ? deserializeExecutionNode(row) : undefined;
  }

  /** Get all nodes for a session. */
  getNodesBySession(sessionId: string): ExecutionNode[] {
    const rows = this.db
      .prepare(`SELECT * FROM execution_nodes WHERE session_id = ? ORDER BY timestamp`)
      .all(sessionId) as unknown as ExecutionNodeRow[];
    return rows.map(deserializeExecutionNode);
  }

  /** Get all nodes for a workflow (across sessions). */
  getNodesByWorkflow(workflowId: string): ExecutionNode[] {
    const rows = this.db
      .prepare(`SELECT * FROM execution_nodes WHERE workflow_id = ? ORDER BY timestamp`)
      .all(workflowId) as unknown as ExecutionNodeRow[];
    return rows.map(deserializeExecutionNode);
  }

  /** Get children of a node. */
  getChildren(parentId: string): ExecutionNode[] {
    const parent = this.getExecutionNode(parentId);
    if (!parent) return [];
    const childIds = parent.childrenIds;
    if (childIds.length === 0) return [];
    const placeholders = childIds.map(() => "?").join(",");
    const rows = this.db
      .prepare(`SELECT * FROM execution_nodes WHERE id IN (${placeholders})`)
      .all(...childIds) as unknown as ExecutionNodeRow[];
    return rows.map(deserializeExecutionNode);
  }

  /** Get parent of a node. */
  getParent(childId: string): ExecutionNode | undefined {
    const child = this.getExecutionNode(childId);
    if (!child || !child.parentId) return undefined;
    return this.getExecutionNode(child.parentId);
  }

  /** Get root nodes (no parent) for a session. */
  getRootNodes(sessionId: string): ExecutionNode[] {
    const rows = this.db
      .prepare(`SELECT * FROM execution_nodes WHERE session_id = ? AND parent_id IS NULL ORDER BY timestamp`)
      .all(sessionId) as unknown as ExecutionNodeRow[];
    return rows.map(deserializeExecutionNode);
  }

  /** Get leaf nodes (no children) for a session. */
  getLeafNodes(sessionId: string): ExecutionNode[] {
    const rows = this.db
      .prepare(`SELECT * FROM execution_nodes WHERE session_id = ? AND children_ids = '[]' ORDER BY timestamp`)
      .all(sessionId) as unknown as ExecutionNodeRow[];
    return rows.map(deserializeExecutionNode);
  }

  /** Update children IDs of a parent node. */
  updateChildrenIds(parentId: string, childrenIds: string[]): void {
    this.db
      .prepare(`UPDATE execution_nodes SET children_ids = ? WHERE id = ?`)
      .run(JSON.stringify(childrenIds), parentId);
  }
}

function deserializeExecutionNode(row: ExecutionNodeRow): ExecutionNode {
  return {
    id: row.id,
    toolName: row.tool_name,
    serverName: row.server_name ?? undefined,
    sessionId: row.session_id,
    workflowId: row.workflow_id ?? undefined,
    parentId: row.parent_id ?? undefined,
    childrenIds: JSON.parse(row.children_ids) as string[],
    timestamp: row.timestamp,
    durationMs: row.duration_ms ?? undefined,
    status: row.status as ExecutionNode["status"],
    input: row.input ? JSON.parse(row.input) : undefined,
    output: row.output ? JSON.parse(row.output) : undefined,
    error: row.error ? JSON.parse(row.error) : undefined,
    model: row.model ?? undefined,
    cost: row.cost ? JSON.parse(row.cost) : undefined,
    metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
  };
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
