import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { SPEC_VERSION } from "@adaptivemcp/spec";
import type { Annotation, Store } from "@adaptivemcp/spec";
import {
  renderToolsMetadata,
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
 *  - derive the YAML tools-metadata view from the SQLite store;
 *  - write it to disk (so out-of-band MCP clients can read it);
 *  - expose it as an MCP resource (`dev.adaptivemcp/tools-metadata`).
 *
 * The controller never treats the YAML as the source of truth. Any change to
 * tool metadata flows: event -> MemoryStore -> YAML view.
 */
export class ExtensionController {
  private memory: Store;
  private yamlPath?: string;

  constructor(options: ExtensionControllerOptions) {
    this.memory = options.memory;
    this.yamlPath = options.yamlPath;
  }

  /** Recompute the YAML view from the store and (optionally) persist it. */
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

  /** MCP resource URI for the derived tools-metadata view (`dev.adaptivemcp/tools-metadata`). */
  resourceUri(): string {
    return "dev.adaptivemcp/tools-metadata";
  }

  resourceText(): string {
    return toYaml(this.view());
  }

  /** Apply a human annotation and re-sync the view. */
  annotate(toolName: string, annotation: Annotation): ToolsMetadataDocument {
    this.memory.setAnnotation(annotation);
    return this.sync();
  }
}
