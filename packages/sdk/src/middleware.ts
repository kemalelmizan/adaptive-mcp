import type { ToolExecutionEvent } from "@adaptivemcp/spec";

/**
 * A middleware hook invoked around tool execution. Middleware exists to observe,
 * evaluate, remember, route, and recommend — never to own business logic.
 */
export interface Middleware {
  name: string;
  onEvent?(event: ToolExecutionEvent): void | Promise<void>;
}

export interface ToolCall {
  toolName: string;
  serverName?: string;
  sessionId?: string;
  requestId?: string;
  model?: string;
  input?: unknown;
}

export interface ToolResult {
  output?: unknown;
  error?: { message: string; code?: string };
  durationMs?: number;
  cost?: ToolExecutionEvent["cost"];
}

/**
 * The executor runs the actual tool call. In a real deployment this would
 * dispatch over the MCP protocol; here it is injected so the SDK stays
 * transport-agnostic.
 */
export type ToolExecutor = (call: ToolCall) => Promise<ToolResult>;
