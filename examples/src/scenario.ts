import { AdaptiveRuntime } from "@adaptivemcp/runtime";
import { runTool, section, seedRandom } from "./scenarios/shared.js";

/**
 * Scenario: improvement over time (the headline demo).
 *
 * We simulate a tool whose behavior changes across three phases and watch the
 * derived YAML metadata evolve — without anyone editing the YAML by hand.
 *
 *  Phase 1: deploy_service is reliable (failure rate ~2%).
 *  Phase 2: a regression makes it flaky (failure rate ~30%).
 *  Phase 3: a fix restores reliability, and a human annotates it as high-risk.
 *
 * After each phase we print the YAML view so the evolution is visible. This
 * scenario exercises the observe -> evaluate -> derive-view loop (telemetry ->
 * memory (store) -> evaluation -> extension (YAML view)). Routing,
 * orchestration, and approval are demonstrated separately in `scenario:adaptive`.
 */
function main(): void {
  seedRandom(20260719); // deterministic output so the narrative matches the print
  const runtime = new AdaptiveRuntime({ yamlPath: "tools-metadata.scenario.yaml" });

  // Human-written static annotation (the operator's view).
  runtime.extension.annotate("deploy_service", {
    toolName: "deploy_service",
    risk: "high",
    owner: "platform",
    tags: ["deploy", "prod"],
    description: "Deploys a service to production.",
  });

  section("Phase 1: healthy service");
  runTool(runtime, "deploy_service", "scenario-server", {
    calls: 40,
    failRate: 0.02,
    durationBase: 900,
    cost: 0.0021,
  });
  console.log(runtime.extension.resourceText());

  section("Phase 2: regression -> flaky");
  runTool(runtime, "deploy_service", "scenario-server", {
    calls: 40,
    failRate: 0.3,
    durationBase: 1400,
    cost: 0.0021,
  });
  console.log(runtime.extension.resourceText());

  section("Phase 3: fix applied");
  runTool(runtime, "deploy_service", "scenario-server", {
    calls: 40,
    failRate: 0.03,
    durationBase: 950,
    cost: 0.0021,
  });
  // A suggested adaptation, derived from the wired ApprovalGate (not hand-written).
  runtime.gate("deploy_service");
  runtime.extension.sync();
  console.log(runtime.extension.resourceText());

  console.log("\nObservation: the store is cumulative — the printed `stats` and");
  console.log("`insights.observed_failure_rate` are blended across all 120 calls, so the");
  console.log("final view shows the *net* failure rate after the fix, not the 30% spike");
  console.log("from Phase 2. The regression and recovery are visible as the rate climbs");
  console.log("then falls between phases. The `annotation.risk` field stays 'high' because");
  console.log("it is the human's static view, not learned. Recommendations are written by");
  console.log("the routing/orchestration/approval packages, not by the YAML view itself.");
  runtime.close();
}

if (import.meta.url === `file://${process.argv[1]}` || import.meta.url.endsWith(process.argv[1]?.replace(/\\/g, '/') ?? '')) {
  main();
}
