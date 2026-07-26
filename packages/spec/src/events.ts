import type { ToolExecutionEvent, ToolStatus } from "./types.js";

export const TOOL_EXECUTION_EVENT = "dev.adaptivemcp/telemetry/tool.execution" as const;

export interface ToolEventContext {
  toolName: string;
  serverName?: string;
  sessionId?: string;
  requestId?: string;
  model?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Construct a tool execution event with sensible defaults. Timestamps use the
 * ISO-8601 format; identifiers use a UUID v4 when not supplied.
 */
export function createToolEvent(
  ctx: ToolEventContext,
  status: ToolStatus,
  extra: Partial<ToolExecutionEvent> = {},
): ToolExecutionEvent {
  return {
    id: extra.id ?? crypto.randomUUID(),
    toolName: ctx.toolName,
    serverName: ctx.serverName,
    sessionId: ctx.sessionId,
    requestId: ctx.requestId,
    model: ctx.model,
    timestamp: extra.timestamp ?? new Date().toISOString(),
    status,
    ...extra,
  };
}
