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
  /** Parent node ID in the execution graph (for DAG construction) */
  parentId?: string;
  /** Human-readable workflow name (e.g., "deploy_release") */
  workflowId?: string;
}

export type InsightSource = "telemetry" | "evaluation" | "human" | "memory";

/**
 * Learned metadata about a tool. Unlike static annotations, insights are
 * derived from observed behavior and carry a confidence score.
 */
export interface Insight {
  toolName: string;
  serverName?: string;
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
  serverName?: string;
  risk?: RiskLevel;
  owner?: string;
  tags?: string[];
  description?: string;
  metadata?: Record<string, unknown>;
}

export type RecommendationType = "model" | "approval" | "workflow" | "routing" | "sampling" | "decoding";

/**
 * A suggested adaptation derived from accumulated knowledge.
 */
export interface Recommendation {
  toolName: string;
  serverName?: string;
  type: RecommendationType;
  payload: unknown;
  rationale: string;
  confidence: number;
  generatedAt: string;
}

/**
 * Payload shape for `Recommendation.type === "sampling"`: suggested LLM
 * sampling parameters for the *next* generation turn involving this tool.
 * All fields optional — an advisor only emits the parameters it has an
 * opinion about; a host applying this should treat an absent field as "no
 * change from your own default," never as "set to undefined/null."
 *
 * Advisory only: nothing in this repo makes an LLM completion call, so this
 * payload has no effect unless a host reads it and applies it to its own
 * request.
 *
 * @deprecated Superseded by `DecodingProfile` + `DecodingResolver` (Phase 8,
 * see docs/ROADMAP.md and docs/doubts.md §13 D5). Kept exported and working —
 * a shipped public shape shouldn't break existing consumers for a rename —
 * but new code should produce/consume `DecodingRecommendation` instead. Will
 * be removed at the next `SPEC_VERSION` major bump.
 */
export interface SamplingRecommendationPayload {
  temperature?: number;
  topP?: number;
  topK?: number;
  presencePenalty?: number;
  repetitionPenalty?: number;
}

/**
 * A symbolic, backend-agnostic decoding intent. `DecodingAdvisor` emits this
 * instead of raw sampling numbers — nothing backend-specific belongs here.
 * `DecodingResolver` is the only thing that translates it into concrete
 * knobs for a specific backend. See docs/doubts.md §13 D1.
 */
export interface DecodingProfile {
  id: "deterministic" | "balanced" | "creative";
}

/**
 * Which decoding knobs a specific model/inference backend actually exposes.
 * `DecodingResolver` uses this to translate a `DecodingProfile` into
 * `ResolvedDecodingSettings`, dropping (never approximating) knobs a backend
 * doesn't support — e.g. `minP` and `topP` aren't equivalent, so one is never
 * substituted for the other.
 */
export interface ModelCapabilities {
  supports: {
    temperature?: boolean;
    topP?: boolean;
    topK?: boolean;
    minP?: boolean;
    presencePenalty?: boolean;
    repetitionPenalty?: boolean;
    frequencyPenalty?: boolean;
  };
}

/**
 * Concrete, backend-specific decoding parameters produced by a
 * `DecodingResolver`. Superset of the deprecated `SamplingRecommendationPayload`
 * (adds `minP`/`frequencyPenalty`) — all fields optional, absent means "no
 * opinion," never "set to null."
 */
export interface ResolvedDecodingSettings {
  temperature?: number;
  topP?: number;
  topK?: number;
  minP?: number;
  presencePenalty?: number;
  repetitionPenalty?: number;
  frequencyPenalty?: number;
}

/**
 * What `DecodingAdvisor` + `DecodingResolver` jointly produce: a suggested
 * decoding profile, its concrete resolved settings for a specific backend,
 * the resolver version that produced them (so past decisions stay
 * reproducible after the resolver's tables change), and enough evidence
 * (`confidence`/`reasons`) for a host to decide whether to trust it.
 *
 * Advisory only, same as `SamplingRecommendationPayload` — nothing here is
 * auto-applied; a host reads this and chooses whether to act on it.
 */
export interface DecodingRecommendation {
  profile: DecodingProfile;
  resolved: ResolvedDecodingSettings;
  resolverVersion: string;
  confidence: number;
  reasons: string[];
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
  /** Average output tokens per invocation (for context cost tracking) */
  avgOutputTokens?: number;
}

/**
 * A single node in the execution graph (DAG).
 * Each tool invocation becomes a node with parent/children relationships.
 */
export interface ExecutionNode {
  id: string;
  toolName: string;
  serverName?: string;
  sessionId: string;
  workflowId?: string;
  parentId?: string;
  childrenIds: string[];
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

/**
 * Graph analysis results.
 */
export interface CriticalPathResult {
  path: ExecutionNode[];
  totalDurationMs: number;
}

export interface Bottleneck {
  node: ExecutionNode;
  impactScore: number; // How much this node slows down the critical path
  reason: "duration" | "fan_out" | "failure_rate" | "cost";
}

export interface FanOutReport {
  maxFanOut: number;
  avgFanOut: number;
  parallelizableNodes: ExecutionNode[];
  sequentialChains: ExecutionNode[][];
}

/**
 * A recurring structural anti-pattern detected in a session's graph.
 * Deliberately limited to two named shapes rather than general subgraph
 * isomorphism (NP-hard, unnecessary for small execution DAGs).
 */
export interface AntiPattern {
  type: "sequential_bottleneck" | "diamond_dependency";
  nodes: ExecutionNode[];
  severity: number;
}

export interface FailureCascade {
  rootCause: ExecutionNode;
  affectedNodes: ExecutionNode[];
  blastRadius: number;
}

/**
 * Ancestor-based causal ordering among the failed nodes of a session: a
 * failed node with no failed ancestor is a root cause; a failed node
 * downstream of a failed ancestor is a symptom of the nearest one. This is
 * NOT counterfactual causal inference (which would require replaying
 * execution without the trigger) — it's graph-ancestry ordering over the
 * failures actually recorded.
 */
export interface CausalCascade {
  rootCauses: ExecutionNode[];
  symptoms: Array<{ node: ExecutionNode; causedBy: ExecutionNode }>;
  blastRadius: number;
}

export interface CostBreakdown {
  totalCost: number;
  byTool: Record<string, number>;
  byNode: Record<string, number>;
  criticalPathCost: number;
}

export interface WorkflowStats {
  workflowId: string;
  totalExecutions: number;
  successRate: number;
  avgDurationMs: number;
  avgCost: number;
  commonPatterns: WorkflowPattern[];
}

export interface WorkflowPattern {
  pattern: string;
  frequency: number;
  avgDurationMs: number;
  successRate: number;
}

/**
 * A heuristic forecast for an in-progress workflow session, extrapolated
 * from historical runs of the same workflow. NOT a trained/statistical
 * model — a ratio-vs-baseline projection, in the same spirit as
 * `detectAnomalies`'s duration/cost ratio checks.
 */
export interface WorkflowForecast {
  workflowId: string;
  /** Nodes seen so far / historical avg node count for this workflow, capped at 1. */
  progressRatio: number;
  projectedDurationMs: number;
  projectedCost: number;
  /** Blend of historical failure rate and this session's own failures observed so far. */
  failureProbability: number;
}

/**
 * The persistence boundary for Adaptive MCP.
 *
 * Packages depend on this interface, not on the concrete `MemoryStore`, so the
 * backend (SQLite, Postgres, in-memory, remote) can be swapped without touching
 * the middleware. `MemoryStore` in `@adaptivemcp/memory` is the reference
 * implementation.
 *
 * Records are identified by the `(toolName, serverName)` pair, not `toolName`
 * alone: two different MCP servers may expose a tool with the same name, and
 * without the server in the key their records would collide. `serverName` is
 * optional on read/write because not every call site knows which server it's
 * dealing with; when omitted, lookups fall back to the most recently updated
 * record with that `toolName` (ambiguous only if the same tool name is in use
 * across multiple servers).
 */
export interface Store {
  /** Close the underlying backend and release resources. */
  close(): void;

  /** Ensure a tool record exists, seeding it with an empty annotation. */
  ensureTool(toolName: string, serverName?: string): ToolRecord;

  /**
   * Read a single tool record, or `undefined` if it has never been observed.
   * Pass `serverName` to disambiguate when the same tool name may exist on
   * multiple servers; otherwise the most recently updated match is returned.
   */
  getTool(toolName: string, serverName?: string): ToolRecord | undefined;

  /** Read every tool record, ordered by tool name then server name. */
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
  clearRecommendations(toolName: string, type: RecommendationType, serverName?: string): ToolRecord;

  /** Fold a tool execution event into the persisted stats. */
  recordExecution(event: ToolExecutionEvent): ToolRecord;

  // Graph methods (optional - only implemented when graph tracking is enabled)
  /** Record an execution node in the graph. */
  recordExecutionNode?(node: ExecutionNode): ExecutionNode;
  /** Get an execution node by ID. */
  getExecutionNode?(id: string): ExecutionNode | undefined;
  /** Get all nodes for a session. */
  getNodesBySession?(sessionId: string): ExecutionNode[];
  /** Get all nodes for a workflow (across sessions). */
  getNodesByWorkflow?(workflowId: string): ExecutionNode[];
  /** Get every distinct workflow ID that has at least one recorded execution node. */
  getWorkflowIds?(): string[];
  /** Get children of a node. */
  getChildren?(parentId: string): ExecutionNode[];
  /** Get parent of a node. */
  getParent?(childId: string): ExecutionNode | undefined;
  /** Get root nodes (no parent) for a session. */
  getRootNodes?(sessionId: string): ExecutionNode[];
  /** Get leaf nodes (no children) for a session. */
  getLeafNodes?(sessionId: string): ExecutionNode[];
  /** Update children IDs of a parent node. */
  updateChildrenIds?(parentId: string, childrenIds: string[]): void;
}
