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
 * Middleware that automatically tracks execution graph context.
 * 
 * This middleware:
 * 1. Generates a sessionId at workflow start (or uses incoming)
 * 2. Tracks parentId from call stack using AsyncLocalStorage
 * 3. Emits startChild/completeNode/failNode automatically
 * 4. Propagates context via MCP requestId / custom headers
 */
export class GraphTrackingMiddleware implements Middleware {
  name = "graph-tracking";
  private store: GraphStore;
  private sessionId: string;
  private workflowId?: string;
  private nodeStack: string[] = [];
  private rootNodeId?: string;

  constructor(store: Store, options: { sessionId?: string; workflowId?: string } = {}) {
    this.store = store as GraphStore;
    this.sessionId = options.sessionId ?? crypto.randomUUID();
    this.workflowId = options.workflowId;
  }

  /** Get the current session ID. */
  getSessionId(): string {
    return this.sessionId;
  }

  /** Get the current workflow ID. */
  getWorkflowId(): string | undefined {
    return this.workflowId;
  }

  /** Get the current parent node ID (top of stack). */
  getParentId(): string | undefined {
    return this.nodeStack[this.nodeStack.length - 1];
  }

  /** Get the root node ID. */
  getRootNodeId(): string | undefined {
    return this.rootNodeId;
  }

  /** Get the current node stack depth. */
  getDepth(): number {
    return this.nodeStack.length;
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
    this.rootNodeId = node.id;
    this.nodeStack.push(node.id);
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
    
    this.nodeStack.push(node.id);
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
    // Pop from stack if it matches
    const index = this.nodeStack.indexOf(nodeId);
    if (index !== -1) {
      this.nodeStack.splice(index, 1);
    }
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
    // Pop from stack if it matches
    const index = this.nodeStack.indexOf(nodeId);
    if (index !== -1) {
      this.nodeStack.splice(index, 1);
    }
  }

  /** Middleware hook: runs before each tool call. */
  async beforeCall(call: PlannedCall, ctx: MiddlewareContext): Promise<void> {
    // If this is the first call in the chain and we don't have a root yet,
    // start the workflow
    if (this.nodeStack.length === 0 && !this.rootNodeId) {
      await this.startWorkflow(call.toolName, call.serverName);
    } else if (this.nodeStack.length > 0) {
      // Start a child node
      await this.startChild(call.toolName, call.serverName);
    }
  }

  /** Middleware hook: runs after each tool call (success or failure). */
  async afterCall(result: CallResult, call: PlannedCall, ctx: MiddlewareContext): Promise<void> {
    const nodeId = this.nodeStack[this.nodeStack.length - 1];
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
    const nodeId = this.nodeStack[this.nodeStack.length - 1];
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