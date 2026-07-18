/**
 * Extension identifiers for Adaptive MCP.
 *
 * Adaptive MCP enriches existing MCP primitives through extensions rather than
 * introducing new protocol concepts. Each extension is addressed by a stable
 * identifier under the `adaptive://` namespace.
 */

export const EXTENSION_NAMESPACE = "adaptive://";

export const EXTENSIONS = {
  telemetry: "adaptive://telemetry",
  insights: "adaptive://insights",
  evaluation: "adaptive://evaluation",
  memory: "adaptive://memory",
  routing: "adaptive://routing",
  orchestration: "adaptive://orchestration",
  approval: "adaptive://approval",
  toolsMetadata: "adaptive://tools-metadata.yaml",
} as const;

export type ExtensionName = keyof typeof EXTENSIONS;

export function isExtensionIdentifier(value: string): boolean {
  return typeof value === "string" && value.startsWith(EXTENSION_NAMESPACE);
}

export function extensionIdentifier(name: ExtensionName): string {
  return EXTENSIONS[name];
}
