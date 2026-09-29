import { DatabaseSync, type DatabaseSyncOptions } from "node:sqlite";
import type {
  Annotation,
  Insight,
  MetricCell,
  MetricDimensions,
  Recommendation,
  RecommendationType,
  Store,
  ToolExecutionEvent,
  ToolRecord,
  ToolStats,
  ExecutionNode,
} from "@adaptivemcp/spec";
import { runMigrations } from "./migrations.js";

export interface MemoryStorePragmaOptions {
  journalMode?: string;
  synchronous?: string;
  busyTimeoutMs?: number;
}

export interface MemoryStoreOptions {
  /** Path to the SQLite database file. Use ":memory:" for an in-memory store. */
  path?: string;
  dbOptions?: DatabaseSyncOptions;
  /**
   * PRAGMA overrides. `journalMode` is ignored for `:memory:` stores, since
   * WAL requires a file on disk. Defaults: journalMode "WAL", synchronous
   * "NORMAL", busyTimeoutMs 5000. `foreign_keys` is always enabled.
   */
  pragmas?: MemoryStorePragmaOptions;
  /** When set, `recordExecutionNode` opportunistically prunes nodes older than `maxAgeMs`. */
  retention?: { maxAgeMs: number };
}

const DEFAULT_PRAGMAS: Required<MemoryStorePragmaOptions> = {
  journalMode: "WAL",
  synchronous: "NORMAL",
  busyTimeoutMs: 5000,
};

/** Opportunistic pruning is throttled to at most once per this interval, to avoid a DELETE scan on every write. */
const RETENTION_CHECK_INTERVAL_MS = 60 * 60 * 1000;

interface ToolRow {
  tool_name: string;
  server_name: string;
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

/**
 * `server_name` is part of the primary key, not just a stored column: two
 * different MCP servers may expose a tool with the same name, and keying on
 * `tool_name` alone would let one server's record silently overwrite the
 * other's. It defaults to `''` (rather than being nullable) because SQLite
 * treats every NULL as distinct in a UNIQUE/PRIMARY KEY index, which would
 * defeat the composite key for the common case where the server is unknown.
 */
const UNKNOWN_SERVER = "";

/**
 * SQLite-backed store for Adaptive MCP.
 *
 * All tool metadata — annotations, learned insights, recommendations, and raw
 * stats — is persisted here. The YAML tools-metadata view is a *derived*
 * projection of this store, never the source of truth.
 */
export class MemoryStore implements Store {
  private db: DatabaseSync;
  private readonly isMemory: boolean;
  private readonly retention?: { maxAgeMs: number };
  private lastPrunedAt = 0;

  constructor(options: MemoryStoreOptions = {}) {
    const path = options.path ?? ":memory:";
    this.isMemory = path === ":memory:";
    this.retention = options.retention;
    this.db = new DatabaseSync(path, options.dbOptions ?? {});

    const pragmas = { ...DEFAULT_PRAGMAS, ...options.pragmas };
    if (!this.isMemory) {
      this.db.exec(`PRAGMA journal_mode = ${pragmas.journalMode}`);
    }
    this.db.exec(`PRAGMA synchronous = ${pragmas.synchronous}`);
    this.db.exec(`PRAGMA foreign_keys = ON`);
    this.db.exec(`PRAGMA busy_timeout = ${pragmas.busyTimeoutMs}`);

    runMigrations(this.db);
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
    this.foldMetricCells(event);
    return updated;
  }

  /**
   * Read pre-aggregated metric cells (bounded dimensional rollups). This is the
   * durable, queryable metadata layer that replaces a raw events table.
   */
  metricCells(options: { toolName?: string; serverName?: string } = {}): MetricCell[] {
    const clauses: string[] = [];
    const params: string[] = [];
    if (options.toolName !== undefined) {
      clauses.push("tool_name = ?");
      params.push(options.toolName);
    }
    if (options.serverName !== undefined) {
      clauses.push("server_name = ?");
      params.push(options.serverName);
    }
    const where = clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.db
      .prepare(`SELECT * FROM metric_cells${where} ORDER BY tool_name, server_name, dims_key`)
      .all(...params) as unknown as MetricCellRow[];
    return rows.map(deserializeMetricCell);
  }

  /** Pre-aggregate an event into the bounded set of metric cells it belongs to. */
  private foldMetricCells(event: ToolExecutionEvent): void {
    const now = event.timestamp ?? new Date().toISOString();
    for (const dimensions of cellDimensionsFor(event)) {
      const key = dimsKey(dimensions);
      const existing = this.readMetricCell(event.toolName, event.serverName ?? UNKNOWN_SERVER, key);
      this.writeMetricCell(foldMetricCell(existing, event, dimensions, now), key);
    }
  }

  private readMetricCell(toolName: string, serverName: string, dimsKeyValue: string): MetricCell | undefined {
    const row = this.db
      .prepare(
        `SELECT * FROM metric_cells WHERE tool_name = ? AND server_name = ? AND window = 'all' AND dims_key = ?`,
      )
      .get(toolName, serverName, dimsKeyValue) as unknown as MetricCellRow | undefined;
    return row ? deserializeMetricCell(row) : undefined;
  }

  private writeMetricCell(cell: MetricCell, dimsKeyValue: string): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO metric_cells (
           tool_name, server_name, window, dims_key, dims,
           invocations, failures, error_codes,
           duration_sum, duration_count, duration_hist,
           token_in_sum, token_out_sum, token_count, cost_sum,
           ewma_failure_rate, ewma_duration_ms, first_seen, last_seen, exemplars
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        cell.toolName,
        cell.serverName ?? UNKNOWN_SERVER,
        cell.window,
        dimsKeyValue,
        JSON.stringify(cell.dimensions),
        cell.invocations,
        cell.failures,
        JSON.stringify(cell.errorCodes),
        cell.durationSum,
        cell.durationCount,
        JSON.stringify(cell.durationHistogram),
        cell.tokenInSum,
        cell.tokenOutSum,
        cell.tokenCount,
        cell.costSum,
        cell.ewmaFailureRate ?? null,
        cell.ewmaDurationMs ?? null,
        cell.firstSeen,
        cell.lastSeen,
        JSON.stringify(cell.exemplars),
      );
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

  /** Record an execution node in the graph. */
  recordExecutionNode(node: ExecutionNode): ExecutionNode {
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
    this.maybeOpportunisticPrune();
    return node;
  }

  /**
   * Delete execution nodes older than `olderThanMs`. Does not cascade-clean
   * dangling `parent_id`/`children_ids` references left on surviving rows —
   * acceptable for a best-effort retention pass; callers relying on strict
   * graph integrity should prune with generous windows.
   */
  pruneExecutionNodes(olderThanMs: number, now: number = Date.now()): { deleted: number } {
    const cutoff = new Date(now - olderThanMs).toISOString();
    const result = this.db.prepare(`DELETE FROM execution_nodes WHERE timestamp < ?`).run(cutoff);
    this.lastPrunedAt = now;
    return { deleted: Number(result.changes) };
  }

  private maybeOpportunisticPrune(): void {
    if (!this.retention) return;
    const now = Date.now();
    if (now - this.lastPrunedAt < RETENTION_CHECK_INTERVAL_MS) return;
    this.pruneExecutionNodes(this.retention.maxAgeMs, now);
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

  /** Get every distinct workflow ID that has at least one recorded execution node. */
  getWorkflowIds(): string[] {
    const rows = this.db
      .prepare(`SELECT DISTINCT workflow_id FROM execution_nodes WHERE workflow_id IS NOT NULL`)
      .all() as unknown as { workflow_id: string }[];
    return rows.map((r) => r.workflow_id);
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
    avgOutputTokens: undefined,
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
  
  // Track average output tokens for context cost
  const outputTokens = eventTokens(event).outputTokens ?? 0;
  const prevAvgTokens = stats.avgOutputTokens ?? 0;
  const avgOutputTokens = (prevAvgTokens * (invocations - 1) + outputTokens) / invocations;
  
  return {
    invocations,
    failures,
    failureRate: failures / invocations,
    avgDurationMs,
    totalCost,
    lastObservedAt: event.timestamp,
    avgOutputTokens,
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

interface MetricCellRow {
  tool_name: string;
  server_name: string;
  window: string;
  dims_key: string;
  dims: string;
  invocations: number;
  failures: number;
  error_codes: string;
  duration_sum: number;
  duration_count: number;
  duration_hist: string;
  token_in_sum: number;
  token_out_sum: number;
  token_count: number;
  cost_sum: number;
  ewma_failure_rate: number | null;
  ewma_duration_ms: number | null;
  first_seen: string | null;
  last_seen: string | null;
  exemplars: string;
}

function deserializeMetricCell(row: MetricCellRow): MetricCell {
  return {
    toolName: row.tool_name,
    serverName: row.server_name === UNKNOWN_SERVER ? undefined : row.server_name,
    window: row.window,
    dimensions: JSON.parse(row.dims) as MetricDimensions,
    invocations: row.invocations,
    failures: row.failures,
    errorCodes: JSON.parse(row.error_codes) as Record<string, number>,
    durationSum: row.duration_sum,
    durationCount: row.duration_count,
    durationHistogram: JSON.parse(row.duration_hist) as number[],
    tokenInSum: row.token_in_sum,
    tokenOutSum: row.token_out_sum,
    tokenCount: row.token_count,
    costSum: row.cost_sum,
    ewmaFailureRate: row.ewma_failure_rate ?? undefined,
    ewmaDurationMs: row.ewma_duration_ms ?? undefined,
    firstSeen: row.first_seen ?? "",
    lastSeen: row.last_seen ?? "",
    exemplars: JSON.parse(row.exemplars) as string[],
  };
}

/** Fixed duration histogram buckets (upper bound in ms); the last bucket is overflow. */
const DURATION_BUCKETS_MS = [50, 100, 250, 500, 1000, 2500, 5000, 10000];
const DURATION_BUCKET_COUNT = DURATION_BUCKETS_MS.length + 1;
/** EWMA smoothing factor for recency-weighted failure rate / duration. */
const EWMA_ALPHA = 0.2;
/** How many recent event ids a cell keeps for drill-down. */
const EXEMPLAR_LIMIT = 5;

/** Token usage, preferring the explicit `usage` field and falling back to `cost`. */
function eventTokens(event: ToolExecutionEvent): { inputTokens?: number; outputTokens?: number } {
  if (event.usage && (event.usage.inputTokens !== undefined || event.usage.outputTokens !== undefined)) {
    return event.usage;
  }
  return { inputTokens: event.cost?.inputTokens, outputTokens: event.cost?.outputTokens };
}

/** The bounded set of dimension tuples an event contributes to. */
function cellDimensionsFor(event: ToolExecutionEvent): MetricDimensions[] {
  const dims: MetricDimensions[] = [{}];
  if (event.model) dims.push({ model: event.model });
  if (event.decoding) {
    dims.push({
      ...(event.model ? { model: event.model } : {}),
      decodingProfile: event.decoding.profile,
      resolverVersion: event.decoding.resolverVersion,
    });
  }
  return dims;
}

/** Stable key for a dimension tuple (sorted keys). */
function dimsKey(dims: MetricDimensions): string {
  return JSON.stringify(
    Object.keys(dims)
      .sort()
      .map((key) => [key, dims[key]]),
  );
}

function durationBucketIndex(ms: number): number {
  for (let i = 0; i < DURATION_BUCKETS_MS.length; i += 1) {
    if (ms <= DURATION_BUCKETS_MS[i]!) return i;
  }
  return DURATION_BUCKETS_MS.length;
}

/** Fold one event into a metric cell (creating it when absent). */
function foldMetricCell(
  existing: MetricCell | undefined,
  event: ToolExecutionEvent,
  dimensions: MetricDimensions,
  now: string,
): MetricCell {
  const failed = event.status === "failed";
  const failure = failed ? 1 : 0;
  const duration = typeof event.durationMs === "number" ? event.durationMs : undefined;
  const tokens = eventTokens(event);
  const hasTokens = tokens.inputTokens !== undefined || tokens.outputTokens !== undefined;
  const cost = event.cost?.amount;

  const base: MetricCell = existing ?? {
    toolName: event.toolName,
    serverName: event.serverName,
    window: "all",
    dimensions,
    invocations: 0,
    failures: 0,
    errorCodes: {},
    durationSum: 0,
    durationCount: 0,
    durationHistogram: new Array(DURATION_BUCKET_COUNT).fill(0) as number[],
    tokenInSum: 0,
    tokenOutSum: 0,
    tokenCount: 0,
    costSum: 0,
    firstSeen: now,
    lastSeen: now,
    exemplars: [],
  };

  const errorCodes = { ...base.errorCodes };
  if (failed) {
    const code = event.error?.code ?? "unknown";
    errorCodes[code] = (errorCodes[code] ?? 0) + 1;
  }

  const histogram = [...base.durationHistogram];
  while (histogram.length < DURATION_BUCKET_COUNT) histogram.push(0);
  if (duration !== undefined) histogram[durationBucketIndex(duration)] = (histogram[durationBucketIndex(duration)] ?? 0) + 1;

  return {
    ...base,
    dimensions,
    invocations: base.invocations + 1,
    failures: base.failures + failure,
    errorCodes,
    durationSum: base.durationSum + (duration ?? 0),
    durationCount: base.durationCount + (duration !== undefined ? 1 : 0),
    durationHistogram: histogram,
    tokenInSum: base.tokenInSum + (tokens.inputTokens ?? 0),
    tokenOutSum: base.tokenOutSum + (tokens.outputTokens ?? 0),
    tokenCount: base.tokenCount + (hasTokens ? 1 : 0),
    costSum: base.costSum + (cost !== undefined && Number.isFinite(cost) ? cost : 0),
    ewmaFailureRate:
      base.ewmaFailureRate === undefined
        ? failure
        : base.ewmaFailureRate + EWMA_ALPHA * (failure - base.ewmaFailureRate),
    ewmaDurationMs:
      duration === undefined
        ? base.ewmaDurationMs
        : base.ewmaDurationMs === undefined
          ? duration
          : base.ewmaDurationMs + EWMA_ALPHA * (duration - base.ewmaDurationMs),
    lastSeen: now,
    exemplars: [...base.exemplars, event.id].slice(-EXEMPLAR_LIMIT),
  };
}
