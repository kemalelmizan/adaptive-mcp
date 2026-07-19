import type { MemoryStore } from "@adaptivemcp/memory";
import type { ToolRecord } from "@adaptivemcp/spec";

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
  memory: MemoryStore;
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
  private memory: MemoryStore;
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
      this.routeTool(record.toolName);
    }
  }

  /** Evaluate a single tool, writing `model` + `routing` recommendations. */
  routeTool(toolName: string): void {
    const record = this.memory.getTool(toolName);
    if (!record) return;
    if (record.stats.invocations < this.minInvocations) return;

    this.memory.clearRecommendations(toolName, "model");
    this.memory.clearRecommendations(toolName, "routing");

    const model = this.selectModel(record);
    if (model) {
      this.memory.addRecommendation({
        toolName,
        type: "model",
        payload: { model: model.id },
        rationale: `Cheapest model meeting observed latency (avg ${Math.round(
          record.stats.avgDurationMs ?? 0,
        )}ms) and failure rate (${record.stats.failureRate.toFixed(2)}).`,
        confidence: confidenceFor(record.stats.invocations),
        generatedAt: new Date().toISOString(),
      });
    }

    const budgetRec = this.checkBudget(record);
    if (budgetRec) {
      this.memory.addRecommendation(budgetRec);
    }
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
