import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { SPEC_VERSION, TOOLS_METADATA_RESOURCE_URI } from "@adaptivemcp/spec";
import type { Annotation, Store } from "@adaptivemcp/spec";
import {
  renderToolsMetadata,
  toDocument,
  toYaml,
  type ToolsMetadataDocument,
} from "./view.js";

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
}
