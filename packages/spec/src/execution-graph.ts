import type { ExecutionNode } from "./types.js";

/**
 * Canonical, JSON-serializable wire format for a session's execution graph —
 * the shape any MCP server can emit (and any client can parse) for
 * cross-server graph correlation. Field names are snake_case, matching the
 * convention already used by every other *Document wire type in this
 * codebase (`WorkflowGraphDocument`, `GraphInsightsDocument`); TS-internal
 * types like `ExecutionNode` stay camelCase.
 *
 * This replaces the old `ExecutionGraph` type (Map-based `nodes`, never
 * built or consumed anywhere in the codebase) — Maps aren't directly
 * JSON-serializable, so they were never a viable wire format to begin with.
 * "Federation" here means a shared, importable schema + builder other MCP
 * servers' code can construct against — not an implemented multi-server
 * aggregation/discovery protocol, which would need infrastructure (server
 * registries, cross-server RPC) that doesn't exist in this codebase.
 */
export interface ExecutionGraphResource {
  version: string;
  etag: string;
  generated_at: string;
  session_id: string;
  workflow_id?: string;
  nodes: Array<{
    id: string;
    tool: string;
    server?: string;
    parent?: string;
    children: string[];
    timestamp: string;
    duration_ms?: number;
    status: string;
    cost?: number;
    model?: string;
    /** W3C `traceparent` recorded on the node, if graph tracking generated one. */
    trace_parent?: string;
  }>;
  edges: Array<{ from: string; to: string }>;
  /**
   * Opaque pagination cursor (the `id` of the last returned node) — present
   * when more nodes exist beyond this page. Absent on the last page or when
   * the caller didn't request pagination.
   */
  next_cursor?: string;
}

export interface BuildExecutionGraphOptions {
  version: string;
  sessionId: string;
  generatedAt?: string;
  workflowId?: string;
  nextCursor?: string;
}

/**
 * Pure builder: maps a flat `ExecutionNode[]` (already the desired page) into
 * the canonical wire shape. `etag` is returned empty — it's a hash of this
 * very output, so callers compute it over the returned object and assign it
 * afterward (see `ExtensionController.buildExecutionGraphDocument`).
 */
export function buildExecutionGraph(nodes: ExecutionNode[], opts: BuildExecutionGraphOptions): ExecutionGraphResource {
  const renderedNodes = nodes.map((n) => ({
    id: n.id,
    tool: n.toolName,
    server: n.serverName,
    parent: n.parentId,
    children: n.childrenIds,
    timestamp: n.timestamp,
    duration_ms: n.durationMs,
    status: n.status,
    cost: n.cost?.amount,
    model: n.model,
    trace_parent: n.metadata?.traceparent as string | undefined,
  }));
  const edges = nodes.flatMap((n) => n.childrenIds.map((childId) => ({ from: n.id, to: childId })));

  return {
    version: opts.version,
    etag: "",
    generated_at: opts.generatedAt ?? new Date().toISOString(),
    session_id: opts.sessionId,
    workflow_id: opts.workflowId ?? nodes[0]?.workflowId ?? "unknown",
    nodes: renderedNodes,
    edges,
    next_cursor: opts.nextCursor,
  };
}
