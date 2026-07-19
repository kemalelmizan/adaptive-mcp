/**
 * Shared interfaces for Adaptive MCP.
 *
 * These types describe the application-level boundaries Adaptive MCP operates on.
 * They intentionally avoid coupling to shell commands, filesystems, processes,
 * sockets, or HTTP requests — those remain implementation details of MCP servers.
 */

export type ToolStatus = "started" | "completed" | "failed" | "cancelled";

export interface CostInfo {
  inputTokens?: number;
  outputTokens?: number;
  currency?: string;
  amount?: number;
}

export interface ToolError {
  message: string;
  code?: string;
}

/**
 * A single observation of a tool execution. This is the atomic unit of the
 * observation layer and feeds telemetry, evaluation, and memory.
 */
export interface ToolExecutionEvent {
  id: string;
  toolName: string;
  serverName?: string;
  sessionId?: string;
  requestId?: string;
  timestamp: string;
  durationMs?: number;
  status: ToolStatus;
  input?: unknown;
  output?: unknown;
  error?: ToolError;
  model?: string;
  cost?: CostInfo;
  metadata?: Record<string, unknown>;
}

export type InsightSource = "telemetry" | "evaluation" | "human" | "memory";

/**
 * Learned metadata about a tool. Unlike static annotations, insights are
 * derived from observed behavior and carry a confidence score.
 */
export interface Insight {
  toolName: string;
  key: string;
  value: unknown;
  confidence: number;
  source: InsightSource;
  observedAt: string;
  sampleSize?: number;
}

export type RiskLevel = "low" | "medium" | "high";

/**
 * Core MCP `ToolAnnotations` (the `annotations` object on a tool in
 * `tools/list`). Adaptive MCP maps its *static* risk onto these native hints so
 * hosts don't have to learn a parallel taxonomy. See `riskToToolAnnotations`.
 */
export interface ToolAnnotationsLike {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

/**
 * Map an Adaptive MCP static `risk` level onto core MCP `ToolAnnotations`.
 *
 * The MCP spec says clients MUST treat `ToolAnnotations` as untrusted unless
 * from a trusted server, so this is advisory — but it rides the host's native,
 * already-parsed risk signal (higher uptake than a custom `risk` field). The
 * server-published tools-metadata resource keeps `risk` for the *learned/
 * observed* dimension only (e.g. "observed flaky / costly in practice"), which
 * core hints cannot express. See doubts.md §10/§11 (Strategy 2 of the hybrid).
 */
export function riskToToolAnnotations(risk?: RiskLevel): ToolAnnotationsLike {
  switch (risk) {
    case "high":
      return { destructiveHint: true, openWorldHint: true };
    case "medium":
      return { idempotentHint: false, openWorldHint: true };
    case "low":
      return { readOnlyHint: true };
    default:
      return {};
  }
}

/**
 * Written metadata attached to a tool by a human or operator.
 *
 * `risk` here is the *static* operator-assigned risk. Per the governance hybrid
 * (doubts.md §11), static risk SHOULD be projected onto core `Tool.annotations`
 * via `riskToToolAnnotations` rather than emitted in the resource; the resource's
 * `annotation.risk` is reserved for learned/observed risk. `owner`/`tags`/
 * `description` are non-governance metadata with no core-MCP equivalent.
 */
export interface Annotation {
  toolName: string;
  risk?: RiskLevel;
  owner?: string;
  tags?: string[];
  description?: string;
  metadata?: Record<string, unknown>;
}

export type RecommendationType = "model" | "approval" | "workflow" | "routing";

/**
 * A suggested adaptation derived from accumulated knowledge.
 */
export interface Recommendation {
  toolName: string;
  type: RecommendationType;
  payload: unknown;
  rationale: string;
  confidence: number;
  generatedAt: string;
}

/**
 * The store record for a tool, persisted in SQLite.
 * The YAML tools-metadata view is derived from this record.
 */
export interface ToolRecord {
  toolName: string;
  serverName?: string;
  annotation: Annotation;
  insights: Insight[];
  recommendations: Recommendation[];
  stats: ToolStats;
  updatedAt: string;
}

export interface ToolStats {
  invocations: number;
  failures: number;
  failureRate: number;
  avgDurationMs: number | null;
  totalCost: number;
  lastObservedAt: string | null;
}

/**
 * The persistence boundary for Adaptive MCP.
 *
 * Packages depend on this interface, not on the concrete `MemoryStore`, so the
 * backend (SQLite, Postgres, in-memory, remote) can be swapped without touching
 * the middleware. `MemoryStore` in `@adaptivemcp/memory` is the reference
 * implementation.
 */
export interface Store {
  /** Close the underlying backend and release resources. */
  close(): void;

  /** Ensure a tool record exists, seeding it with an empty annotation. */
  ensureTool(toolName: string, serverName?: string): ToolRecord;

  /** Read a single tool record, or `undefined` if it has never been observed. */
  getTool(toolName: string): ToolRecord | undefined;

  /** Read every tool record, ordered by tool name. */
  allTools(): ToolRecord[];

  /** Persist a human-written annotation (the static metadata layer). */
  setAnnotation(annotation: Annotation): ToolRecord;

  /** Record a learned insight derived from observed behavior. */
  addInsight(insight: Insight): ToolRecord;

  /** Store a suggested adaptation. */
  addRecommendation(rec: Recommendation): ToolRecord;

  /**
   * Remove all recommendations of a given type for a tool. Used by the routing,
   * orchestration, and approval packages so each adaptation pass recomputes its
   * own recommendations instead of appending duplicates on every observation.
   */
  clearRecommendations(toolName: string, type: RecommendationType): ToolRecord;

  /** Fold a tool execution event into the persisted stats. */
  recordExecution(event: ToolExecutionEvent): ToolRecord;
}
