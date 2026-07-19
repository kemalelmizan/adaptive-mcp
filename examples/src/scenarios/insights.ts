import { AdaptiveRuntime } from "../runtime.js";
import { runTool, section } from "./shared.js";

/**
 * Scenario: telemetry -> evaluation -> insights.
 *
 * Highlights:
 *   - `@adaptivemcp/telemetry`: `TelemetryRecorder` + `MemoryBackedTelemetryStore`
 *     fold every execution event into the store.
 *   - `@adaptivemcp/evaluation`: `Evaluator` reads accumulated stats and writes
 *     derived `Insight`s (observed_failure_rate, avg_duration_ms) back into the
 *     store once a confidence threshold is met.
 *   - `@adaptivemcp/extension`: the YAML view surfaces those insights.
 *
 * We watch a tool go from healthy to flaky and see the learned insights appear
 * and strengthen as the sample size grows.
 */
function main(): void {
  const runtime = new AdaptiveRuntime({ yamlPath: "tools-metadata.insights.yaml" });

  section("Phase A: healthy tool (low failure rate)");
  runTool(runtime, "search_customer", "demo-server", {
    calls: 30,
    failRate: 0.0,
    durationBase: 30,
    durationJitter: 40,
    cost: 0.0003,
  });
  console.log(runtime.extension.resourceText());

  section("Phase B: regression -> flaky (failure rate climbs)");
  runTool(runtime, "search_customer", "demo-server", {
    calls: 70,
    failRate: 0.35,
    durationBase: 120,
    durationJitter: 200,
    cost: 0.0003,
  });
  console.log(runtime.extension.resourceText());

  console.log("\nObservation:");
  console.log("  - `insights.observed_failure_rate` appears only after minInvocations (10) are reached.");
  console.log("  - `confidence` rises with sample size (0.5 + n/200, capped at 0.95).");
  console.log("  - `annotation` stays empty because no human has annotated this tool yet.");

  runtime.close();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
