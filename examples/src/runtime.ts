import { MemoryStore } from "@adaptivemcp/memory";
import {
  TelemetryRecorder,
  MemoryBackedTelemetryStore,
} from "@adaptivemcp/telemetry";
import { Evaluator } from "@adaptivemcp/evaluation";
import { ExtensionController } from "@adaptivemcp/extension";
import { Router } from "@adaptivemcp/routing";
import { Orchestrator } from "@adaptivemcp/orchestration";
import { ApprovalGate, type ApprovalDecision } from "@adaptivemcp/approval";
import { GraphAnalyzer } from "@adaptivemcp/graph-analysis";

export interface AdaptiveRuntimeOptions {
  /** SQLite path for the SSOT. Defaults to an in-memory database. */
  dbPath?: string;
  /** Where the derived YAML view is written. */
  yamlPath?: string;
  /** Enable execution graph tracking. */
  enableGraph?: boolean;
}

/**
 * Wires the Adaptive MCP packages into a single runtime:
 *
 *   tool call -> telemetry -> MemoryStore (SSOT) -> evaluation -> insights
 *                                                          -> routing      -> recommendations
 *                                                          -> orchestration-> recommendations
 *                                                          -> approval     -> gate + recommendation
 *                                                          -> graph-analysis -> graph insights
 *                                                          -> ExtensionController -> YAML view
 *
 * This is the operational machinery; it is intentionally transport-agnostic.
 */
export class AdaptiveRuntime {
  readonly memory: MemoryStore;
  readonly telemetry: TelemetryRecorder;
  readonly evaluator: Evaluator;
  readonly extension: ExtensionController;
  readonly router: Router;
  readonly orchestrator: Orchestrator;
  readonly approval: ApprovalGate;
  readonly graphAnalyzer: GraphAnalyzer;

  constructor(options: AdaptiveRuntimeOptions = {}) {
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
    this.approval = new ApprovalGate({ memory: this.memory });
    this.graphAnalyzer = new GraphAnalyzer(this.memory);
  }

  /** Record a completed tool call, then re-evaluate and re-sync the YAML view. */
  observeCompleted(input: {
    toolName: string;
    serverName?: string;
    durationMs: number;
    status: "completed" | "failed";
    model?: string;
    cost?: { amount: number; currency?: string };
    error?: { message: string };
  }): void {
    this.telemetry.complete(
      { toolName: input.toolName, serverName: input.serverName, model: input.model },
      {
        durationMs: input.durationMs,
        cost: input.cost ? { amount: input.cost.amount, currency: input.cost.currency } : undefined,
        output: input.status === "completed" ? { ok: true } : undefined,
      },
      { status: input.status, error: input.error },
    );
    this.evaluator.evaluateAll();
    this.router.routeAll();
    this.orchestrator.planAll();
    this.extension.sync();
  }

  /** Start a new workflow root node (for graph tracking). */
  startWorkflow(ctx: { toolName: string; serverName?: string; workflowId?: string; model?: string }): { nodeId: string; sessionId: string } {
    const node = this.telemetry.startWorkflow({
      toolName: ctx.toolName,
      serverName: ctx.serverName,
      workflowId: ctx.workflowId,
      model: ctx.model,
    });
    return { nodeId: node.id, sessionId: node.sessionId };
  }

  /** Start a child node in the workflow graph. */
  startChild(ctx: { toolName: string; serverName?: string; model?: string }, parentId: string): { nodeId: string } {
    const node = this.telemetry.startChild({
      toolName: ctx.toolName,
      serverName: ctx.serverName,
      model: ctx.model,
    }, parentId);
    return { nodeId: node.id };
  }

  /** Complete a node in the workflow graph. */
  completeNode(nodeId: string, result: { durationMs: number; output?: unknown; cost?: { amount: number; currency?: string } }): void {
    this.telemetry.completeNode(nodeId, {
      durationMs: result.durationMs,
      output: result.output,
      cost: result.cost ? { amount: result.cost.amount, currency: result.cost.currency } : undefined,
    });
  }

  /** Fail a node in the workflow graph. */
  failNode(nodeId: string, error: { message: string; code?: string }): void {
    this.telemetry.failNode(nodeId, error);
  }

  /** Enforcement hook: decide whether a planned tool call may proceed. */
  gate(toolName: string): ApprovalDecision {
    return this.approval.gate(toolName);
  }

  /** Analyze the execution graph for a session. */
  analyzeGraph(sessionId: string) {
    return {
      criticalPath: this.graphAnalyzer.getCriticalPath(sessionId),
      bottlenecks: this.graphAnalyzer.getBottlenecks(sessionId),
      fanOut: this.graphAnalyzer.getFanOutAnalysis(sessionId),
      failureCascades: this.graphAnalyzer.getFailureCascade(sessionId),
      costBreakdown: this.graphAnalyzer.getCostBreakdown(sessionId),
      anomalies: this.graphAnalyzer.detectAnomalies(sessionId),
    };
  }

  /** Get workflow statistics. */
  getWorkflowStats(workflowId: string) {
    return this.graphAnalyzer.getWorkflowStats(workflowId);
  }

  close(): void {
    this.memory.close();
  }
}
