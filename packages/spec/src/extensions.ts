/**
 * Identifiers for Adaptive MCP.
 *
 * MCP formalizes the server contract; the client side is loosely specified.
 * Adaptive MCP's learning machinery runs on the client, which MCP does not
 * govern. Therefore only ONE surface is proposed as a real MCP extension
 * (SEP-2133): the `tools-metadata` resource a server publishes so clients can
 * read learned tool metadata. See `docs/sep-2133-tools-metadata.md`.
 *
 * The remaining entries are internal, reversed-domain identifiers for the
 * client-side packages. They follow the SEP-2133 naming convention (reversed
 * domain `dev.adaptivemcp` owned by the author) but are NOT advertised as MCP
 * extensions — they are namespacing for in-process concepts, not protocol
 * extensions.
 */

export const EXTENSION_NAMESPACE = "dev.adaptivemcp/";

/** The single proposed MCP extension (SEP-2133): a server-published resource. */
export const TOOLS_METADATA_EXTENSION = "dev.adaptivemcp/tools-metadata";

/**
 * Internal reversed-domain identifiers for client-side packages. These are NOT
 * MCP extensions; they namespace in-process concepts to avoid collisions.
 */
export const PACKAGE_IDENTIFIERS = {
  telemetry: "dev.adaptivemcp/telemetry",
  insights: "dev.adaptivemcp/insights",
  evaluation: "dev.adaptivemcp/evaluation",
  memory: "dev.adaptivemcp/memory",
  routing: "dev.adaptivemcp/routing",
  orchestration: "dev.adaptivemcp/orchestration",
  approval: "dev.adaptivemcp/approval",
} as const;

export type PackageIdentifierName = keyof typeof PACKAGE_IDENTIFIERS;

export function isExtensionIdentifier(value: string): boolean {
  return typeof value === "string" && value.startsWith(EXTENSION_NAMESPACE);
}

export function packageIdentifier(name: PackageIdentifierName): string {
  return PACKAGE_IDENTIFIERS[name];
}
