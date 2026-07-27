import type { MemoryStore } from "@adaptivemcp/memory";
import type { ExecutionNode, CriticalPathResult, Bottleneck, FanOutReport, FailureCascade, CostBreakdown, WorkflowStats, WorkflowPattern } from "@adaptivemcp/spec";

/**
 * Analyzes execution graphs to derive insights about workflow performance,
 * bottlenecks, failure patterns, and costs.
 */
export class GraphAnalyzer {
  private memory: MemoryStore;

  constructor(memory: MemoryStore) {
    this.memory = memory;
  }

  /**
   * Fetch all nodes for a session. Extracted so `IncrementalGraphAnalyzer`
   * can override it with a cache without touching every call site.
   */
  protected fetchSessionNodes(sessionId: string): ExecutionNode[] {
    return this.memory.getNodesBySession(sessionId);
  }

  /**
   * Fetch all nodes for a workflow. Extracted so `IncrementalGraphAnalyzer`
   * can override it with a cache without touching every call site.
   */
  protected fetchWorkflowNodes(workflowId: string): ExecutionNode[] {
    return this.memory.getNodesByWorkflow(workflowId);
  }

  /**
   * Get the critical path (longest duration path) for a session.
   */
  getCriticalPath(sessionId: string): CriticalPathResult {
    const nodes = this.fetchSessionNodes(sessionId);
    if (nodes.length === 0) {
      return { path: [], totalDurationMs: 0 };
    }

    // Build adjacency list
    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    const childrenMap = new Map<string, string[]>();
    const parentMap = new Map<string, string | undefined>();

    for (const node of nodes) {
      childrenMap.set(node.id, node.childrenIds);
      parentMap.set(node.id, node.parentId);
    }

    // Find root nodes
    const roots = nodes.filter(n => !n.parentId);

    // DFS to find all paths and their durations
    let maxDuration = 0;
    let criticalPath: ExecutionNode[] = [];

    function dfs(nodeId: string, currentPath: ExecutionNode[], currentDuration: number) {
      const node = nodeMap.get(nodeId);
      if (!node) return;

      const newPath = [...currentPath, node];
      const nodeDuration = node.durationMs ?? 0;
      const newDuration = currentDuration + nodeDuration;

      const children = childrenMap.get(nodeId) ?? [];
      if (children.length === 0) {
        // Leaf node
        if (newDuration > maxDuration) {
          maxDuration = newDuration;
          criticalPath = newPath;
        }
      } else {
        for (const childId of children) {
          dfs(childId, newPath, newDuration);
        }
      }
    }

    for (const root of roots) {
      dfs(root.id, [], 0);
    }

    return { path: criticalPath, totalDurationMs: maxDuration };
  }

  /**
   * Get bottlenecks - nodes that most impact the critical path.
   */
  getBottlenecks(sessionId: string, topN = 5): Bottleneck[] {
    const { path } = this.getCriticalPath(sessionId);
    if (path.length === 0) return [];

    const bottlenecks: Bottleneck[] = [];

    for (const node of path) {
      let impactScore = 0;
      let reason: Bottleneck["reason"] = "duration";

      // Duration impact
      if (node.durationMs && node.durationMs > 1000) {
        impactScore += node.durationMs / 1000;
        reason = "duration";
      }

      // Fan-out impact (parallelization opportunity)
      if (node.childrenIds.length > 3) {
        impactScore += node.childrenIds.length * 100;
        reason = "fan_out";
      }

      // Failure rate impact
      const toolRecord = this.memory.getTool(node.toolName);
      if (toolRecord && toolRecord.stats.failureRate > 0.1) {
        impactScore += toolRecord.stats.failureRate * 1000;
        reason = "failure_rate";
      }

      // Cost impact
      if (node.cost && node.cost.amount && node.cost.amount > 0.01) {
        impactScore += node.cost.amount * 100;
        reason = "cost";
      }

      bottlenecks.push({
        node,
        impactScore,
        reason,
      });
    }

    return bottlenecks
      .sort((a, b) => b.impactScore - a.impactScore)
      .slice(0, topN);
  }

  /**
   * Analyze fan-out/fan-in patterns for parallelism opportunities.
   */
  getFanOutAnalysis(sessionId: string): FanOutReport {
    const nodes = this.fetchSessionNodes(sessionId);
    if (nodes.length === 0) {
      return { maxFanOut: 0, avgFanOut: 0, parallelizableNodes: [], sequentialChains: [] };
    }

    let maxFanOut = 0;
    let totalFanOut = 0;
    const parallelizableNodes: ExecutionNode[] = [];
    const sequentialChains: ExecutionNode[][] = [];

    for (const node of nodes) {
      const fanOut = node.childrenIds.length;
      totalFanOut += fanOut;
      maxFanOut = Math.max(maxFanOut, fanOut);

      if (fanOut > 1) {
        parallelizableNodes.push(node);
      }
    }

    // Find sequential chains (nodes with exactly 1 child, forming a line)
    const visited = new Set<string>();
    for (const node of nodes) {
      if (visited.has(node.id)) continue;
      if (node.childrenIds.length === 1 && !node.parentId) {
        // Potential chain start
        const chain: ExecutionNode[] = [node];
        visited.add(node.id);
        let current = node;
        while (current.childrenIds.length === 1) {
          const childId = current.childrenIds[0];
          if (!childId) break;
          const child = this.memory.getExecutionNode(childId);
          if (!child || visited.has(child.id)) break;
          chain.push(child);
          visited.add(child.id);
          current = child;
        }
        if (chain.length > 1) {
          sequentialChains.push(chain);
        }
      }
    }

    return {
      maxFanOut,
      avgFanOut: nodes.length > 0 ? totalFanOut / nodes.length : 0,
      parallelizableNodes,
      sequentialChains,
    };
  }

  /**
   * Analyze failure cascades - how failures propagate through the graph.
   */
  getFailureCascade(sessionId: string): FailureCascade[] {
    const nodes = this.fetchSessionNodes(sessionId);
    const failedNodes = nodes.filter(n => n.status === "failed");
    const cascades: FailureCascade[] = [];

    for (const failed of failedNodes) {
      // Find all descendants of this failed node
      const affected = this.getDescendants(failed.id, nodes);
      cascades.push({
        rootCause: failed,
        affectedNodes: affected,
        blastRadius: affected.length,
      });
    }

    return cascades.sort((a, b) => b.blastRadius - a.blastRadius);
  }

  /**
   * Get cost breakdown for a session.
   */
  getCostBreakdown(sessionId: string): CostBreakdown {
    const nodes = this.fetchSessionNodes(sessionId);
    const byTool: Record<string, number> = {};
    const byNode: Record<string, number> = {};
    let totalCost = 0;

    for (const node of nodes) {
      const cost = node.cost?.amount ?? 0;
      totalCost += cost;
      byNode[node.id] = cost;
      byTool[node.toolName] = (byTool[node.toolName] ?? 0) + cost;
    }

    // Critical path cost
    const { path } = this.getCriticalPath(sessionId);
    const criticalPathCost = path.reduce((sum, n) => sum + (n.cost?.amount ?? 0), 0);

    return {
      totalCost,
      byTool,
      byNode,
      criticalPathCost,
    };
  }

  /**
   * Get aggregated workflow statistics across all sessions.
   */
  getWorkflowStats(workflowId: string): WorkflowStats {
    const nodes = this.fetchWorkflowNodes(workflowId);
    if (nodes.length === 0) {
      return {
        workflowId,
        totalExecutions: 0,
        successRate: 0,
        avgDurationMs: 0,
        avgCost: 0,
        commonPatterns: [],
      };
    }

    // Group by session
    const sessions = new Map<string, ExecutionNode[]>();
    for (const node of nodes) {
      const sessionNodes = sessions.get(node.sessionId) ?? [];
      sessionNodes.push(node);
      sessions.set(node.sessionId, sessionNodes);
    }

    const sessionCount = sessions.size;
    let totalDuration = 0;
    let totalCost = 0;
    let successCount = 0;

    for (const [, sessionNodes] of sessions) {
      const root = sessionNodes.find(n => !n.parentId);
      if (root) {
        totalDuration += root.durationMs ?? 0;
        totalCost += sessionNodes.reduce((sum, n) => sum + (n.cost?.amount ?? 0), 0);
        const hasFailure = sessionNodes.some(n => n.status === "failed");
        if (!hasFailure) successCount++;
      }
    }

    return {
      workflowId,
      totalExecutions: sessionCount,
      successRate: sessionCount > 0 ? successCount / sessionCount : 0,
      avgDurationMs: sessionCount > 0 ? totalDuration / sessionCount : 0,
      avgCost: sessionCount > 0 ? totalCost / sessionCount : 0,
      commonPatterns: this.detectCommonPatterns(workflowId),
    };
  }

  /**
   * Detect common workflow patterns.
   */
  detectCommonPatterns(workflowId: string, minOccurrences = 3): WorkflowPattern[] {
    const nodes = this.fetchWorkflowNodes(workflowId);
    const sessions = new Map<string, ExecutionNode[]>();
    
    for (const node of nodes) {
      const sessionNodes = sessions.get(node.sessionId) ?? [];
      sessionNodes.push(node);
      sessions.set(node.sessionId, sessionNodes);
    }

    // Extract tool sequences for each session
    const sequences: string[][] = [];
    for (const [, sessionNodes] of sessions) {
      const root = sessionNodes.find(n => !n.parentId);
      if (root) {
        const sequence = this.getToolSequence(root, sessionNodes);
        sequences.push(sequence);
      }
    }

    // Count pattern frequencies
    const patternCounts = new Map<string, { count: number; durations: number[]; successes: number }>();
    
    for (const sequence of sequences) {
      const key = sequence.join(" -> ");
      const existing = patternCounts.get(key) ?? { count: 0, durations: [], successes: 0 };
      existing.count++;
      // Find root duration for this session
      const sessionNodes = sessions.get(nodes.find(n => n.sessionId === sessions.keys().next().value)?.sessionId ?? "") ?? [];
      const root = sessionNodes.find(n => !n.parentId);
      if (root?.durationMs) existing.durations.push(root.durationMs);
      const hasFailure = sessionNodes.some(n => n.status === "failed");
      if (!hasFailure) existing.successes++;
      patternCounts.set(key, existing);
    }

    const patterns: WorkflowPattern[] = [];
    for (const [pattern, data] of patternCounts) {
      if (data.count >= minOccurrences) {
        patterns.push({
          pattern,
          frequency: data.count / sequences.length,
          avgDurationMs: data.durations.length > 0 
            ? data.durations.reduce((a, b) => a + b, 0) / data.durations.length 
            : 0,
          successRate: data.count > 0 ? data.successes / data.count : 0,
        });
      }
    }

    return patterns.sort((a, b) => b.frequency - a.frequency);
  }

  /**
   * Detect anomalies in a session compared to historical patterns.
   */
  detectAnomalies(sessionId: string): Array<{ type: string; node: ExecutionNode; description: string }> {
    const nodes = this.fetchSessionNodes(sessionId);
    const anomalies: Array<{ type: string; node: ExecutionNode; description: string }> = [];

    for (const node of nodes) {
      const toolRecord = this.memory.getTool(node.toolName);
      if (!toolRecord || toolRecord.stats.invocations < 10) continue;

      // Duration anomaly
      if (node.durationMs && toolRecord.stats.avgDurationMs) {
        const ratio = node.durationMs / toolRecord.stats.avgDurationMs;
        if (ratio > 3) {
          anomalies.push({
            type: "duration_spike",
            node,
            description: `${node.toolName} took ${ratio.toFixed(1)}x longer than average (${node.durationMs}ms vs ${toolRecord.stats.avgDurationMs.toFixed(0)}ms)`,
          });
        }
      }

      // Cost anomaly
      if (node.cost?.amount && toolRecord.stats.totalCost > 0) {
        const avgCost = toolRecord.stats.totalCost / toolRecord.stats.invocations;
        const ratio = node.cost.amount / avgCost;
        if (ratio > 5) {
          anomalies.push({
            type: "cost_spike",
            node,
            description: `${node.toolName} cost ${ratio.toFixed(1)}x average ($${node.cost.amount.toFixed(4)} vs $${avgCost.toFixed(4)})`,
          });
        }
      }
    }

    return anomalies;
  }

  private getDescendants(nodeId: string, allNodes: ExecutionNode[]): ExecutionNode[] {
    const nodeMap = new Map(allNodes.map(n => [n.id, n]));
    const descendants: ExecutionNode[] = [];
    const queue = [nodeId];

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      const current = nodeMap.get(currentId);
      if (!current) continue;

      for (const childId of current.childrenIds) {
        const child = nodeMap.get(childId);
        if (child) {
          descendants.push(child);
          queue.push(childId);
        }
      }
    }

    return descendants;
  }

  private getToolSequence(root: ExecutionNode, allNodes: ExecutionNode[]): string[] {
    const nodeMap = new Map(allNodes.map(n => [n.id, n]));
    const sequence: string[] = [];
    const queue = [root];

    while (queue.length > 0) {
      const current = queue.shift()!;
      sequence.push(current.toolName);
      for (const childId of current.childrenIds) {
        const child = nodeMap.get(childId);
        if (child) queue.push(child);
      }
    }

    return sequence;
  }
}