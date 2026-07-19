import yaml from "js-yaml";
import { createHash } from "node:crypto";
import type { ToolRecord } from "@adaptivemcp/spec";

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
  updated_at: string;
}

export function toToolMetadataView(record: ToolRecord): ToolMetadataView {
  const insights: ToolMetadataView["insights"] = {};
  for (const i of record.insights) {
    insights[i.key] = { value: i.value, confidence: i.confidence, source: i.source };
  }
  return {
    name: record.toolName,
    server: record.serverName,
    annotation: {
      risk: record.annotation.risk,
      owner: record.annotation.owner,
      tags: record.annotation.tags,
      description: record.annotation.description,
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
    updated_at: record.updatedAt,
  };
}

export interface ToolsMetadataDocument {
  version: string;
  /** Opaque cache token; changes whenever the view changes. */
  etag: string;
  generated_at: string;
  tools: ToolMetadataView[];
}

export function renderToolsMetadata(
  records: ToolRecord[],
  version: string,
): ToolsMetadataDocument {
  const tools = records.map(toToolMetadataView);
  const generated_at = new Date().toISOString();
  // etag is a stable hash of the *meaningful* content (version + tools), NOT
  // including the volatile generated_at timestamp. Two renders of an unchanged
  // store therefore produce the same etag, so clients can skip re-parsing.
  const etag = createHash("sha1")
    .update(yaml.dump({ version, tools }, { noRefs: true }))
    .digest("hex");
  return { version, etag, generated_at, tools };
}

export function toYaml(doc: ToolsMetadataDocument): string {
  // Strict dump: no custom tags, no object refs — safe to re-parse.
  return yaml.dump(doc, { lineWidth: 120, sortKeys: false, noRefs: true, schema: yaml.JSON_SCHEMA });
}

/** Serialize the document in the requested MIME type (YAML or JSON). */
export function toDocument(doc: ToolsMetadataDocument, mimeType: string): string {
  if (mimeType === "application/json") {
    return JSON.stringify(doc, null, 2);
  }
  return toYaml(doc);
}
