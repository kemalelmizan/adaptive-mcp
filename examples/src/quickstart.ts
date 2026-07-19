/**
 * examples/src/quickstart.ts — the smallest end-to-end taste of Adaptive MCP.
 *
 * Run it with:  pnpm quickstart   (from the examples/ workspace)
 *
 * It wires the published pieces together, feeds a few tool executions through
 * the learning loop, and prints the derived `tools-metadata.yaml` view. No
 * server, no transport — just observe → evaluate → derive view.
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

// 1. Observe: record a handful of completed tool calls.
for (let i = 0; i < 20; i++) {
  telemetry.complete(
    { toolName: "deploy_service", serverName: "demo" },
    { durationMs: 900, cost: { amount: 0.002, currency: "USD" } },
  );
}

// 2. Evaluate: fold the observations into insights in the store.
evaluator.evaluateAll();

// 3. Derive: project the store into the YAML view (and the MCP resource text).
extension.sync();

console.log(extension.resourceText());
