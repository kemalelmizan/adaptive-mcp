import { AsyncLocalStorage } from "node:async_hooks";
import type { Store, ExecutionNode } from "@adaptivemcp/spec";
import type { Middleware, MiddlewareContext, PlannedCall, CallResult } from "@adaptivemcp/middleware";

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

/**
 * Middleware that automatically tracks execution graph context.
 *
 * This middleware:
 * 1. Generates a sessionId at workflow start (or uses incoming)
 * 2. Tracks parentId from call stack using AsyncLocalStorage, so concurrent
 *    call chains started via `Promise.all` don't corrupt each other's
 *    parent/child linkage the way a single shared stack would.
 * 3. Emits startChild/completeNode/failNode automatically
 * 4. Propagates context via MCP requestId / custom headers
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
    return this.als.run(this.getContext(), fn);
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

  /** Start a new workflow root node. */
  async startWorkflow(toolName: string, serverName?: string, model?: string): Promise<string> {
    const node: ExecutionNode = {
      id: crypto.randomUUID(),
      toolName,
      serverName,
      sessionId: this.sessionId,
      workflowId: this.workflowId,
      parentId: undefined,
      childrenIds: [],
      timestamp: new Date().toISOString(),
      status: "started",
      metadata: {},
    };
    
    this.store.recordExecutionNode(node);
    this.als.enterWith({ stack: [node.id], rootNodeId: node.id });
    return node.id;
  }

  /** Start a child node (automatically links to parent). */
  async startChild(toolName: string, serverName?: string, model?: string): Promise<string> {
    const parentId = this.getParentId();
    if (!parentId) {
      throw new Error("No parent node - call startWorkflow first or ensure middleware is in the chain");
    }
    const node: ExecutionNode = {
      id: crypto.randomUUID(),
      toolName,
      serverName,
      sessionId: this.sessionId,
      workflowId: this.workflowId,
      parentId,
      childrenIds: [],
      timestamp: new Date().toISOString(),
      status: "started",
      metadata: {},
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
  async beforeCall(call: PlannedCall, ctx: MiddlewareContext): Promise<void> {
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
  async afterCall(result: CallResult, call: PlannedCall, ctx: MiddlewareContext): Promise<void> {
    const nodeId = this.getParentId();
    if (!nodeId) return;

    if (result.ok) {
      await this.completeNode(nodeId, {
        durationMs: 0, // Duration would be tracked by the caller
        output: call.output,
      });
    } else {
      await this.failNode(nodeId, {
        message: result.error ?? "Unknown error",
      });
    }
  }

  /** Middleware hook: runs after a thrown execution error. */
  async onError(err: unknown, call: PlannedCall, ctx: MiddlewareContext): Promise<void> {
    const nodeId = this.getParentId();
    if (!nodeId) return;

    await this.failNode(nodeId, {
      message: err instanceof Error ? err.message : String(err),
    });
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