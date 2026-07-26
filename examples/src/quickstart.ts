/**
 * examples/src/quickstart.ts — the smallest end-to-end taste of Adaptive MCP.
 *
 * Run it with:  pnpm quickstart   (from the examples/ workspace)
 *
 * It wires the published pieces together, feeds a realistic day of tool usage
 * through the learning loop, and prints the derived `tools-metadata.yaml` view.
 * No server, no transport — just observe → evaluate → derive view.
 *
 * The point of the telemetry layer is that it learns from *real, varied*
 * signal. A loop that replays the same event 20 times teaches the evaluator
 * nothing — every call looks identical, so the failure rate is 0% and the
 * latency is a flat line. Below we simulate a believable production day:
 * several tools, latency jitter, a flaky deploy window, and a couple of
 * outright failures. That variance is what turns raw events into insights.
 */

import { MemoryStore } from "@adaptivemcp/memory";
import {
  TelemetryRecorder,
  MemoryBackedTelemetryStore,
} from "@adaptivemcp/telemetry";
import { Evaluator } from "@adaptivemcp/evaluation";
import { ExtensionController } from "@adaptivemcp/extension";

const memory = new MemoryStore(); // SQLite store (in-memory)
const telemetry = new TelemetryRecorder({
  store: new MemoryBackedTelemetryStore(memory),
});
const evaluator = new Evaluator({ memory });
const extension = new ExtensionController({ memory, yamlPath: "tools-metadata.yaml" });

// --- Tiny helpers to fake a realistic stream of tool executions ---------------

// Deterministic-ish jitter so the demo is reproducible but not a flat line.
let seed = 1337;
function rand(): number {
  // xorshift32 — small, fast, no deps
  seed ^= seed << 13;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  return ((seed >>> 0) % 1000) / 1000;
}
// A duration centered on `base` with ±`spread` ms of noise.
function jitter(base: number, spread: number): number {
  return Math.round(base + (rand() - 0.5) * 2 * spread);
}

// Simulate one tool call. `failRate` lets us model a "flaky" period where a
// tool starts erroring more often than usual — exactly the kind of behavior
// the evaluator is built to surface.
function runTool(opts: {
  toolName: string;
  serverName: string;
  model: string;
  baseMs: number;
  spreadMs: number;
  costPerCall: number;
  failRate?: number;
}): void {
  const failed = rand() < (opts.failRate ?? 0);
  const durationMs = jitter(opts.baseMs, opts.spreadMs);
  const cost = { amount: opts.costPerCall, currency: "USD" };

  if (failed) {
    // telemetry.fail records a failed execution; the evaluator folds this into
    // the tool's failure rate and (eventually) a flaky recommendation.
    telemetry.fail(
      { toolName: opts.toolName, serverName: opts.serverName, model: opts.model },
      { message: "upstream timeout", code: "ETIMEDOUT" },
      { durationMs, cost },
    );
  } else {
    telemetry.complete(
      { toolName: opts.toolName, serverName: opts.serverName, model: opts.model },
      { durationMs, cost },
    );
  }
}

// --- 1. Observe: a believable day across three tools -------------------------

// search_customer: cheap, fast, reliable. The kind of call you'd never worry about.
for (let i = 0; i < 40; i++) {
  runTool({
    toolName: "search_customer",
    serverName: "crm",
    model: "gpt-5-mini",
    baseMs: 120,
    spreadMs: 40,
    costPerCall: 0.0004,
  });
}

// generate_report: heavier, pricier, but steady.
for (let i = 0; i < 15; i++) {
  runTool({
    toolName: "generate_report",
    serverName: "analytics",
    model: "gpt-5",
    baseMs: 1800,
    spreadMs: 300,
    costPerCall: 0.012,
  });
}

// deploy_service: normally healthy...
for (let i = 0; i < 25; i++) {
  runTool({
    toolName: "deploy_service",
    serverName: "demo",
    model: "gpt-5-mini",
    baseMs: 900,
    spreadMs: 150,
    costPerCall: 0.002,
  });
}

// ...then a flaky deploy window: a bad release candidate spikes the failure
// rate. This is the interesting part — the evaluator should now flag
// deploy_service as flaky and the approval gate should ask for confirmation.
for (let i = 0; i < 15; i++) {
  runTool({
    toolName: "deploy_service",
    serverName: "demo",
    model: "gpt-5-mini",
    baseMs: 1100, // also slower than usual
    spreadMs: 400,
    costPerCall: 0.002,
    failRate: 0.4, // 40% of these deploys blow up
  });
}

// --- 2. Evaluate: fold the observations into insights in the store -----------
// evaluateAll reads every recorded event, recomputes stats (invocations,
// failures, avg duration, cost), and upserts insights like
// `observed_failure_rate` and `avg_duration_ms` keyed by tool.
evaluator.evaluateAll();

// --- 3. Derive: project the store into the YAML view -------------------------
// extension.sync recomputes tools-metadata.yaml from the store. The YAML is a
// pure projection — we never edit it by hand; it always reflects what was
// actually observed.
extension.sync();

console.log(extension.resourceText());
