import yaml from "js-yaml";
import type { ToolRecord } from "@adaptivemcp/spec";

/**
 * A single tool entry in the derived YAML tools-metadata view.
 *
 * The YAML is a *projection* of the SQLite SSOT. It is never edited directly;
 * Adaptive MCP recomputes it from the SSOT whenever metadata changes.
 */
export interface ToolMetadataView {
  name: string;
  server?: string;
  /** Static, human-written annotation. */
  annotation: {
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
  generated_at: string;
  tools: ToolMetadataView[];
}

export function renderToolsMetadata(
  records: ToolRecord[],
  version: string,
): ToolsMetadataDocument {
  return {
    version,
    generated_at: new Date().toISOString(),
    tools: records.map(toToolMetadataView),
  };
}

export function toYaml(doc: ToolsMetadataDocument): string {
  return yaml.dump(doc, { lineWidth: 120, sortKeys: false, noRefs: true });
}
