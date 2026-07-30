import type { ToolExecutionEvent, ExecutionNode } from "@adaptivemcp/spec";
import { createToolEvent, type ToolEventContext } from "@adaptivemcp/spec";
import type { TelemetryStore } from "./store.js";
import { InMemoryTelemetryStore } from "./store.js";
import { MemoryStore } from "@adaptivemcp/memory";

export interface TelemetryRecorderOptions {
  store?: TelemetryStore;
  defaultContext?: Partial<ToolEventContext>;
  /** MemoryStore for graph persistence (optional, enables graph tracking) */
  memory?: MemoryStore;
}

/**
 * Records tool execution events into a telemetry store. Provides a thin,
 * ergonomic surface for the SDK middleware to emit observations.
 */
export class TelemetryRecorder {
  private store: TelemetryStore;
  private defaultContext: Partial<ToolEventContext>;
  private memory?: MemoryStore;

  constructor(options: TelemetryRecorderOptions = {}) {
    this.store = options.store ?? new InMemoryTelemetryStore();
    this.defaultContext = options.defaultContext ?? {};
    this.memory = options.memory;
  }

  record(event: ToolExecutionEvent): void {
    this.store.record(event);
  }

  start(ctx: ToolEventContext, extra: Partial<ToolExecutionEvent> = {}): ToolExecutionEvent {
    const event = createToolEvent({ ...this.defaultContext, ...ctx }, "started", extra);
    this.store.record(event);
    return event;
  }

  complete(
    ctx: ToolEventContext,
    result: { durationMs?: number; output?: unknown; cost?: ToolExecutionEvent["cost"] },
    extra: Partial<ToolExecutionEvent> = {},
  ): ToolExecutionEvent {
    const event = createToolEvent(
      { ...this.defaultContext, ...ctx },
      "completed",
      { ...result, ...extra },
    );
    this.store.record(event);
    return event;
  }

  fail(
    ctx: ToolEventContext,
    error: { message: string; code?: string },
    extra: Partial<ToolExecutionEvent> = {},
  ): ToolExecutionEvent {
    const event = createToolEvent(
      { ...this.defaultContext, ...ctx },
      "failed",
      { error, ...extra },
    );
    this.store.record(event);
    return event;
  }

  /** Start a new workflow root node. */
  startWorkflow(ctx: ToolEventContext & { workflowId?: string }): ExecutionNode {
    if (!this.memory) {
      throw new Error("Graph tracking requires MemoryStore. Pass `memory` to TelemetryRecorder options.");
    }
    const sessionId = ctx.sessionId ?? crypto.randomUUID();
    const node: ExecutionNode = {
      id: crypto.randomUUID(),
      toolName: ctx.toolName,
      serverName: ctx.serverName,
      sessionId,
      workflowId: ctx.workflowId,
      parentId: undefined,
      childrenIds: [],
      timestamp: new Date().toISOString(),
      status: "started",
      model: ctx.model,
      metadata: ctx.metadata,
    };
    this.memory.recordExecutionNode(node);
    return node;
  }

  /** Start a child node (automatically links to parent). */
  startChild(ctx: ToolEventContext, parentId: string): ExecutionNode {
    if (!this.memory) {
      throw new Error("Graph tracking requires MemoryStore. Pass `memory` to TelemetryRecorder options.");
    }
    const parent = this.memory.getExecutionNode(parentId);
    if (!parent) {
      throw new Error(`Parent node ${parentId} not found`);
    }
    const node: ExecutionNode = {
      id: crypto.randomUUID(),
      toolName: ctx.toolName,
      serverName: ctx.serverName,
      sessionId: parent.sessionId,
      workflowId: parent.workflowId,
      parentId,
      childrenIds: [],
      timestamp: new Date().toISOString(),
      status: "started",
      model: ctx.model,
      metadata: ctx.metadata,
    };
    this.memory.recordExecutionNode(node);
    // Update parent's childrenIds
    const updatedChildren = [...parent.childrenIds, node.id];
    this.memory.updateChildrenIds(parentId, updatedChildren);
    return node;
  }

  /** Complete a node by ID. */
  completeNode(nodeId: string, result: { durationMs: number; output?: unknown; cost?: ToolExecutionEvent["cost"] }): ExecutionNode | undefined {
    if (!this.memory) return undefined;
    const node = this.memory.getExecutionNode(nodeId);
    if (!node) return undefined;
    const updated: ExecutionNode = {
      ...node,
      durationMs: result.durationMs,
      output: result.output,
      cost: result.cost,
      status: "completed",
    };
    this.memory.recordExecutionNode(updated);
    // Also record as a tool execution event for stats
    this.record({
      id: nodeId,
      toolName: node.toolName,
      serverName: node.serverName,
      sessionId: node.sessionId,
      workflowId: node.workflowId,
      parentId: node.parentId,
      timestamp: node.timestamp,
      durationMs: result.durationMs,
      status: "completed",
      output: result.output,
      cost: result.cost,
      model: node.model,
    });
    return updated;
  }

  /** Fail a node by ID. */
  failNode(nodeId: string, error: { message: string; code?: string }): ExecutionNode | undefined {
    if (!this.memory) return undefined;
    const node = this.memory.getExecutionNode(nodeId);
    if (!node) return undefined;
    const updated: ExecutionNode = {
      ...node,
      error: { message: error.message, code: error.code },
      status: "failed",
    };
    this.memory.recordExecutionNode(updated);
    // Also record as a tool execution event for stats
    this.record({
      id: nodeId,
      toolName: node.toolName,
      serverName: node.serverName,
      sessionId: node.sessionId,
      workflowId: node.workflowId,
      parentId: node.parentId,
      timestamp: node.timestamp,
      status: "failed",
      error: { message: error.message, code: error.code },
      model: node.model,
    });
    return updated;
  }

  getStore(): TelemetryStore {
    return this.store;
  }
}
