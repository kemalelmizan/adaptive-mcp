import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { SPEC_VERSION, TOOLS_METADATA_RESOURCE_URI, buildExecutionGraph } from "@adaptivemcp/spec";
import type { Annotation, Store, ExecutionNode, ToolRecord } from "@adaptivemcp/spec";
import {
  renderToolsMetadata,
  toDocument,
  toYaml,
  computeEtag,
  type ToolsMetadataDocument,
  type ExecutionGraphDocument,
  type WorkflowGraphDocument,
  type GraphInsightsDocument,
} from "./view.js";

/** Returned by conditional-read resource methods when `ifNoneMatch` matches the current etag. */
export interface NotModified {
  notModified: true;
  etag: string;
}

export interface ResourceReadOptions {
  /** When this matches the document's current etag, the method returns `{ notModified: true }` instead of the full document. */
  ifNoneMatch?: string;
}

export interface PaginatedResourceReadOptions extends ResourceReadOptions {
  /** Opaque cursor from a previous read's `next_cursor` (the last node's id on that page). Nodes are returned strictly after it. An unknown/stale cursor falls back to the first page rather than erroring. */
  cursor?: string;
  /** Max nodes per page. Defaults to 50. */
  pageSize?: number;
}

export interface ExtensionControllerOptions {
  memory: Store;
  /** Where to write the derived YAML view. If omitted, only the in-memory doc is produced. */
  yamlPath?: string;
}

/**
 * The Adaptive MCP extension controller.
 *
 * Responsibilities:
 *  - derive the tools-metadata view from the Store (the persistence boundary);
 *  - write it to disk (so out-of-band MCP clients can read it);
 *  - expose it as an MCP resource (`dev.adaptivemcp/tools-metadata`), serving
 *    both YAML and JSON via content negotiation.
 *  - expose execution graph resources for workflow intelligence.
 *
 * The controller never treats the view as the source of truth. Any change to
 * tool metadata flows: event -> Store -> view.
 */
export class ExtensionController {
  private memory: Store;
  private yamlPath?: string;
  /**
   * Global middleware contributions (D3: the YAML `middleware` map). Set by the
   * runtime via `setMiddlewareView` so `contributeView` results from the
   * registered `MiddlewareChain` surface in `tools-metadata.yaml`. Keyed by
   * middleware name (e.g. "headroom" -> { hash, savingsPercent }).
   */
  private middlewareView?: Record<string, unknown>;

  constructor(options: ExtensionControllerOptions) {
    this.memory = options.memory;
    this.yamlPath = options.yamlPath;
  }

  /** Provide the aggregated middleware `contributeView` map for the YAML view. */
  setMiddlewareView(view?: Record<string, unknown>): void {
    this.middlewareView = view;
  }

  /** Recompute the view from the store and (optionally) persist it as YAML. */
  sync(): ToolsMetadataDocument {
    const doc = renderToolsMetadata(this.memory.allTools(), SPEC_VERSION, this.middlewareView);
    if (this.yamlPath) {
      mkdirSync(dirname(this.yamlPath), { recursive: true });
      writeFileSync(this.yamlPath, toYaml(doc), "utf8");
    }
    return doc;
  }

  /** Read the current view without writing to disk. */
  view(): ToolsMetadataDocument {
    return renderToolsMetadata(this.memory.allTools(), SPEC_VERSION, this.middlewareView);
  }

  /** MCP resource URI for the derived tools-metadata view (`dev.adaptivemcp://tools-metadata`). */
  resourceUri(): string {
    return TOOLS_METADATA_RESOURCE_URI;
  }

  /** Serialize the view in the requested MIME type (YAML default, or JSON). */
  resourceText(mimeType = "application/yaml"): string {
    return toDocument(this.view(), mimeType);
  }

  /**
   * Get the execution graph for a session as an MCP resource.
   * URI: `dev.adaptivemcp://execution-graph/{sessionId}`
   */
  executionGraphResourceUri(sessionId: string): string {
    return `dev.adaptivemcp://execution-graph/${sessionId}`;
  }

  /**
   * Get the execution graph for a session in the requested format.
   *
   * Paginated over `nodes` (a session's node count is unbounded over a long
   * enough run): pass `cursor` (a previous read's `next_cursor`) and/or
   * `pageSize` in `options`. Edges are always returned in full regardless of
   * the current node page — filtering them by page membership would silently
   * disconnect the graph, and a client couldn't tell "no edge" from "edge
   * hidden by pagination."
   */
  executionGraphResourceText(
    sessionId: string,
    mimeType = "application/yaml",
    options: PaginatedResourceReadOptions = {},
  ): string | NotModified {
    const doc = this.buildExecutionGraphDocument(sessionId, options);
    if (options.ifNoneMatch && options.ifNoneMatch === doc.etag) {
      return { notModified: true, etag: doc.etag };
    }
    return toDocument(doc, mimeType);
  }

  private buildExecutionGraphDocument(
    sessionId: string,
    pagination: { cursor?: string; pageSize?: number } = {},
  ): ExecutionGraphDocument {
    const graphStore = this.memory as Store & {
      getNodesBySession?: (sessionId: string) => ExecutionNode[];
      getRootNodes?: (sessionId: string) => ExecutionNode[];
    };

    const allNodes = graphStore.getNodesBySession && graphStore.getRootNodes ? graphStore.getNodesBySession(sessionId) : [];

    const pageSize = pagination.pageSize ?? 50;
    let startIndex = 0;
    if (pagination.cursor) {
      const cursorIndex = allNodes.findIndex((n) => n.id === pagination.cursor);
      startIndex = cursorIndex === -1 ? 0 : cursorIndex + 1;
    }
    const pageNodes = allNodes.slice(startIndex, startIndex + pageSize);
    const hasMore = startIndex + pageNodes.length < allNodes.length;
    const nextCursor = hasMore ? pageNodes[pageNodes.length - 1]?.id : undefined;

    const doc = buildExecutionGraph(pageNodes, { version: SPEC_VERSION, sessionId, nextCursor });
    // Edges reflect the full graph, not just this page (see docstring above).
    doc.edges = allNodes.flatMap((n) => n.childrenIds.map((childId) => ({ from: n.id, to: childId })));

    doc.etag = computeEtag({
      version: doc.version,
      session_id: doc.session_id,
      workflow_id: doc.workflow_id,
      nodes: doc.nodes,
      edges: doc.edges,
    });
    return doc;
  }

  /**
   * Get the execution graph as Mermaid diagram.
   * URI: `dev.adaptivemcp://execution-graph/{sessionId}/mermaid`
   */
  executionGraphMermaidResourceUri(sessionId: string): string {
    return `dev.adaptivemcp://execution-graph/${sessionId}/mermaid`;
  }

  /** Get the execution graph as Mermaid diagram text. */
  executionGraphMermaidResourceText(sessionId: string): string {
    const graphStore = this.memory as Store & {
      getNodesBySession?: (sessionId: string) => ExecutionNode[];
      getRootNodes?: (sessionId: string) => ExecutionNode[];
    };
    
    if (!graphStore.getNodesBySession || !graphStore.getRootNodes) {
      return "graph TD\n  A[Graph tracking not enabled]";
    }

    const nodes = graphStore.getNodesBySession(sessionId);
    if (nodes.length === 0) {
      return "graph TD\n  A[Session not found]";
    }

    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    let mermaid = "graph TD\n";
    
    // Add nodes
    for (const node of nodes) {
      const label = `${node.toolName}\\n${node.durationMs ?? 0}ms`;
      const status = node.status === "failed" ? ":::failed" : node.status === "completed" ? ":::completed" : ":::running";
      mermaid += `  ${node.id.replace(/-/g, "_")}[${label}]${status}\n`;
    }
    
    // Add edges
    for (const node of nodes) {
      for (const childId of node.childrenIds) {
        mermaid += `  ${node.id.replace(/-/g, "_")} --> ${childId.replace(/-/g, "_")}\n`;
      }
    }
    
    // Add styles
    mermaid += "  classDef failed fill:#ffcccc,stroke:#ff0000;\n";
    mermaid += "  classDef completed fill:#ccffcc,stroke:#00ff00;\n";
    mermaid += "  classDef running fill:#ffffcc,stroke:#ffaa00;\n";
    
    return mermaid;
  }

  /**
   * Get workflow graph (aggregated across sessions).
   * URI: `dev.adaptivemcp://workflow-graph/{workflowId}`
   */
  workflowGraphResourceUri(workflowId: string): string {
    return `dev.adaptivemcp://workflow-graph/${workflowId}`;
  }

  /** Get the workflow graph in the requested format. */
  workflowGraphResourceText(
    workflowId: string,
    mimeType = "application/yaml",
    options: ResourceReadOptions = {},
  ): string | NotModified {
    const doc = this.buildWorkflowGraphDocument(workflowId);
    if (options.ifNoneMatch && options.ifNoneMatch === doc.etag) {
      return { notModified: true, etag: doc.etag };
    }
    return toDocument(doc, mimeType);
  }

  private buildWorkflowGraphDocument(workflowId: string): WorkflowGraphDocument {
    const graphStore = this.memory as Store & {
      getNodesByWorkflow?: (workflowId: string) => ExecutionNode[];
    };

    const nodes = graphStore.getNodesByWorkflow ? graphStore.getNodesByWorkflow(workflowId) : [];

    // Group by session
    const sessions = new Map<string, ExecutionNode[]>();
    for (const node of nodes) {
      const sessionNodes = sessions.get(node.sessionId) ?? [];
      sessionNodes.push(node);
      sessions.set(node.sessionId, sessionNodes);
    }

    // Calculate aggregated stats
    const sessionCount = sessions.size;
    let totalDuration = 0;
    let totalCost = 0;
    let successCount = 0;

    for (const [, sessionNodes] of sessions) {
      const root = sessionNodes.find(n => !n.parentId);
      if (root) {
        totalDuration += root.durationMs ?? 0;
        totalCost += sessionNodes.reduce((sum, n) => sum + (n.cost?.amount ?? 0), 0);
        const hasFailure = sessionNodes.some(n => n.status === "failed");
        if (!hasFailure) successCount++;
      }
    }

    const total_executions = sessionCount;
    const success_rate = sessionCount > 0 ? successCount / sessionCount : 0;
    const avg_duration_ms = sessionCount > 0 ? Math.round(totalDuration / sessionCount) : 0;
    const avg_cost = sessionCount > 0 ? totalCost / sessionCount : 0;
    const common_patterns: WorkflowGraphDocument["common_patterns"] = [];
    const critical_path: WorkflowGraphDocument["critical_path"] = [];

    return {
      version: SPEC_VERSION,
      etag: computeEtag({
        version: SPEC_VERSION,
        workflow_id: workflowId,
        total_executions,
        success_rate,
        avg_duration_ms,
        avg_cost,
        common_patterns,
        critical_path,
      }),
      generated_at: new Date().toISOString(),
      workflow_id: workflowId,
      total_executions,
      success_rate,
      avg_duration_ms,
      avg_cost,
      common_patterns,
      critical_path,
    };
  }

  /**
   * Get graph insights for a session.
   * URI: `dev.adaptivemcp://graph-insights/{sessionId}`
   */
  graphInsightsResourceUri(sessionId: string): string {
    return `dev.adaptivemcp://graph-insights/${sessionId}`;
  }

  /** Get graph insights for a session. */
  graphInsightsResourceText(
    sessionId: string,
    mimeType = "application/yaml",
    options: ResourceReadOptions = {},
  ): string | NotModified {
    const doc = this.buildGraphInsightsDocument(sessionId);
    if (options.ifNoneMatch && options.ifNoneMatch === doc.etag) {
      return { notModified: true, etag: doc.etag };
    }
    return toDocument(doc, mimeType);
  }

  private buildGraphInsightsDocument(sessionId: string): GraphInsightsDocument {
    // This would use GraphAnalyzer - for now return basic info
    const graphStore = this.memory as Store & {
      getNodesBySession?: (sessionId: string) => ExecutionNode[];
      getRootNodes?: (sessionId: string) => ExecutionNode[];
    };

    const nodes = graphStore.getNodesBySession && graphStore.getRootNodes ? graphStore.getNodesBySession(sessionId) : [];

    const workflow_id = nodes[0]?.workflowId ?? "unknown";
    const total_duration_ms = nodes.reduce((sum, n) => sum + (n.durationMs ?? 0), 0);
    const total_cost = nodes.reduce((sum, n) => sum + (n.cost?.amount ?? 0), 0);
    const failed_nodes = nodes.filter(n => n.status === "failed").length;
    const max_fan_out = nodes.length > 0 ? Math.max(...nodes.map(n => n.childrenIds.length)) : 0;
    const parallelizable_nodes = nodes.filter(n => n.childrenIds.length > 1).map(n => n.toolName);
    const critical_path = this.getCriticalPath(nodes).map(n => n.toolName);

    return {
      version: SPEC_VERSION,
      etag: computeEtag({
        version: SPEC_VERSION,
        session_id: sessionId,
        workflow_id,
        total_nodes: nodes.length,
        total_duration_ms,
        total_cost,
        failed_nodes,
        max_fan_out,
        parallelizable_nodes,
        critical_path,
      }),
      generated_at: new Date().toISOString(),
      session_id: sessionId,
      workflow_id,
      total_nodes: nodes.length,
      total_duration_ms,
      total_cost,
      failed_nodes,
      max_fan_out,
      parallelizable_nodes,
      critical_path,
    };
  }

  private getCriticalPath(nodes: ExecutionNode[]): ExecutionNode[] {
    if (nodes.length === 0) return [];
    
    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    const roots = nodes.filter(n => !n.parentId);
    
    let maxDuration = 0;
    let criticalPath: ExecutionNode[] = [];

    function dfs(nodeId: string, currentPath: ExecutionNode[], currentDuration: number) {
      const node = nodeMap.get(nodeId);
      if (!node) return;

      const newPath = [...currentPath, node];
      const nodeDuration = node.durationMs ?? 0;
      const newDuration = currentDuration + nodeDuration;

      if (node.childrenIds.length === 0) {
        if (newDuration > maxDuration) {
          maxDuration = newDuration;
          criticalPath = newPath;
        }
      } else {
        for (const childId of node.childrenIds) {
          dfs(childId, newPath, newDuration);
        }
      }
    }

    for (const root of roots) {
      dfs(root.id, [], 0);
    }

    return criticalPath;
  }

  /**
   * The `report_observation` tool definition (the spec-legal client→server
   * report channel). Servers register this tool so clients can report
   * execution observations back. The server MAY ignore reports.
   *
   * `client_id` is optional but recommended: it lets the server distinguish
   * reports from different clients for per-client vs aggregated semantics.
   */
  reportObservationTool(): {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  } {
    return {
      name: "report_observation",
      description: "Report a tool execution observation back to the server.",
      inputSchema: {
        type: "object",
        properties: {
          tool: { type: "string" },
          status: { type: "string", enum: ["success", "failure", "error"] },
          duration_ms: { type: "number", minimum: 0 },
          cost: { type: "number", minimum: 0 },
          timestamp: { type: "string", format: "date-time" },
          client_id: { type: "string", description: "Optional caller identifier for per-client aggregation." },
        },
        required: ["tool", "status", "timestamp"],
      },
    };
  }

  /**
   * Validate and fold a `report_observation` payload into the store.
   *
   * Validation (per SEP §Security: client-supplied reports MUST be validated):
   *  - `duration_ms` / `cost` must be finite and non-negative (else dropped);
   *  - `timestamp` must be a parseable ISO-8601 date (else the current time is
   *    used so `stats.last_observed_at` stays meaningful).
   *
   * The server MAY ignore reports entirely; callers gate this with
   * `foldReports` (a stateless server passes `false` and this is a no-op).
   * `client_id`, when present, is recorded in the event `metadata` so the
   * server can later support per-client aggregation.
   */
  reportObservation(input: {
    tool: string;
    status: "success" | "failure" | "error";
    duration_ms?: number;
    cost?: number;
    timestamp: string;
    client_id?: string;
    foldReports?: boolean;
  }): { accepted: boolean; reason?: string } {
    if (input.foldReports === false) {
      return { accepted: false, reason: "server does not persist observations" };
    }
    const durationMs =
      typeof input.duration_ms === "number" && Number.isFinite(input.duration_ms) && input.duration_ms >= 0
        ? input.duration_ms
        : undefined;
    const cost =
      typeof input.cost === "number" && Number.isFinite(input.cost) && input.cost >= 0
        ? { amount: input.cost, currency: "USD" }
        : undefined;
    const timestamp = this.validTimestamp(input.timestamp);
    const metadata: Record<string, unknown> = {};
    if (input.client_id) metadata.client_id = input.client_id;

    this.memory.recordExecution({
      id: crypto.randomUUID(),
      toolName: input.tool,
      timestamp,
      status: input.status === "success" ? "completed" : "failed",
      durationMs,
      cost,
      metadata,
    });
    return { accepted: true };
  }

  /** Parse `timestamp`; fall back to now if it is not a valid ISO-8601 date. */
  private validTimestamp(value: string): string {
    const t = Date.parse(value);
    return Number.isNaN(t) ? new Date().toISOString() : new Date(t).toISOString();
  }

  /** Apply a human annotation and re-sync the view. */
  annotate(toolName: string, annotation: Annotation): ToolsMetadataDocument {
    this.memory.setAnnotation(annotation);
    return this.sync();
  }

  /**
   * Aggregate tools-metadata views from multiple stores (multi-server aggregation).
   * This merges views from multiple stores, preserving the (toolName, serverName) composite key.
   * 
   * @param stores Array of stores to aggregate
   * @returns Aggregated ToolsMetadataDocument
   */
  static aggregateViews(stores: Store[], version: string = SPEC_VERSION): ToolsMetadataDocument {
    const allTools: ToolRecord[] = [];
    const seen = new Set<string>();
    
    for (const store of stores) {
      for (const tool of store.allTools()) {
        const key = `${tool.toolName}::${tool.serverName ?? ''}`;
        if (!seen.has(key)) {
          seen.add(key);
          allTools.push(tool);
        }
      }
    }
    
    return renderToolsMetadata(allTools, SPEC_VERSION);
  }
}
