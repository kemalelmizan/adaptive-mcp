import yaml from "js-yaml";
import { createHash } from "node:crypto";
import type { ToolRecord, ExecutionGraphResource, SamplingRecommendationPayload } from "@adaptivemcp/spec";

/**
 * A single tool entry in the derived YAML tools-metadata view.
 *
 * The YAML is a *projection* of the SQLite store. It is never edited directly;
 * Adaptive MCP recomputes it from the store whenever metadata changes.
 */
export interface ToolMetadataView {
  name: string;
  server?: string;
  /** Static, human-written annotation. */
  annotation: {
    /**
     * Learned/observed risk only. Per the governance hybrid (doubts.md §11),
     * *static* operator risk SHOULD be projected onto core `Tool.annotations`
     * via `riskToToolAnnotations`, not emitted here, to avoid duplicating the
     * protocol's native risk signal. This field carries observed risk (e.g.
     * "flaky in practice") that core hints cannot express.
     */
    risk?: string;
    owner?: string;
    tags?: string[];
    description?: string;
    /** Budget limit for this tool (from routing recommendations) */
    budget?: { limit: number; currency: string };
    /** Whether this tool requires approval before execution */
    require_approval?: boolean;
    /** Suggested sampling parameters for this tool's next LLM turn (from a `sampling` recommendation). */
    sampling?: SamplingRecommendationPayload;
  };
  /** Learned from observed behavior. */
  insights: Record<string, { value: unknown; confidence: number; source: string }>;
  /** Suggested adaptations. */
  recommendations: Array<{ type: string; payload: unknown; rationale: string }>;
  /** Raw accumulated stats. */
  stats: {
    invocations: number;
    failures: number;
    failure_rate: number;
    avg_duration_ms: number | null;
    total_cost: number;
    last_observed_at: string | null;
  };
  /**
   * Per-middleware contributions (D3: the YAML `middleware` map). Each key is a
   * middleware name (e.g. "headroom") and the value is whatever that middleware
   * chose to surface via `contributeView` — e.g. a CCR hash, savings percent,
   * or a skip/error marker. Absent when no middleware is registered.
   */
  middleware?: Record<string, unknown>;
  updated_at: string;
}

export function toToolMetadataView(
  record: ToolRecord,
  middleware?: Record<string, unknown>,
): ToolMetadataView {
  const insights: ToolMetadataView["insights"] = {};
  for (const i of record.insights) {
    insights[i.key] = { value: i.value, confidence: i.confidence, source: i.source };
  }
  
  // Extract budget and approval recommendations
  const budgetRec = record.recommendations.find(r => r.type === "routing" && r.payload && typeof r.payload === "object" && "perToolLimit" in r.payload);
  const approvalRec = record.recommendations.find(r => r.type === "approval" && r.payload && typeof r.payload === "object" && "decision" in r.payload);
  const samplingRec = record.recommendations.find(r => r.type === "sampling");

  return {
    name: record.toolName,
    server: record.serverName,
    annotation: {
      risk: record.annotation.risk,
      owner: record.annotation.owner,
      tags: record.annotation.tags,
      description: record.annotation.description,
      budget: budgetRec ? { limit: (budgetRec.payload as { perToolLimit: number }).perToolLimit, currency: "USD" } : undefined,
      require_approval: approvalRec ? (approvalRec.payload as { decision: string }).decision === "require_confirmation" : undefined,
      sampling: samplingRec ? (samplingRec.payload as SamplingRecommendationPayload) : undefined,
    },
    insights,
    recommendations: record.recommendations.map((r) => ({
      type: r.type,
      payload: r.payload,
      rationale: r.rationale,
    })),
    stats: {
      invocations: record.stats.invocations,
      failures: record.stats.failures,
      failure_rate: Number(record.stats.failureRate.toFixed(4)),
      avg_duration_ms: record.stats.avgDurationMs,
      total_cost: record.stats.totalCost,
      last_observed_at: record.stats.lastObservedAt,
    },
    middleware: middleware && Object.keys(middleware).length > 0 ? middleware : undefined,
    updated_at: record.updatedAt,
  };
}

export interface ToolsMetadataDocument {
  version: string;
  /** Opaque cache token; changes whenever the view changes. */
  etag: string;
  generated_at: string;
  tools: ToolMetadataView[];
  /** Graph insights aggregated across all tools. */
  graphInsights?: {
    workflows: Record<string, {
      avgDurationMs: number;
      successRate: number;
      avgCost: number;
      commonBottlenecks: string[];
      typicalFanOut: number;
      failureBlastRadius: number;
    }>;
  };
}

/**
 * Execution graph document for a single session. This is exactly
 * `@adaptivemcp/spec`'s canonical `ExecutionGraphResource` wire schema — kept
 * as a local alias so existing imports of `ExecutionGraphDocument` from this
 * package don't need to change call sites.
 */
export type ExecutionGraphDocument = ExecutionGraphResource;

/** Workflow graph document (aggregated across sessions). */
export interface WorkflowGraphDocument {
  version: string;
  etag: string;
  generated_at: string;
  workflow_id: string;
  total_executions: number;
  success_rate: number;
  avg_duration_ms: number;
  avg_cost: number;
  common_patterns: Array<{
    pattern: string;
    frequency: number;
    avg_duration_ms: number;
    success_rate: number;
  }>;
  critical_path: Array<{
    tool: string;
    avg_duration_ms: number;
    frequency: number;
  }>;
}

/** Graph insights document for a session. */
export interface GraphInsightsDocument {
  version: string;
  etag: string;
  generated_at: string;
  session_id: string;
  workflow_id: string;
  total_nodes: number;
  total_duration_ms: number;
  total_cost: number;
  failed_nodes: number;
  max_fan_out: number;
  parallelizable_nodes: string[];
  critical_path: string[];
}

/** Union of all document types for serialization. */
export type AnyDocument = ToolsMetadataDocument | ExecutionGraphDocument | WorkflowGraphDocument | GraphInsightsDocument;

export function renderToolsMetadata(
  records: ToolRecord[],
  version: string,
  middleware?: Record<string, unknown>,
): ToolsMetadataDocument {
  const tools = records.map((r) => toToolMetadataView(r, middleware));
  const generated_at = new Date().toISOString();
  // etag is a stable hash of the *meaningful* content (version + tools), NOT
  // including the volatile generated_at timestamp. Two renders of an unchanged
  // store therefore produce the same etag, so clients can skip re-parsing.
  const etag = createHash("sha1")
    .update(yaml.dump({ version, tools }, { noRefs: true }))
    .digest("hex");
  return { version, etag, generated_at, tools };
}

/**
 * Stable sha1 hash of the *meaningful* content of a document — callers pass
 * only the fields that should invalidate the etag (never `generated_at` or
 * `etag` itself), so two renders of unchanged data produce the same etag.
 */
export function computeEtag(payload: unknown): string {
  return createHash("sha1").update(JSON.stringify(payload)).digest("hex");
}

export function toYaml(doc: AnyDocument): string {
  // Strict dump: no custom tags, no object refs — safe to re-parse.
  return yaml.dump(doc, { lineWidth: 120, sortKeys: false, noRefs: true, schema: yaml.JSON_SCHEMA });
}

/** Serialize the document in the requested MIME type (YAML or JSON). */
export function toDocument(doc: AnyDocument, mimeType: string): string {
  if (mimeType === "application/json") {
    return JSON.stringify(doc, null, 2);
  }
  return toYaml(doc);
}
