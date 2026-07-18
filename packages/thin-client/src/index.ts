/**
 * @adaptivemcp/thin-client
 *
 * A minimal client-side execution loop. It owns the *execution lifecycle* and
 * the *middleware hooks* (approval gate + retry), but delegates all learning to
 * the other packages. MCP transport and capability negotiation remain the job of
 * the official SDK; this package is the operational machinery that runs on the
 * client side.
 */
export { ThinClient } from "./loop.js";
export type { ThinClientOptions, ToolHandler } from "./loop.js";
