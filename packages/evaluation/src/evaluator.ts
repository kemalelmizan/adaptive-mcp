import type { Insight, Store, ToolRecord, ExecutionNode } from "@adaptivemcp/spec";
import { MemoryStore } from "@adaptivemcp/memory";
import { GraphAnalyzer } from "@adaptivemcp/graph-analysis";

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

  /**
   * Evaluate every workflow that has graph data: runs `evaluateWorkflow` for
   * each session, then aggregates *across* sessions of the same workflow
   * (the actual multi-session learning) by delegating to
   * `GraphAnalyzer.getWorkflowStats`, which already computes `commonPatterns`
   * across all of a workflow's sessions. This only activates when the store
   * is a real `MemoryStore` (graph tracking + graph-analysis both require it).
   */
  evaluateAllWorkflows(): Insight[] {
    const graphStore = this.memory as Store & {
      getWorkflowIds?: () => string[];
      getNodesByWorkflow?: (workflowId: string) => ExecutionNode[];
    };

    if (!graphStore.getWorkflowIds || !graphStore.getNodesByWorkflow) {
      return []; // Graph tracking not enabled
    }

    const insights: Insight[] = [];
    const workflowIds = graphStore.getWorkflowIds();

    for (const workflowId of workflowIds) {
      const nodes = graphStore.getNodesByWorkflow(workflowId);
      const sessionIds = [...new Set(nodes.map((n) => n.sessionId))];
      for (const sessionId of sessionIds) {
        insights.push(...this.evaluateWorkflow(sessionId));
      }
      insights.push(...this.evaluateWorkflowPatterns(workflowId));
    }

    return insights;
  }

  /**
   * Cross-session pattern learning for a workflow: delegates to
   * `GraphAnalyzer.getWorkflowStats`, which already aggregates
   * `commonPatterns` across every session of the workflow, and persists the
   * most frequent pattern as a workflow-level insight.
   */
  private evaluateWorkflowPatterns(workflowId: string): Insight[] {
    if (!(this.memory instanceof MemoryStore)) return [];

    const analyzer = new GraphAnalyzer(this.memory);
    const stats = analyzer.getWorkflowStats(workflowId);
    if (stats.commonPatterns.length === 0) return [];

    const topPattern = stats.commonPatterns[0]!;
    const insight: Insight = {
      toolName: workflowId,
      key: "workflow_common_pattern",
      value: topPattern,
      confidence: 0.7,
      source: "evaluation",
      observedAt: new Date().toISOString(),
      sampleSize: stats.totalExecutions,
    };
    this.memory.addInsight(insight);
    return [insight];
  }

  /** Detect repeated tool call sequences (repetition_detected insight) */
  private detectRepetition(nodes: ExecutionNode[]): Insight[] {
    const insights: Insight[] = [];
    const now = new Date().toISOString();
    
    // Build tool sequence from the graph (topological order)
    const sequence = this.getToolSequence(nodes);
    if (sequence.length < 4) return insights; // Need at least 4 tools for a pattern
    
    // Look for repeated subsequences of length 2-4
    for (let patternLen = 2; patternLen <= 4; patternLen++) {
      const patterns = new Map<string, { count: number; positions: number[] }>();
      
      for (let i = 0; i <= sequence.length - patternLen; i++) {
        const pattern = sequence.slice(i, i + patternLen).join(" -> ");
        const existing = patterns.get(pattern) ?? { count: 0, positions: [] };
        existing.count++;
        existing.positions.push(i);
        patterns.set(pattern, existing);
      }
      
      for (const [pattern, data] of patterns) {
        if (data.count >= 3) { // Repeated at least 3 times
          insights.push({
            toolName: "workflow",
            serverName: nodes[0]?.serverName,
            key: "repetition_detected",
            value: { pattern, count: data.count, length: patternLen },
            confidence: 0.7,
            source: "evaluation",
            observedAt: now,
            sampleSize: data.count,
          });
        }
      }
    }
    
    return insights;
  }

  /** Get tool sequence from graph nodes (topological order) */
  private getToolSequence(nodes: ExecutionNode[]): string[] {
    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    const roots = nodes.filter(n => !n.parentId);
    const sequence: string[] = [];
    const visited = new Set<string>();
    
    function dfs(nodeId: string) {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);
      
      const node = nodeMap.get(nodeId);
      if (!node) return;
      
      sequence.push(node.toolName);
      for (const childId of node.childrenIds) {
        dfs(childId);
      }
    }
    
    for (const root of roots) {
      dfs(root.id);
    }
    
    return sequence;
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

    // Cost drift detection
    if (stats.totalCost > 0 && stats.invocations >= this.minInvocations * 2) {
      const avgCost = stats.totalCost / stats.invocations;
      // Check if we have a previous cost baseline in insights
      const costInsight = record.insights.find(i => i.key === "avg_cost_per_invocation");
      if (costInsight && typeof costInsight.value === "number") {
        const drift = (avgCost - costInsight.value) / costInsight.value;
        if (Math.abs(drift) > 0.3) { // 30% drift threshold
          insights.push({
            toolName: record.toolName,
            serverName: record.serverName,
            key: "cost_drift",
            value: { drift: Number(drift.toFixed(4)), currentAvg: avgCost, baseline: costInsight.value },
            confidence: confidenceFor(stats.invocations),
            source: "evaluation",
            observedAt: new Date().toISOString(),
            sampleSize: stats.invocations,
          });
        }
      }
      // Update or create cost baseline
      insights.push({
        toolName: record.toolName,
        serverName: record.serverName,
        key: "avg_cost_per_invocation",
        value: avgCost,
        confidence: confidenceFor(stats.invocations),
        source: "telemetry",
        observedAt: new Date().toISOString(),
        sampleSize: stats.invocations,
      });
    }

    // Latency regression detection
    if (stats.avgDurationMs != null && stats.invocations >= this.minInvocations * 2) {
      const latencyInsight = record.insights.find(i => i.key === "avg_duration_ms_baseline");
      if (latencyInsight && typeof latencyInsight.value === "number") {
        const regression = (stats.avgDurationMs - latencyInsight.value) / latencyInsight.value;
        if (regression > 0.5) { // 50% regression threshold
          insights.push({
            toolName: record.toolName,
            serverName: record.serverName,
            key: "latency_regression",
            value: { regression: Number(regression.toFixed(4)), currentAvg: stats.avgDurationMs, baseline: latencyInsight.value },
            confidence: confidenceFor(stats.invocations),
            source: "evaluation",
            observedAt: new Date().toISOString(),
            sampleSize: stats.invocations,
          });
        }
      }
      // Update or create latency baseline
      insights.push({
        toolName: record.toolName,
        serverName: record.serverName,
        key: "avg_duration_ms_baseline",
        value: stats.avgDurationMs,
        confidence: confidenceFor(stats.invocations),
        source: "telemetry",
        observedAt: new Date().toISOString(),
        sampleSize: stats.invocations,
      });
    }

    // Approval friction tracking
    const approvalInsight = record.insights.find(i => i.key === "approval_friction");
    const approvalRec = record.recommendations.find(r => r.type === "approval");
    if (approvalRec && approvalRec.payload && typeof approvalRec.payload === "object" && "decision" in approvalRec.payload) {
      const decision = approvalRec.payload.decision as string;
      if (decision === "require_confirmation") {
        const frictionCount = (approvalInsight?.value as number) ?? 0;
        insights.push({
          toolName: record.toolName,
          serverName: record.serverName,
          key: "approval_friction",
          value: frictionCount + 1,
          confidence: 0.8,
          source: "evaluation",
          observedAt: new Date().toISOString(),
          sampleSize: 1,
        });
      }
    }

    // Context cost tracking (output tokens)
    if (stats.avgOutputTokens != null && stats.invocations >= this.minInvocations) {
      insights.push({
        toolName: record.toolName,
        serverName: record.serverName,
        key: "avg_output_tokens",
        value: Math.round(stats.avgOutputTokens),
        confidence: confidenceFor(stats.invocations),
        source: "telemetry",
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
        observedAt: new Date().toISOString(),
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
