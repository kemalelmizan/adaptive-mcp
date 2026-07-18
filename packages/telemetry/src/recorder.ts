import type { ToolExecutionEvent } from "@adaptivemcp/spec";
import { createToolEvent, type ToolEventContext } from "@adaptivemcp/spec";
import type { TelemetryStore } from "./store.js";
import { InMemoryTelemetryStore } from "./store.js";

export interface TelemetryRecorderOptions {
  store?: TelemetryStore;
  defaultContext?: Partial<ToolEventContext>;
}

/**
 * Records tool execution events into a telemetry store. Provides a thin,
 * ergonomic surface for the SDK middleware to emit observations.
 */
export class TelemetryRecorder {
  private store: TelemetryStore;
  private defaultContext: Partial<ToolEventContext>;

  constructor(options: TelemetryRecorderOptions = {}) {
    this.store = options.store ?? new InMemoryTelemetryStore();
    this.defaultContext = options.defaultContext ?? {};
  }

  record(event: ToolExecutionEvent): void {
    this.store.record(event);
  }

  start(ctx: ToolEventContext, extra: Partial<ToolExecutionEvent> = {}): ToolExecutionEvent {
    const event = createToolEvent({ ...this.defaultContext, ...ctx }, "started", extra);
    this.store.record(event);
    return event;
  }

  complete(
    ctx: ToolEventContext,
    result: { durationMs?: number; output?: unknown; cost?: ToolExecutionEvent["cost"] },
    extra: Partial<ToolExecutionEvent> = {},
  ): ToolExecutionEvent {
    const event = createToolEvent(
      { ...this.defaultContext, ...ctx },
      "completed",
      { ...result, ...extra },
    );
    this.store.record(event);
    return event;
  }

  fail(
    ctx: ToolEventContext,
    error: { message: string; code?: string },
    extra: Partial<ToolExecutionEvent> = {},
  ): ToolExecutionEvent {
    const event = createToolEvent(
      { ...this.defaultContext, ...ctx },
      "failed",
      { error, ...extra },
    );
    this.store.record(event);
    return event;
  }

  getStore(): TelemetryStore {
    return this.store;
  }
}
