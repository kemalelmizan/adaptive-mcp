import { AdaptiveRuntime } from "../runtime.js";

/**
 * Shared helpers for the example scenarios.
 *
 * Each scenario focuses on a different slice of the Adaptive MCP packages while
 * reusing the same `AdaptiveRuntime` wiring:
 *
 *   tool call -> telemetry -> MemoryStore -> evaluation -> insights
 *                                                          -> ExtensionController -> YAML view
 */

export interface RunOptions {
  calls: number;
  failRate: number;
  durationBase: number;
  durationJitter?: number;
  model?: string;
  cost?: number;
}

/**
 * Simulate `calls` invocations of `toolName` against the runtime, with a
 * controllable failure rate and duration. This stands in for a real MCP tool
 * handler calling `runtime.observeCompleted(...)`.
 */
export function runTool(
  runtime: AdaptiveRuntime,
  toolName: string,
  serverName: string,
  opts: RunOptions,
): void {
  const jitter = opts.durationJitter ?? 200;
  for (let i = 0; i < opts.calls; i++) {
    const failed = Math.random() < opts.failRate;
    runtime.observeCompleted({
      toolName,
      serverName,
      durationMs: opts.durationBase + Math.floor(Math.random() * jitter),
      status: failed ? "failed" : "completed",
      model: opts.model ?? "gpt-5-mini",
      cost: { amount: opts.cost ?? 0.001 },
      error: failed ? { message: "simulated failure" } : undefined,
    });
  }
}

/** Print a section header. */
export function section(label: string): void {
  console.log(`\n================ ${label} ================`);
}
