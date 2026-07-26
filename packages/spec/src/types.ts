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
  key: string;
  value: unknown;
  confidence: number;
  source: InsightSource;
  observedAt: string;
  sampleSize?: number;
}

export type RiskLevel = "low" | "medium" | "high";

/**
 * Written metadata attached to a tool by a human or operator.
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
 * The single source of truth (SSOT) record for a tool, persisted in SQLite.
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
 * An execution graph (DAG) representing a complete workflow.
 */
export interface ExecutionGraph {
  workflowId: string;
  sessionId: string;
  rootNodeId: string;
  nodes: Map<string, ExecutionNode>;
  createdAt: string;
  completedAt?: string;
  status: "running" | "completed" | "failed" | "partial";
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

export interface FailureCascade {
  rootCause: ExecutionNode;
  affectedNodes: ExecutionNode[];
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
