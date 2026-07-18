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

export interface AdaptiveRuntimeOptions {
  /** SQLite path for the SSOT. Defaults to an in-memory database. */
  dbPath?: string;
  /** Where the derived YAML view is written. */
  yamlPath?: string;
}

/**
 * Wires the Adaptive MCP packages into a single runtime:
 *
 *   tool call -> telemetry -> MemoryStore (SSOT) -> evaluation -> insights
 *                                                          -> routing      -> recommendations
 *                                                          -> orchestration-> recommendations
 *                                                          -> approval     -> gate + recommendation
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

  constructor(options: AdaptiveRuntimeOptions = {}) {
    this.memory = new MemoryStore({ path: options.dbPath ?? ":memory:" });
    this.telemetry = new TelemetryRecorder({
      store: new MemoryBackedTelemetryStore(this.memory),
    });
    this.evaluator = new Evaluator({ memory: this.memory });
    this.extension = new ExtensionController({
      memory: this.memory,
      yamlPath: options.yamlPath,
    });
    this.router = new Router({ memory: this.memory });
    this.orchestrator = new Orchestrator({ memory: this.memory });
    this.approval = new ApprovalGate({ memory: this.memory });
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

  /** Enforcement hook: decide whether a planned tool call may proceed. */
  gate(toolName: string): ApprovalDecision {
    return this.approval.gate(toolName);
  }

  close(): void {
    this.memory.close();
  }
}
