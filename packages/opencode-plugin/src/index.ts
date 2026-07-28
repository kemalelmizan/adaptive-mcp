/**
 * @adaptivemcp/opencode-plugin
 * 
 * OpenCode plugin for Adaptive MCP.
 * 
 * Maps OpenCode's hook system to Adaptive MCP's telemetry and middleware:
 * - OpenCode `tool.execute.before` → `TelemetryRecorder.start()` + `MiddlewareChain.runBefore()`
 * - OpenCode `tool.execute.after` → `TelemetryRecorder.complete()` + `MiddlewareChain.runAfter()`
 * - OpenCode `tool.execute.error` → `TelemetryRecorder.fail()` + `MiddlewareChain.runError()`
 * - OpenCode `session.*` hooks → session tracking for graph analysis
 * 
 * This is a thin adapter at the edge - no core package depends on it.
 */

import type { Store } from "@adaptivemcp/spec";
import { MemoryStore } from "@adaptivemcp/memory";
import { TelemetryRecorder, MemoryBackedTelemetryStore } from "@adaptivemcp/telemetry";
import { Evaluator } from "@adaptivemcp/evaluation";
import { ExtensionController } from "@adaptivemcp/extension";
import { Router } from "@adaptivemcp/routing";
import { Orchestrator } from "@adaptivemcp/orchestration";
import { ApprovalGate } from "@adaptivemcp/approval";
import { GraphAnalyzer } from "@adaptivemcp/graph-analysis";
import { ThinClient, GraphTrackingMiddleware } from "@adaptivemcp/thin-client";
import { MiddlewareChain } from "@adaptivemcp/middleware";
import type { OpencodePluginOptions } from "./types.js";

/**
 * OpenCode plugin for Adaptive MCP.
 * 
 * This plugin wires OpenCode's hook system into Adaptive MCP's telemetry,
 * evaluation, and middleware layers.
 */
export class OpencodePlugin {
  private memory: MemoryStore;
  private telemetry: TelemetryRecorder;
  private evaluator: Evaluator;
  private extension: ExtensionController;
  private router: Router;
  private orchestrator: Orchestrator;
  private approval: ApprovalGate;
  private graphAnalyzer: GraphAnalyzer;
  private thinClient: ThinClient;
  private middlewareChain: MiddlewareChain;
  private graphTracking?: GraphTrackingMiddleware;
  private oauthMiddleware?: any; // OAuthMiddleware from thin-client
  private currentSessionId?: string;
  private currentWorkflowId?: string;

  constructor(options: OpencodePluginOptions = {}) {
    // Initialize core Adaptive MCP components
    this.memory = new MemoryStore({ path: options.dbPath ?? ":memory:" });
    
    this.telemetry = new TelemetryRecorder({
      store: new MemoryBackedTelemetryStore(this.memory),
      memory: options.enableGraph ? this.memory : undefined,
    });

    this.evaluator = new Evaluator({ memory: this.memory });
    this.extension = new ExtensionController({
      memory: this.memory,
      yamlPath: options.yamlPath,
    });
    this.router = new Router({ memory: this.memory });
    this.orchestrator = new Orchestrator({ memory: this.memory });
    this.approval = new ApprovalGate({
      memory: this.memory,
      policy: options.approvalPolicy,
    });
    this.graphAnalyzer = new GraphAnalyzer(this.memory);

    // Set up middleware chain
    this.middlewareChain = new MiddlewareChain({ store: this.memory, toolName: "" });
    
    // Set up graph tracking if enabled
    if (options.enableGraph) {
      this.graphTracking = new GraphTrackingMiddleware(this.memory, {
        workflowId: options.workflowId,
      });
      this.middlewareChain.use(this.graphTracking);
    }

    // Set up OAuth middleware if configured
    if (options.oauthConfigs && Object.keys(options.oauthConfigs).length > 0) {
      const { OAuthMiddleware, createOAuthMiddleware } = require("@adaptivemcp/thin-client");
      this.oauthMiddleware = createOAuthMiddleware(
        options.oauthConfigs,
        options.oauthRequiredServers ?? []
      );
      this.middlewareChain.use(this.oauthMiddleware);
    }

    // Initialize thin client with all middleware
    this.thinClient = new ThinClient({
      memory: this.memory,
      gate: this.approval,
      middleware: [this.graphTracking, this.oauthMiddleware].filter(Boolean),
      graphTracking: this.graphTracking,
    });
  }

  /**
   * Get the underlying Adaptive Runtime components for advanced usage.
   */
  getRuntime() {
    return {
      memory: this.memory,
      telemetry: this.telemetry,
      evaluator: this.evaluator,
      extension: this.extension,
      router: this.router,
      orchestrator: this.orchestrator,
      approval: this.approval,
      graphAnalyzer: this.graphAnalyzer,
      thinClient: this.thinClient,
      middlewareChain: this.middlewareChain,
    };
  }

  /**
   * OpenCode hook: tool.execute.before
   * Called before a tool executes. Maps to telemetry start + middleware beforeCall.
   */
  async onToolExecuteBefore(params: {
    toolName: string;
    serverName?: string;
    input: unknown;
    sessionId?: string;
    workflowId?: string;
  }): Promise<void> {
    const { toolName, serverName, input, sessionId, workflowId } = params;
    
    // Update session/workflow tracking
    if (sessionId) this.currentSessionId = sessionId;
    if (workflowId) this.currentWorkflowId = workflowId;

    // Start graph tracking if enabled
    if (this.graphTracking) {
      if (!this.currentSessionId) {
        this.currentSessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      }
      if (!this.graphTracking.getDepth()) {
        await this.graphTracking.startWorkflow(toolName, serverName, this.currentWorkflowId);
      } else {
        await this.graphTracking.startChild(toolName, serverName);
      }
    }

    // Record telemetry start
    this.telemetry.start(
      { toolName, serverName, sessionId: this.currentSessionId },
      { input, workflowId: this.currentWorkflowId },
    );

    // Run middleware beforeCall hooks
    await this.middlewareChain.runBefore({
      toolName,
      serverName,
      input,
    });
  }

  /**
   * OpenCode hook: tool.execute.after
   * Called after a tool completes successfully. Maps to telemetry complete + middleware afterCall.
   */
  async onToolExecuteAfter(params: {
    toolName: string;
    serverName?: string;
    output: unknown;
    durationMs: number;
    cost?: number;
    sessionId?: string;
  }): Promise<void> {
    const { toolName, serverName, output, durationMs, cost, sessionId } = params;

    // Record telemetry completion
    this.telemetry.complete(
      { toolName, serverName, sessionId: sessionId ?? this.currentSessionId },
      { durationMs, output, cost: cost ? { amount: cost, currency: "USD" } : undefined },
      { workflowId: this.currentWorkflowId },
    );

    // Complete graph tracking
    if (this.graphTracking && this.graphTracking.getDepth() > 0) {
      const nodeId = this.graphTracking.getParentId();
      if (nodeId) {
        await this.graphTracking.completeNode(nodeId, { durationMs, output, cost: cost ? { amount: cost, currency: "USD" } : undefined });
      }
    }

    // Run middleware afterCall hooks
    await this.middlewareChain.runAfter(
      { ok: true },
      { toolName, serverName, input: {}, output } // input would be tracked separately
    );

    // Evaluate and sync
    this.evaluator.evaluateAll();
    this.router.routeAll();
    this.orchestrator.planAll();
    this.extension.sync();
  }

  /**
   * OpenCode hook: tool.execute.error
   * Called when a tool fails. Maps to telemetry fail + middleware onError.
   */
  async onToolExecuteError(params: {
    toolName: string;
    serverName?: string;
    error: Error;
    durationMs: number;
    sessionId?: string;
  }): Promise<void> {
    const { toolName, serverName, error, durationMs, sessionId } = params;

    // Record telemetry failure
    this.telemetry.fail(
      { toolName, serverName, sessionId: sessionId ?? this.currentSessionId },
      { message: error.message, code: (error as any).code },
      { workflowId: this.currentWorkflowId },
    );

    // Fail graph tracking
    if (this.graphTracking && this.graphTracking.getDepth() > 0) {
      const nodeId = this.graphTracking.getParentId();
      if (nodeId) {
        await this.graphTracking.failNode(nodeId, { message: error.message, code: (error as any).code });
      }
    }

    // Run middleware onError hooks
    await this.middlewareChain.runError(error, { toolName, serverName, input: {} });
  }

  /**
   * OpenCode hook: session.created
   * Called when a new session starts.
   */
  async onSessionCreated(params: { sessionId: string; workflowId?: string }): Promise<void> {
    this.currentSessionId = params.sessionId;
    this.currentWorkflowId = params.workflowId;
    
    if (this.graphTracking) {
      this.graphTracking = new GraphTrackingMiddleware(this.memory, {
        sessionId: params.sessionId,
        workflowId: params.workflowId,
      });
      this.middlewareChain.use(this.graphTracking);
    }
  }

  /**
   * OpenCode hook: session.idle
   * Called when session becomes idle.
   */
  async onSessionIdle(params: { sessionId: string }): Promise<void> {
    // Could trigger evaluation of session patterns
    if (this.currentSessionId === params.sessionId) {
      this.evaluator.evaluateWorkflow(params.sessionId);
    }
  }

  /**
   * OpenCode hook: session.compacted
   * Called when session history is compacted.
   */
  async onSessionCompacted(params: { sessionId: string }): Promise<void> {
    // Could trigger cleanup of old execution nodes
  }

  /**
   * OpenCode hook: session.deleted
   * Called when session is deleted.
   */
  async onSessionDeleted(params: { sessionId: string }): Promise<void> {
    if (this.currentSessionId === params.sessionId) {
      this.currentSessionId = undefined;
      this.currentWorkflowId = undefined;
      this.graphTracking = undefined;
    }
  }

  /**
   * Execute a tool through the full Adaptive MCP pipeline.
   * This is the main entry point for OpenCode to run tools.
   */
  async executeTool(params: {
    toolName: string;
    serverName?: string;
    input: unknown;
    sessionId?: string;
    workflowId?: string;
  }): Promise<{ ok: boolean; error?: string; output?: unknown }> {
    const { toolName, serverName, input, sessionId, workflowId } = params;

    if (sessionId) this.currentSessionId = sessionId;
    if (workflowId) this.currentWorkflowId = workflowId;

    let recordedError: string | undefined;
    const result = await this.thinClient.run(
      toolName,
      async (input) => {
        // This would be replaced with actual MCP tool call in real usage
        // For now, we simulate by calling the OpenCode tool directly
        throw new Error("Tool execution not implemented - use OpenCode's native tool runner");
      },
      input,
      (_ok, error) => {
        recordedError = error;
      },
      serverName
    );

    if (!result.executed) {
      return { ok: false, error: recordedError ?? `Blocked (${result.decision})` };
    }
    return { ok: true, output: result.output };
  }

  /**
   * Get the current tools-metadata YAML view.
   */
  getToolsMetadata(): string {
    return this.extension.resourceText();
  }

  /**
   * Get execution graph for a session (for visualization).
   */
  getExecutionGraph(sessionId: string): string {
    return this.extension.executionGraphMermaidResourceText(sessionId);
  }

  /**
   * Get workflow statistics.
   */
  getWorkflowStats(workflowId: string) {
    return this.graphAnalyzer.getWorkflowStats(workflowId);
  }

  /**
   * Shutdown the plugin and close resources.
   */
  async shutdown(): Promise<void> {
    this.memory.close();
  }
}

/**
 * Create an OpenCode plugin with default configuration.
 */
export function createOpencodePlugin(options: OpencodePluginOptions = {}): OpencodePlugin {
  return new OpencodePlugin(options);
}

export type { OpencodePluginOptions };