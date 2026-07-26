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
export { MiddlewareChain } from "@adaptivemcp/middleware";
export type { Middleware, MiddlewareContext, PlannedCall, CallResult } from "@adaptivemcp/middleware";
export { GraphTrackingMiddleware, createGraphTrackingMiddleware } from "./graph-middleware.js";
export type { } from "./graph-middleware.js";
export { OAuthMiddleware, InMemoryOAuthTokenStore, createOAuthMiddleware } from "./oauth-middleware.js";
export type { OAuthClientConfig, OAuthToken, OAuthTokenStore } from "./oauth-middleware.js";
