import type { ToolExecutionEvent } from "@adaptivemcp/spec";
import { TelemetryRecorder } from "@adaptivemcp/telemetry";
import type { Middleware, ToolCall, ToolExecutor, ToolResult } from "./middleware.js";

export interface AdaptiveClientOptions {
  executor: ToolExecutor;
  recorder?: TelemetryRecorder;
  middleware?: Middleware[];
  defaultContext?: Partial<ToolCall>;
}

/**
 * Thin client surface that wraps a tool executor with the Adaptive MCP
 * middleware pipeline. The client stays small: transport, capability
 * negotiation, middleware hooks, and execution lifecycle. Business logic lives
 * in middleware packages.
 */
export class AdaptiveClient {
  private executor: ToolExecutor;
  private recorder: TelemetryRecorder;
  private middleware: Middleware[];
  private defaultContext: Partial<ToolCall>;

  constructor(options: AdaptiveClientOptions) {
    this.executor = options.executor;
    this.recorder = options.recorder ?? new TelemetryRecorder();
    this.middleware = options.middleware ?? [];
    this.defaultContext = options.defaultContext ?? {};
  }

  async call(call: ToolCall): Promise<ToolResult> {
    const ctx = { ...this.defaultContext, ...call };
    const started = this.recorder.start(ctx);

    try {
      const result = await this.executor(ctx);
      const completed = this.recorder.complete(
        ctx,
        {
          durationMs: result.durationMs,
          output: result.output,
          cost: result.cost,
        },
        { id: started.id },
      );
      await this.dispatch(completed);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const failed = this.recorder.fail(ctx, { message }, { id: started.id });
      await this.dispatch(failed);
      throw err;
    }
  }

  private async dispatch(event: ToolExecutionEvent): Promise<void> {
    for (const m of this.middleware) {
      if (m.onEvent) {
        await m.onEvent(event);
      }
    }
  }

  getRecorder(): TelemetryRecorder {
    return this.recorder;
  }
}
