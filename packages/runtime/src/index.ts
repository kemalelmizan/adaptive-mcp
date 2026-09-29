import { MemoryStore } from "@adaptivemcp/memory";
import {
  TelemetryRecorder,
  MemoryBackedTelemetryStore,
} from "@adaptivemcp/telemetry";
import { Evaluator } from "@adaptivemcp/evaluation";
import { ExtensionController } from "@adaptivemcp/extension";
import { Router, type BudgetPolicy, type ModelOption } from "@adaptivemcp/routing";
import { Orchestrator } from "@adaptivemcp/orchestration";
import { ApprovalGate, type ApprovalDecision } from "@adaptivemcp/approval";
import { MiddlewareChain, type Middleware } from "@adaptivemcp/middleware";
import type { Store, ToolDecoding } from "@adaptivemcp/spec";

export interface AdaptiveRuntimeOptions {
  /**
   * The persistence backend. Defaults to an in-memory `MemoryStore`. Any object
   * implementing the `Store` interface from `@adaptivemcp/spec` is accepted, so
   * callers can swap in a file-backed or remote store without touching the loop.
   */
  store?: Store;
  /** SQLite path for the default store. Ignored when `store` is provided. */
  dbPath?: string;
  /** Where the derived YAML view is written. */
  yamlPath?: string;
  /** Middleware registered up-front (D2: explicit `use()`). */
  middleware?: Middleware[];
  /**
   * Enable execution graph tracking (`startWorkflow`/`startChild`/`completeNode`/`failNode`).
   * Only takes effect when the backing store is a `MemoryStore` — graph
   * persistence needs its concrete `execution_nodes` table, which arbitrary
   * `Store` implementations aren't required to provide. Without `enableGraph:
   * true` (or with a non-`MemoryStore` backing store), `startWorkflow`/
   * `startChild` throw (per `TelemetryRecorder`'s existing behavior) —
   * `completeNode`/`failNode` are no-ops instead.
   */
  enableGraph?: boolean;
  /**
   * Candidate models for the routing pass (`Router`). Defaults to the Router's
   * own two-model preset when omitted; hosts that own a model catalog should
   * pass their catalog's options so `model` recommendations use real,
   * selectable ids.
   */
  routerModels?: ModelOption[];
  /** Per-tool / per-server cost budgets forwarded to the `Router`. */
  routerBudget?: BudgetPolicy;
  /** Minimum invocations before the `Router` trusts observed stats. */
  routerMinInvocations?: number;
}

/**
 * Wires the Adaptive MCP packages into a single runtime:
 *
 *   tool call -> telemetry -> Store -> evaluation -> insights
 *                                                    -> routing      -> recommendations
 *                                                    -> orchestration-> recommendations
 *                                                    -> approval     -> gate + recommendation
 *                                                    -> ExtensionController -> YAML view
 *
 * This is the operational machinery; it is intentionally transport-agnostic.
 * The runtime owns the adaptation loop but not the MCP transport — pair it with
 * the official SDK (or the thin client) to execute tool calls.
 */
export class AdaptiveRuntime {
  readonly memory: Store;
  readonly telemetry: TelemetryRecorder;
  readonly evaluator: Evaluator;
  readonly extension: ExtensionController;
  readonly router: Router;
  readonly orchestrator: Orchestrator;
  readonly approval: ApprovalGate;
  readonly middleware: MiddlewareChain;

  constructor(options: AdaptiveRuntimeOptions = {}) {
    this.memory = options.store ?? new MemoryStore({ path: options.dbPath ?? ":memory:" });
    const graphMemory = options.enableGraph && this.memory instanceof MemoryStore ? this.memory : undefined;
    this.telemetry = new TelemetryRecorder({
      store: new MemoryBackedTelemetryStore(this.memory),
      memory: graphMemory,
    });
    this.evaluator = new Evaluator({ memory: this.memory });
    this.extension = new ExtensionController({
      memory: this.memory,
      yamlPath: options.yamlPath,
    });
    this.router = new Router({
      memory: this.memory,
      models: options.routerModels,
      budget: options.routerBudget,
      minInvocations: options.routerMinInvocations,
    });
    this.orchestrator = new Orchestrator({ memory: this.memory });
    this.approval = new ApprovalGate({ memory: this.memory });
    this.middleware = new MiddlewareChain({ store: this.memory, toolName: "" });
    for (const mw of options.middleware ?? []) {
      this.middleware.use(mw);
    }
  }

  /**
   * Register middleware (D2: explicit `use()` API). Returns `this` for chaining.
   */
  use(mw: Middleware): this {
    this.middleware.use(mw);
    return this;
  }

  /**
   * Record a completed tool call, then re-evaluate and re-sync the YAML view.
   *
   * This is the *minimal* observation step: event → MemoryStore → evaluation →
   * insights → YAML view. Routing, orchestration, and approval are intentionally
   * NOT run here — they are heavier, cross-tool passes that the caller invokes
   * explicitly (e.g. `runtime.router.routeAll()`) once enough signal has
   * accumulated. Keeping them out of the hot path also lets the "observe →
   * evaluate → derive view" loop be demonstrated on its own.
   */
  observeCompleted(input: {
    toolName: string;
    serverName?: string;
    durationMs: number;
    status: "completed" | "failed";
    model?: string;
    cost?: { amount: number; currency?: string };
    /** Total execution attempts (1 = no retry), from the thin client. */
    attempts?: number;
    /** The decoding applied to the completion that produced this call (ROADMAP 8d). */
    decoding?: ToolDecoding;
    /** Token usage for that completion, when the host knows it. */
    usage?: { inputTokens?: number; outputTokens?: number };
    error?: { message: string };
    /** The tool's output, if available. Carried into the event (D1). */
    output?: unknown;
  }): void {
    this.telemetry.complete(
      { toolName: input.toolName, serverName: input.serverName, model: input.model },
      {
        durationMs: input.durationMs,
        cost: input.cost ? { amount: input.cost.amount, currency: input.cost.currency } : undefined,
        output: input.output ?? (input.status === "completed" ? { ok: true } : undefined),
      },
      { status: input.status, error: input.error, decoding: input.decoding, usage: input.usage, attempts: input.attempts },
    );
    this.evaluator.evaluateAll();
    // Surface middleware contributions (D3: YAML `middleware` map).
    this.extension.setMiddlewareView(this.middleware.contributeView());
    this.extension.sync();
  }

  /** Start a new workflow root node (requires `enableGraph: true` with a `MemoryStore`; else a no-op node id). */
  startWorkflow(ctx: {
    toolName: string;
    serverName?: string;
    workflowId?: string;
    model?: string;
    /** Reuse an existing session instead of generating a fresh one (adds another root node to it). */
    sessionId?: string;
  }): {
    nodeId: string;
    sessionId: string;
  } {
    const node = this.telemetry.startWorkflow({
      toolName: ctx.toolName,
      serverName: ctx.serverName,
      workflowId: ctx.workflowId,
      model: ctx.model,
      sessionId: ctx.sessionId,
    });
    return { nodeId: node.id, sessionId: node.sessionId };
  }

  /** Start a child node in the workflow graph. */
  startChild(ctx: { toolName: string; serverName?: string; model?: string }, parentId: string): { nodeId: string } {
    const node = this.telemetry.startChild(
      { toolName: ctx.toolName, serverName: ctx.serverName, model: ctx.model },
      parentId,
    );
    return { nodeId: node.id };
  }

  /** Complete a node in the workflow graph. */
  completeNode(
    nodeId: string,
    result: { durationMs: number; output?: unknown; cost?: { amount: number; currency?: string } },
  ): void {
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
  gate(toolName: string, serverName?: string): ApprovalDecision {
    return this.approval.gate(toolName, serverName);
  }

  close(): void {
    this.memory.close();
  }
}

export type { Store } from "@adaptivemcp/spec";
export { MemoryStore } from "@adaptivemcp/memory";
