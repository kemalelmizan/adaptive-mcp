/**
 * @adaptivemcp/middleware
 *
 * Pluggable middleware for Adaptive MCP. Middleware attach to `AdaptiveRuntime`
 * or `ThinClient` via a `MiddlewareChain` and run hooks around each tool call:
 * `beforeCall` (gate / transform input / inject credentials), `afterCall`
 * (transform output / observe), `onError`, and `contributeView` (YAML fragment).
 *
 * The package also defines the transport-agnostic `Compressor` abstraction and a
 * headroom `afterCall` middleware that compresses tool output via a compressor
 * (typically MCP-client backed). Binaries like rtk are wrapped into MCP servers
 * by `@adaptivemcp/mcp-binary` and then chained like any other middleware — this
 * package never shells out itself.
 */
export type {
  Middleware,
  MiddlewareContext,
  PlannedCall,
  CallResult,
} from "./middleware.js";
export { MiddlewareChain } from "./chain.js";
export type { MiddlewareChainOptions } from "./chain.js";
export type {
  Compressor,
  CompressOptions,
  CompressResult,
  HeadroomCompressResult,
  McpCallClient,
} from "./compressor.js";
export { McpHeadroomCompressor } from "./compressor.js";
export { HeadroomMiddleware } from "./headroom.js";
export type { HeadroomMiddlewareOptions } from "./headroom.js";
