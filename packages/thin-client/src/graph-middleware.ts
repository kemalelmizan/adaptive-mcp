import { AsyncLocalStorage } from "node:async_hooks";
import type { Store, ExecutionNode } from "@adaptivemcp/spec";
import type { Middleware, PlannedCall, CallResult } from "@adaptivemcp/middleware";

/** Store with graph methods enabled. */
interface GraphStore extends Store {
  recordExecutionNode(node: ExecutionNode): ExecutionNode;
  getExecutionNode(id: string): ExecutionNode | undefined;
  getNodesBySession(sessionId: string): ExecutionNode[];
  getNodesByWorkflow(workflowId: string): ExecutionNode[];
  getChildren(parentId: string): ExecutionNode[];
  getParent(childId: string): ExecutionNode | undefined;
  getRootNodes(sessionId: string): ExecutionNode[];
  getLeafNodes(sessionId: string): ExecutionNode[];
  updateChildrenIds(parentId: string, childrenIds: string[]): void;
}

/**
 * Per-async-chain graph context. Treated as immutable: every update replaces
 * it via `enterWith` rather than mutating fields in place, so concurrent call
 * chains (e.g. `Promise.all`) each see their own snapshot instead of racing on
 * shared instance state.
 */
interface GraphContext {
  stack: string[];
  rootNodeId?: string;
}

const EMPTY_CONTEXT: GraphContext = { stack: [] };

/** 32 lowercase hex chars from a UUID (its dashes stripped) — a valid W3C trace-id. */
function hex32(uuid: string): string {
  const hex = uuid.replace(/-/g, "");
  return /^0+$/.test(hex) ? hex32(crypto.randomUUID()) : hex; // W3C: all-zero trace-id is invalid
}

/** First 16 lowercase hex chars from a UUID (its dashes stripped) — a valid W3C span-id. */
function hex16(uuid: string): string {
  const hex = hex32(uuid).slice(0, 16);
  return /^0+$/.test(hex) ? hex16(crypto.randomUUID()) : hex; // W3C: all-zero span-id is invalid
}

/**
 * Formats a W3C `traceparent` header value (https://www.w3.org/TR/trace-context/):
 * `{version}-{trace-id}-{parent-id}-{flags}`. There's no live network transport
 * in this codebase to carry this over the wire yet (see `runInContext`'s
 * docstring) — this generates and threads valid trace context through the
 * *recorded graph* instead, deterministically derived from the UUIDs
 * `ExecutionNode.id`s already use, so any future real transport has
 * ready-to-attach values instead of needing a separate ID scheme.
 *
 * Takes already-computed `traceId`/`spanId` hex strings (rather than raw
 * UUIDs) so a caller that also records them separately in `metadata` can't
 * end up with a `traceparent` string that disagrees with those fields on the
 * rare occasion `hex32`/`hex16` regenerate for an all-zero collision.
 */
function formatTraceParent(traceId: string, spanId: string): string {
  return `00-${traceId}-${spanId}-01`;
}

/**
 * Middleware that automatically tracks execution graph context.
 *
 * This middleware:
 * 1. Generates a sessionId at workflow start (or uses incoming)
 * 2. Tracks parentId from call stack using AsyncLocalStorage, so concurrent
 *    call chains started via `Promise.all` don't corrupt each other's
 *    parent/child linkage the way a single shared stack would.
 * 3. Emits startChild/completeNode/failNode automatically
 * 4. Generates a W3C `traceparent` per node (see `getTraceParent`), recorded
 *    on `ExecutionNode.metadata` — there's no live MCP transport in this
 *    codebase to carry it over the wire yet, so this is a data-plane
 *    correlation primitive a future real transport can attach as a header.
 */
export class GraphTrackingMiddleware implements Middleware {
  name = "graph-tracking";
  private store: GraphStore;
  private sessionId: string;
  private workflowId?: string;
  private als = new AsyncLocalStorage<GraphContext>();

  constructor(store: Store, options: { sessionId?: string; workflowId?: string } = {}) {
    this.store = store as GraphStore;
    this.sessionId = options.sessionId ?? crypto.randomUUID();
    this.workflowId = options.workflowId;
  }

  /** The graph context for the currently running async call chain. */
  private getContext(): GraphContext {
    return this.als.getStore() ?? EMPTY_CONTEXT;
  }

  /**
   * Runs `fn` in an isolated fork of the current graph context.
   *
   * This is the actual concurrency boundary: `enterWith` alone is not enough,
   * because two sibling calls kicked off back-to-back (e.g. via
   * `Promise.all`) run synchronously up to their first await *before* either
   * has genuinely yielded to the event loop, so they still share one active
   * async resource at the moment `enterWith` would fire and corrupt each
   * other's context. `als.run()` ties the context to the async resources
   * created during `fn`'s execution instead, which is what actually isolates
   * concurrent chains. Callers (e.g. `ThinClient.run`) must wrap each
   * top-level call's full `beforeCall` -> execute -> `afterCall`/`onError`
   * sequence in one `runInContext` call for this to hold.
   */
  runInContext<T>(fn: () => Promise<T>): Promise<T> {
    return this.runScoped(this.getContext(), fn);
  }

  /**
   * Run `fn` with `context` as the graph context, then restore whatever context
   * the caller had. `enterWith` (used by `startChild`/`completeNode`) is *not*
   * scoped to `als.run`, so without this restore a sibling call in the same
   * parent scope (e.g. two calls inside one `runTurn`) would inherit the
   * finished call's node stack and nest under the wrong parent.
   */
  private async runScoped<T>(context: GraphContext, fn: () => Promise<T>): Promise<T> {
    const previous = this.getContext();
    try {
      return await this.als.run(context, fn);
    } finally {
      this.als.enterWith(previous);
    }
  }

  /** Get the current session ID. */
  getSessionId(): string {
    return this.sessionId;
  }

  /** Get the current workflow ID. */
  getWorkflowId(): string | undefined {
    return this.workflowId;
  }

  /** Get the current parent node ID (top of stack) for this async call chain. */
  getParentId(): string | undefined {
    const { stack } = this.getContext();
    return stack[stack.length - 1];
  }

  /** Get the root node ID for this async call chain. */
  getRootNodeId(): string | undefined {
    return this.getContext().rootNodeId;
  }

  /** Get the current node stack depth for this async call chain. */
  getDepth(): number {
    return this.getContext().stack.length;
  }

  /**
   * The W3C `traceparent` for the currently active node in this async call
   * chain, or `undefined` outside of a tracked call. See `formatTraceParent`.
   */
  getTraceParent(): string | undefined {
    const rootNodeId = this.getRootNodeId();
    const currentNodeId = this.getParentId();
    return rootNodeId && currentNodeId ? formatTraceParent(hex32(rootNodeId), hex16(currentNodeId)) : undefined;
  }

  /** Start a new workflow root node. */
  async startWorkflow(toolName: string, serverName?: string, model?: string): Promise<string> {
    const id = crypto.randomUUID();
    const traceId = hex32(id);
    const spanId = hex16(id);
    const node: ExecutionNode = {
      id,
      toolName,
      serverName,
      sessionId: this.sessionId,
      workflowId: this.workflowId,
      parentId: undefined,
      childrenIds: [],
      timestamp: new Date().toISOString(),
      status: "started",
      model,
      metadata: { traceId, spanId, traceparent: formatTraceParent(traceId, spanId) },
    };

    this.store.recordExecutionNode(node);
    this.als.enterWith({ stack: [node.id], rootNodeId: node.id });
    return node.id;
  }

  /**
   * Run `fn` inside one graph root, so every top-level call it makes becomes a
   * child of that root — a single DAG per `fn` (e.g. one agent turn with several
   * tool calls) instead of one disconnected root per call.
   *
   * The root is completed when `fn` resolves and failed when it rejects. Nested
   * calls still fork their own context (see `runInContext`), so siblings stay
   * isolated from each other while sharing this root as their parent.
   */
  async runTurn<T>(label: string, fn: () => Promise<T>): Promise<T> {
    const id = crypto.randomUUID();
    const traceId = hex32(id);
    const spanId = hex16(id);
    const node: ExecutionNode = {
      id,
      toolName: label,
      sessionId: this.sessionId,
      workflowId: this.workflowId,
      parentId: undefined,
      childrenIds: [],
      timestamp: new Date().toISOString(),
      status: "started",
      metadata: { traceId, spanId, traceparent: formatTraceParent(traceId, spanId) },
    };
    this.store.recordExecutionNode(node);

    const startedAt = Date.now();
    try {
      const result = await this.runScoped({ stack: [node.id], rootNodeId: node.id }, fn);
      await this.completeNode(node.id, { durationMs: Date.now() - startedAt });
      return result;
    } catch (error) {
      await this.failNode(node.id, { message: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  /** Start a child node (automatically links to parent). */
  async startChild(toolName: string, serverName?: string, model?: string): Promise<string> {
    const parentId = this.getParentId();
    if (!parentId) {
      throw new Error("No parent node - call startWorkflow first or ensure middleware is in the chain");
    }
    const rootNodeId = this.getRootNodeId() ?? parentId;
    const id = crypto.randomUUID();
    const traceId = hex32(rootNodeId);
    const spanId = hex16(id);
    const node: ExecutionNode = {
      id,
      toolName,
      serverName,
      sessionId: this.sessionId,
      workflowId: this.workflowId,
      parentId,
      childrenIds: [],
      timestamp: new Date().toISOString(),
      status: "started",
      model,
      metadata: {
        traceId,
        spanId,
        parentSpanId: hex16(parentId),
        traceparent: formatTraceParent(traceId, spanId),
      },
    };

    this.store.recordExecutionNode(node);

    // Update parent's children
    const parent = this.store.getExecutionNode(parentId);
    if (parent) {
      const updatedChildren = [...parent.childrenIds, node.id];
      this.store.updateChildrenIds(parentId, updatedChildren);
    }

    const current = this.getContext();
    this.als.enterWith({ ...current, stack: [...current.stack, node.id] });
    return node.id;
  }

  /** Complete the current node. */
  async completeNode(nodeId: string, result: { durationMs: number; output?: unknown; cost?: { amount: number; currency?: string } }): Promise<void> {
    const node = this.store.getExecutionNode(nodeId);
    if (!node) return;

    const updated: ExecutionNode = {
      ...node,
      durationMs: result.durationMs,
      output: result.output,
      cost: result.cost ? { amount: result.cost.amount, currency: result.cost.currency } : undefined,
      status: "completed",
    };
    
    this.store.recordExecutionNode(updated);
    this.popFromStack(nodeId);
  }

  /** Fail the current node. */
  async failNode(nodeId: string, error: { message: string; code?: string }): Promise<void> {
    const node = this.store.getExecutionNode(nodeId);
    if (!node) return;

    const updated: ExecutionNode = {
      ...node,
      error: { message: error.message, code: error.code },
      status: "failed",
    };
    
    this.store.recordExecutionNode(updated);
    this.popFromStack(nodeId);
  }

  /** Remove `nodeId` from this async call chain's stack, wherever it is. */
  private popFromStack(nodeId: string): void {
    const current = this.getContext();
    if (!current.stack.includes(nodeId)) return;
    this.als.enterWith({ ...current, stack: current.stack.filter((id) => id !== nodeId) });
  }

  /** Middleware hook: runs before each tool call. */
  async beforeCall(call: PlannedCall): Promise<void> {
    const { stack, rootNodeId } = this.getContext();
    // If this is the first call in the chain and we don't have a root yet,
    // start the workflow
    if (stack.length === 0 && !rootNodeId) {
      await this.startWorkflow(call.toolName, call.serverName);
    } else if (stack.length > 0) {
      // Start a child node
      await this.startChild(call.toolName, call.serverName);
    }
  }

  /** Middleware hook: runs after each tool call (success or failure). */
  async afterCall(result: CallResult, call: PlannedCall): Promise<void> {
    const nodeId = this.getParentId();
    if (!nodeId) return;

    if (result.ok) {
      await this.completeNode(nodeId, {
        durationMs: this.elapsedMs(nodeId),
        output: call.output,
      });
    } else {
      await this.failNode(nodeId, {
        message: result.error ?? "Unknown error",
      });
    }
  }

  /** Middleware hook: runs after a thrown execution error. */
  async onError(err: unknown): Promise<void> {
    const nodeId = this.getParentId();
    if (!nodeId) return;

    await this.failNode(nodeId, {
      message: err instanceof Error ? err.message : String(err),
    });
  }

  /** Wall-clock elapsed time since `nodeId` was started, from its recorded `timestamp`. */
  private elapsedMs(nodeId: string): number {
    const node = this.store.getExecutionNode(nodeId);
    if (!node) return 0;
    const started = Date.parse(node.timestamp);
    return Number.isNaN(started) ? 0 : Math.max(0, Date.now() - started);
  }
}

/**
 * Create a GraphTrackingMiddleware from a Store.
 * This is the recommended way to integrate graph tracking with the thin client.
 */
export function createGraphTrackingMiddleware(
  store: Store,
  options: { sessionId?: string; workflowId?: string } = {}
): GraphTrackingMiddleware {
  return new GraphTrackingMiddleware(store, options);
}