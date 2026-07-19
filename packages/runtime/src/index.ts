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
import type { Store } from "@adaptivemcp/spec";

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

  constructor(options: AdaptiveRuntimeOptions = {}) {
    this.memory = options.store ?? new MemoryStore({ path: options.dbPath ?? ":memory:" });
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

export type { Store } from "@adaptivemcp/spec";
export { MemoryStore } from "@adaptivemcp/memory";
