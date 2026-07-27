import type { Store, ToolRecord } from "@adaptivemcp/spec";
import type { GraphAnalyzer } from "@adaptivemcp/graph-analysis";

export type WorkflowPosition = "critical_path" | "leaf" | "normal";

export interface NodeRouting {
  nodeId: string;
  toolName: string;
  position: WorkflowPosition;
  recommendedModel: ModelOption;
  rationale: string;
}

export interface ModelOption {
  id: string;
  /** Relative cost weight per call (1 = baseline). */
  costWeight: number;
  /** Relative latency weight per call (1 = baseline). */
  latencyWeight: number;
}

export interface BudgetPolicy {
  /** Soft budget per tool, in the same currency unit as recorded cost. */
  perToolLimit?: number;
  /** Soft budget per server. */
  perServerLimit?: number;
}

export interface RoutingOptions {
  memory: Store;
  /** Candidate models, cheapest first by default. */
  models?: ModelOption[];
  /** Per-tool / per-server cost budgets. */
  budget?: BudgetPolicy;
  /** Minimum invocations before routing trusts observed stats. */
  minInvocations?: number;
}

/**
 * Turns observed stats + insights into concrete routing decisions:
 *
 *  - model selection: pick the cheapest model that still meets the observed
 *    latency/failure profile of the tool;
 *  - budget guardrails: warn (as a recommendation) when a tool or server is
 *    approaching or over its cost budget.
 *
 * Both outcomes are written into the store as `recommendation` entries of type
 * `model` and `routing` respectively, so the YAML view surfaces them.
 */
export class Router {
  private memory: Store;
  private models: ModelOption[];
  private budget: BudgetPolicy;
  private minInvocations: number;

  constructor(options: RoutingOptions) {
    this.memory = options.memory;
    this.models = options.models ?? [
      { id: "gpt-5-mini", costWeight: 1, latencyWeight: 1 },
      { id: "gpt-5", costWeight: 4, latencyWeight: 0.6 },
    ];
    this.budget = options.budget ?? {};
    this.minInvocations = options.minInvocations ?? 10;
  }

  /** Evaluate every known tool and persist routing recommendations. */
  routeAll(): void {
    for (const record of this.memory.allTools()) {
      this.routeTool(record.toolName, record.serverName);
    }
  }

  /** Evaluate a single tool, writing `model` + `routing` recommendations. */
  routeTool(toolName: string, serverName?: string): void {
    const record = this.memory.getTool(toolName, serverName);
    if (!record) return;
    if (record.stats.invocations < this.minInvocations) return;

    this.memory.clearRecommendations(toolName, "model", serverName);
    this.memory.clearRecommendations(toolName, "routing", serverName);

    const model = this.selectModel(record);
    if (model) {
      const avg = Math.round(record.stats.avgDurationMs ?? 0);
      const rationale =
        avg >= 500
          ? `Lowest-latency model for slow tool (avg ${avg}ms, failure rate ${record.stats.failureRate.toFixed(2)}); trades cost for speed.`
          : `Cheapest model for fast tool (avg ${avg}ms, failure rate ${record.stats.failureRate.toFixed(2)}).`;
      this.memory.addRecommendation({
        toolName,
        serverName,
        type: "model",
        payload: { model: model.id },
        rationale,
        confidence: confidenceFor(record.stats.invocations),
        generatedAt: new Date().toISOString(),
      });
    }

    const budgetRec = this.checkBudget(record);
    if (budgetRec) {
      this.memory.addRecommendation(budgetRec);
    }
  }

  /**
   * Route by a node's position in a *specific* execution's graph — critical
   * path nodes get the lowest-latency model, leaves get the cheapest,
   * everything else keeps the current default (cheapest available) model.
   * This is deliberately a pure, computed-on-read result (like
   * `GraphAnalyzer` itself), never persisted via `addRecommendation`:
   * workflow position is per-session, but the `Recommendation` store is
   * keyed per-tool, so persisting it would either need a schema change or
   * produce misleading facts that don't generalize across the same tool's
   * other sessions.
   */
  routeByPosition(sessionId: string, analyzer: GraphAnalyzer): NodeRouting[] {
    const sessionNodes = this.memory.getNodesBySession?.(sessionId) ?? [];
    if (sessionNodes.length === 0) return [];

    const criticalPathIds = new Set(analyzer.getCriticalPath(sessionId).path.map((n) => n.id));
    const cheapest = [...this.models].sort((a, b) => a.costWeight - b.costWeight)[0];
    const lowestLatency = [...this.models].sort((a, b) => a.latencyWeight - b.latencyWeight)[0];

    return sessionNodes.map((node) => {
      const isLeaf = node.childrenIds.length === 0;
      const position: WorkflowPosition = criticalPathIds.has(node.id) ? "critical_path" : isLeaf ? "leaf" : "normal";
      const recommendedModel = (position === "critical_path" ? lowestLatency ?? cheapest : cheapest ?? lowestLatency) as ModelOption;
      const rationale =
        position === "critical_path"
          ? `On the critical path for this run; lowest-latency model to avoid compounding the end-to-end delay.`
          : position === "leaf"
            ? `Leaf node for this run; cheapest model since it doesn't block downstream work.`
            : `Not on the critical path or a leaf for this run; default model.`;
      return {
        nodeId: node.id,
        toolName: node.toolName,
        position,
        recommendedModel,
        rationale,
      };
    });
  }

  /** Choose the cheapest model whose latency weight is acceptable for the tool. */
  private selectModel(record: ToolRecord): ModelOption | undefined {
    const avg = record.stats.avgDurationMs ?? 0;
    // Fast tools (<500ms) can use the cheapest model; slower tools may need a
    // more capable (lower-latency) one. This is a simple, explainable heuristic.
    const allowExpensive = avg >= 500;
    const candidates = this.models.filter((m) => allowExpensive || m.costWeight <= 1);
    candidates.sort((a, b) =>
      allowExpensive ? a.latencyWeight - b.latencyWeight : a.costWeight - b.costWeight,
    );
    return candidates[0];
  }

  /** Emit a budget warning recommendation when a limit is approached/exceeded. */
  private checkBudget(record: ToolRecord): ToolRecord["recommendations"][number] | undefined {
    const limit = this.budget.perToolLimit;
    if (limit == null) return undefined;
    const spent = record.stats.totalCost;
    if (spent < limit * 0.8) return undefined;
    const over = spent >= limit;
    return {
      toolName: record.toolName,
      serverName: record.serverName,
      type: "routing",
      payload: {
        perToolLimit: limit,
        spent: Number(spent.toFixed(4)),
        status: over ? "over_budget" : "approaching_budget",
      },
      rationale: over
        ? `Tool has spent ${spent.toFixed(2)} (limit ${limit}). Consider throttling.`
        : `Tool is at ${(spent / limit).toFixed(0)}% of its cost budget.`,
      confidence: confidenceFor(record.stats.invocations),
      generatedAt: new Date().toISOString(),
    };
  }
}

function confidenceFor(sampleSize: number): number {
  return Number(Math.min(0.95, 0.5 + sampleSize / 200).toFixed(2));
}
