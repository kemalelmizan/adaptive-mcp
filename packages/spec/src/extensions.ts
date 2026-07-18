/**
 * Extension identifiers for Adaptive MCP.
 *
 * Adaptive MCP enriches existing MCP primitives through extensions rather than
 * introducing new protocol concepts. Each extension is addressed by a stable
 * identifier following the SEP-2133 convention: a reversed-domain vendor prefix
 * (`dev.adaptivemcp`) followed by the extension name. The derived YAML view is
 * exposed as an MCP resource under the `dev.adaptivemcp/tools-metadata` URI.
 */

export const EXTENSION_NAMESPACE = "dev.adaptivemcp/";

export const EXTENSIONS = {
  telemetry: "dev.adaptivemcp/telemetry",
  insights: "dev.adaptivemcp/insights",
  evaluation: "dev.adaptivemcp/evaluation",
  memory: "dev.adaptivemcp/memory",
  routing: "dev.adaptivemcp/routing",
  orchestration: "dev.adaptivemcp/orchestration",
  approval: "dev.adaptivemcp/approval",
  toolsMetadata: "dev.adaptivemcp/tools-metadata",
} as const;

export type ExtensionName = keyof typeof EXTENSIONS;

export function isExtensionIdentifier(value: string): boolean {
  return typeof value === "string" && value.startsWith(EXTENSION_NAMESPACE);
}

export function extensionIdentifier(name: ExtensionName): string {
  return EXTENSIONS[name];
}
