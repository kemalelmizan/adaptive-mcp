import type { Insight, Store, ToolRecord, ExecutionNode } from "@adaptivemcp/spec";

export interface EvaluationOptions {
  memory: Store;
  /** Failure rate above which an insight is emitted. */
  failureRateThreshold?: number;
  /** Minimum invocations before evaluating. */
  minInvocations?: number;
}

/**
 * Turns accumulated telemetry into learned insights.
 *
 * This is the "evaluate -> remember" step of the adaptation loop: it reads the
 * store stats and writes derived Insights back into the MemoryStore.
 */
export class Evaluator {
  private memory: Store;
  private failureRateThreshold: number;
  private minInvocations: number;

  constructor(options: EvaluationOptions) {
    this.memory = options.memory;
    this.failureRateThreshold = options.failureRateThreshold ?? 0.1;
    this.minInvocations = options.minInvocations ?? 10;
  }

  /** Evaluate a single tool and persist any derived insights. */
  evaluateTool(toolName: string, serverName?: string): Insight[] {
    const record = this.memory.getTool(toolName, serverName);
    if (!record) return [];
    return this.evaluateRecord(record);
  }

  /** Evaluate every known tool. */
  evaluateAll(): Insight[] {
    return this.memory.allTools().flatMap((r) => this.evaluateRecord(r));
  }

  /** Evaluate a workflow session and persist workflow-level insights. */
  evaluateWorkflow(sessionId: string): Insight[] {
    // This requires the memory store to have graph methods
    // We'll check if the store has the graph methods
    const graphStore = this.memory as Store & {
      getNodesBySession?: (sessionId: string) => ExecutionNode[];
      getRootNodes?: (sessionId: string) => ExecutionNode[];
    };
    
    if (!graphStore.getNodesBySession || !graphStore.getRootNodes) {
      return []; // Graph tracking not enabled
    }

    const nodes = graphStore.getNodesBySession(sessionId);
    if (nodes.length === 0) return [];

    const insights: Insight[] = [];
    const now = new Date().toISOString();

    // Find root node
    const roots = graphStore.getRootNodes(sessionId);
    if (roots.length === 0) return [];

    const root = roots[0];
    if (!root) return [];
    const workflowId = root.workflowId ?? "unknown";

    // Calculate workflow-level stats
    const totalDuration = root.durationMs ?? 0;
    const totalCost = nodes.reduce((sum, n) => sum + (n.cost?.amount ?? 0), 0);
    const hasFailure = nodes.some(n => n.status === "failed");
    const failureCount = nodes.filter(n => n.status === "failed").length;

    // Workflow duration insight
    insights.push({
      toolName: workflowId,
      serverName: root?.serverName,
      key: "workflow_duration_ms",
      value: totalDuration,
      confidence: 0.8,
      source: "evaluation",
      observedAt: now,
      sampleSize: 1,
    });

    // Workflow cost insight
    insights.push({
      toolName: workflowId,
      serverName: root?.serverName,
      key: "workflow_cost",
      value: totalCost,
      confidence: 0.8,
      source: "evaluation",
      observedAt: now,
      sampleSize: 1,
    });

    // Workflow failure rate insight
    if (failureCount > 0) {
      insights.push({
        toolName: workflowId,
        serverName: root?.serverName,
        key: "workflow_failure_rate",
        value: failureCount / nodes.length,
        confidence: 0.8,
        source: "evaluation",
        observedAt: now,
        sampleSize: nodes.length,
      });
    }

    // Critical path insight (using graph analyzer would be better, but we can do basic)
    const criticalPath = this.findCriticalPath(nodes);
    if (criticalPath.length > 0) {
      let bottleneckTool: ExecutionNode | undefined = criticalPath[0];
      for (const node of criticalPath) {
        if ((node.durationMs ?? 0) > (bottleneckTool?.durationMs ?? 0)) {
          bottleneckTool = node;
        }
      }
      
      if (bottleneckTool && bottleneckTool.durationMs && bottleneckTool.durationMs > 1000) {
        insights.push({
          toolName: workflowId,
          serverName: root?.serverName,
          key: "critical_path_bottleneck",
          value: bottleneckTool.toolName,
          confidence: 0.7,
          source: "evaluation",
          observedAt: now,
          sampleSize: 1,
        });
      }
    }

    // Fan-out insight
    const maxFanOut = Math.max(...nodes.map(n => n.childrenIds.length));
    if (maxFanOut > 1) {
      insights.push({
        toolName: workflowId,
        serverName: root.serverName,
        key: "workflow_fan_out",
        value: maxFanOut,
        confidence: 0.7,
        source: "evaluation",
        observedAt: now,
        sampleSize: 1,
      });
    }

    // Persist all insights
    for (const insight of insights) {
      this.memory.addInsight(insight);
    }

    return insights;
  }

  /** Evaluate all workflows that have graph data. */
  evaluateAllWorkflows(): Insight[] {
    const graphStore = this.memory as Store & {
      getNodesBySession?: (sessionId: string) => ExecutionNode[];
    };
    
    if (!graphStore.getNodesBySession) {
      return [];
    }

    // Get all unique session IDs from execution nodes
    // This is a simplified approach - in practice we'd want a more efficient query
    const allTools = this.memory.allTools();
    const insights: Insight[] = [];
    
    // For now, we'll just evaluate tools that have workflow insights
    // A more complete implementation would query the execution_nodes table directly
    return insights;
  }

  private findCriticalPath(nodes: ExecutionNode[]): ExecutionNode[] {
    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    const roots = nodes.filter(n => !n.parentId);
    
    let maxDuration = 0;
    let criticalPath: ExecutionNode[] = [];

    function dfs(nodeId: string, currentPath: ExecutionNode[], currentDuration: number) {
      const node = nodeMap.get(nodeId);
      if (!node) return;

      const newPath = [...currentPath, node];
      const nodeDuration = node.durationMs ?? 0;
      const newDuration = currentDuration + nodeDuration;

      if (node.childrenIds.length === 0) {
        if (newDuration > maxDuration) {
          maxDuration = newDuration;
          criticalPath = newPath;
        }
      } else {
        for (const childId of node.childrenIds) {
          dfs(childId, newPath, newDuration);
        }
      }
    }

    for (const root of roots) {
      dfs(root.id, [], 0);
    }

    return criticalPath;
  }

  private evaluateRecord(record: ToolRecord): Insight[] {
    const { stats } = record;
    if (stats.invocations < this.minInvocations) return [];

    const insights: Insight[] = [];
    const now = new Date().toISOString();

    if (stats.failureRate >= this.failureRateThreshold) {
      insights.push({
        toolName: record.toolName,
        serverName: record.serverName,
        key: "observed_failure_rate",
        value: Number(stats.failureRate.toFixed(4)),
        confidence: confidenceFor(stats.invocations),
        source: "evaluation",
        observedAt: now,
        sampleSize: stats.invocations,
      });
    }

    if (stats.avgDurationMs != null) {
      insights.push({
        toolName: record.toolName,
        serverName: record.serverName,
        key: "avg_duration_ms",
        value: Math.round(stats.avgDurationMs),
        confidence: confidenceFor(stats.invocations),
        source: "telemetry",
        observedAt: now,
        sampleSize: stats.invocations,
      });
    }

    for (const insight of insights) {
      this.memory.addInsight(insight);
    }
    return insights;
  }
}

function confidenceFor(sampleSize: number): number {
  // Simple saturating confidence: reaches ~0.95 by 100 samples.
  return Number(Math.min(0.95, 0.5 + sampleSize / 200).toFixed(2));
}
