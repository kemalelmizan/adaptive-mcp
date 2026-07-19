import { AdaptiveRuntime } from "@adaptivemcp/runtime";

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

// Small seeded PRNG (xorshift32) so scenario output is reproducible and the
// printed numbers match the narrative. Each runTool call advances the shared
// generator; pass `seed` to reset it for a deterministic run.
let seed = 0x9e3779b9;
export function seedRandom(value: number): void {
  seed = value >>> 0 || 1;
}
function rand(): number {
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return ((seed >>> 0) % 100000) / 100000;
}

/**
 * Simulate `calls` invocations of `toolName` against the runtime, with a
 * controllable failure rate and duration. This stands in for a real MCP tool
 * handler calling `runtime.observeCompleted(...)`. Uses a seeded PRNG so the
 * demo is reproducible.
 */
export function runTool(
  runtime: AdaptiveRuntime,
  toolName: string,
  serverName: string,
  opts: RunOptions,
): void {
  const jitter = opts.durationJitter ?? 200;
  for (let i = 0; i < opts.calls; i++) {
    const failed = rand() < opts.failRate;
    runtime.observeCompleted({
      toolName,
      serverName,
      durationMs: opts.durationBase + Math.floor(rand() * jitter),
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
