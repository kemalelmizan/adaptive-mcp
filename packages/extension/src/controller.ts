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

  constructor(options: ExtensionControllerOptions) {
    this.memory = options.memory;
    this.yamlPath = options.yamlPath;
  }

  /** Recompute the view from the store and (optionally) persist it as YAML. */
  sync(): ToolsMetadataDocument {
    const doc = renderToolsMetadata(this.memory.allTools(), SPEC_VERSION);
    if (this.yamlPath) {
      mkdirSync(dirname(this.yamlPath), { recursive: true });
      writeFileSync(this.yamlPath, toYaml(doc), "utf8");
    }
    return doc;
  }

  /** Read the current view without writing to disk. */
  view(): ToolsMetadataDocument {
    return renderToolsMetadata(this.memory.allTools(), SPEC_VERSION);
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
          duration_ms: { type: "number" },
          cost: { type: "number" },
          timestamp: { type: "string", format: "date-time" },
        },
        required: ["tool", "status", "timestamp"],
      },
    };
  }

  /** Apply a human annotation and re-sync the view. */
  annotate(toolName: string, annotation: Annotation): ToolsMetadataDocument {
    this.memory.setAnnotation(annotation);
    return this.sync();
  }
}
