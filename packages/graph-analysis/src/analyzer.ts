import type { MemoryStore } from "@adaptivemcp/memory";
import type { ExecutionNode, CriticalPathResult, Bottleneck, FanOutReport, FailureCascade, CausalCascade, AntiPattern, CostBreakdown, WorkflowStats, WorkflowPattern, WorkflowForecast } from "@adaptivemcp/spec";

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
   * Detect two named structural anti-patterns — not general subgraph
   * isomorphism (NP-hard, unnecessary for these small execution DAGs):
   *
   *  - `sequential_bottleneck`: a sequential chain (from `getFanOutAnalysis`)
   *    whose own duration dominates the session's critical path.
   *  - `diamond_dependency`: a node with >=2 children whose descendant paths
   *    reconverge at a common node.
   */
  detectAntiPatterns(sessionId: string): AntiPattern[] {
    const nodes = this.fetchSessionNodes(sessionId);
    const patterns: AntiPattern[] = [];

    const { sequentialChains } = this.getFanOutAnalysis(sessionId);
    const { totalDurationMs: criticalPathMs } = this.getCriticalPath(sessionId);
    for (const chain of sequentialChains) {
      const chainDurationMs = chain.reduce((sum, n) => sum + (n.durationMs ?? 0), 0);
      const ratio = criticalPathMs > 0 ? chainDurationMs / criticalPathMs : 0;
      if (ratio > 0.5) {
        patterns.push({ type: "sequential_bottleneck", nodes: chain, severity: ratio });
      }
    }

    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    for (const apex of nodes) {
      if (apex.childrenIds.length < 2) continue;
      const join = this.findDiamondJoin(apex, nodeMap);
      if (join) {
        patterns.push({ type: "diamond_dependency", nodes: [apex, join], severity: apex.childrenIds.length });
      }
    }

    return patterns;
  }

  /**
   * BFS from each of `apex`'s children (depth-capped, these are small DAGs)
   * looking for the first node reachable from >=2 distinct children — the
   * point where the fan-out reconverges.
   */
  private findDiamondJoin(apex: ExecutionNode, nodeMap: Map<string, ExecutionNode>): ExecutionNode | undefined {
    const MAX_DEPTH = 20;
    const reachedByBranch = new Map<string, Set<number>>();

    apex.childrenIds.forEach((startId, branchIndex) => {
      const queue: Array<{ id: string; depth: number }> = [{ id: startId, depth: 0 }];
      const visited = new Set<string>();
      while (queue.length > 0) {
        const { id, depth } = queue.shift()!;
        if (visited.has(id) || depth > MAX_DEPTH) continue;
        visited.add(id);

        const branches = reachedByBranch.get(id) ?? new Set<number>();
        branches.add(branchIndex);
        reachedByBranch.set(id, branches);

        const node = nodeMap.get(id);
        if (!node) continue;
        for (const childId of node.childrenIds) {
          queue.push({ id: childId, depth: depth + 1 });
        }
      }
    });

    for (const [nodeId, branches] of reachedByBranch) {
      if (branches.size >= 2) return nodeMap.get(nodeId);
    }
    return undefined;
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
   * Ancestor-based causal ordering among a session's failed nodes: a failed
   * node is a root cause if none of its ancestors also failed; otherwise it's
   * a symptom of its nearest failed ancestor. `getFailureCascade` treats
   * every failed node as an independent root cause — this distinguishes
   * triggers from downstream fallout within one cascade.
   */
  getCausalCascade(sessionId: string): CausalCascade {
    const nodes = this.fetchSessionNodes(sessionId);
    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    const failedNodes = nodes.filter(n => n.status === "failed");
    const failedIds = new Set(failedNodes.map(n => n.id));

    const rootCauses: ExecutionNode[] = [];
    const symptoms: Array<{ node: ExecutionNode; causedBy: ExecutionNode }> = [];

    for (const failed of failedNodes) {
      let ancestorId = failed.parentId;
      let nearestFailedAncestor: ExecutionNode | undefined;
      while (ancestorId) {
        if (failedIds.has(ancestorId)) {
          nearestFailedAncestor = nodeMap.get(ancestorId);
          break;
        }
        ancestorId = nodeMap.get(ancestorId)?.parentId;
      }

      if (nearestFailedAncestor) {
        symptoms.push({ node: failed, causedBy: nearestFailedAncestor });
      } else {
        rootCauses.push(failed);
      }
    }

    const blastRadius = rootCauses.reduce((sum, rc) => sum + this.getDescendants(rc.id, nodes).length, 0);

    return { rootCauses, symptoms, blastRadius };
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
   * Heuristic forecast for an in-progress session, extrapolated from
   * historical runs of the same workflow — not a trained model, just a
   * ratio-vs-baseline projection (same spirit as `detectAnomalies`).
   */
  getWorkflowForecast(sessionId: string, workflowId: string): WorkflowForecast {
    const sessionNodes = this.fetchSessionNodes(sessionId);
    const workflowNodes = this.fetchWorkflowNodes(workflowId);

    // Historical baseline excludes the in-progress session itself, so it
    // doesn't skew its own forecast.
    const historicalSessions = new Map<string, ExecutionNode[]>();
    for (const n of workflowNodes) {
      if (n.sessionId === sessionId) continue;
      const arr = historicalSessions.get(n.sessionId) ?? [];
      arr.push(n);
      historicalSessions.set(n.sessionId, arr);
    }
    const historicalRuns = [...historicalSessions.values()];
    const avgNodeCount =
      historicalRuns.length > 0 ? historicalRuns.reduce((sum, run) => sum + run.length, 0) / historicalRuns.length : 0;
    const avgDurationMs =
      historicalRuns.length > 0
        ? historicalRuns.reduce((sum, run) => sum + (run.find(n => !n.parentId)?.durationMs ?? 0), 0) / historicalRuns.length
        : 0;
    const avgCost =
      historicalRuns.length > 0
        ? historicalRuns.reduce((sum, run) => sum + run.reduce((s, n) => s + (n.cost?.amount ?? 0), 0), 0) / historicalRuns.length
        : 0;
    const historicalFailureRate =
      historicalRuns.length > 0
        ? historicalRuns.filter(run => run.some(n => n.status === "failed")).length / historicalRuns.length
        : 0;

    const progressRatio = avgNodeCount > 0 ? Math.min(1, sessionNodes.length / avgNodeCount) : sessionNodes.length > 0 ? 1 : 0;
    const elapsedDurationMs = sessionNodes.reduce((sum, n) => sum + (n.durationMs ?? 0), 0);
    const elapsedCost = sessionNodes.reduce((sum, n) => sum + (n.cost?.amount ?? 0), 0);

    // Extrapolate proportionally to progress; once there's no historical
    // baseline or the session already covers it, fall back to what's observed.
    const projectedDurationMs =
      progressRatio > 0 && progressRatio < 1 ? elapsedDurationMs / progressRatio : Math.max(elapsedDurationMs, avgDurationMs);
    const projectedCost = progressRatio > 0 && progressRatio < 1 ? elapsedCost / progressRatio : Math.max(elapsedCost, avgCost);

    const failedSoFar = sessionNodes.filter(n => n.status === "failed").length;
    const observedFailureRatio = sessionNodes.length > 0 ? failedSoFar / sessionNodes.length : 0;
    // A failure already observed in this session makes the outcome certain.
    const failureProbability = failedSoFar > 0 ? 1 : (historicalFailureRate + observedFailureRatio) / 2;

    return { workflowId, progressRatio, projectedDurationMs, projectedCost, failureProbability };
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

    // Extract a tool sequence per session, keeping each sequence paired with
    // the session's own nodes (needed below to attribute duration/success to
    // the *right* session per pattern, not always the first one seen).
    const sequences: Array<{ sequence: string[]; sessionNodes: ExecutionNode[] }> = [];
    for (const [, sessionNodes] of sessions) {
      const root = sessionNodes.find(n => !n.parentId);
      if (root) {
        const sequence = this.getToolSequence(root, sessionNodes);
        sequences.push({ sequence, sessionNodes });
      }
    }

    // Count pattern frequencies
    const patternCounts = new Map<string, { count: number; durations: number[]; successes: number }>();

    for (const { sequence, sessionNodes } of sequences) {
      const key = sequence.join(" -> ");
      const existing = patternCounts.get(key) ?? { count: 0, durations: [], successes: 0 };
      existing.count++;
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