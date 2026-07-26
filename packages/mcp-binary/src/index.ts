/**
 * @adaptivemcp/mcp-binary
 *
 * The **only** sanctioned shell-out layer in Adaptive MCP (doubts.md §12b / D10).
 *
 * It wraps a CLI binary into an MCP stdio server, mapping the binary's CLI onto
 * MCP tools. Binaries like **rtk** (which has no native MCP server) become
 * chainable MCP servers this way, then attach to `@adaptivemcp/middleware` like
 * any other integration — instead of living at the host layer or shelling out
 * inside core. `RtkWrapper` is the reference binary config.
 */
export { BinaryMcpServer } from "./server.js";
export type { BinaryMcpServerOptions, BinaryToolSpec } from "./server.js";
export { createRtkWrapper, RTK_TOOLS, resolveRtkCommand } from "./rtk.js";
export type { RtkWrapperOptions, RtkResolution } from "./rtk.js";
