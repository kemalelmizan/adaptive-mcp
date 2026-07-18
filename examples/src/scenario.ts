import { AdaptiveRuntime } from "./runtime.js";
import { runTool, section } from "./scenarios/shared.js";

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
 * scenario exercises the whole stack: telemetry -> memory (SSOT) -> evaluation
 * -> extension (YAML view).
 */
function main(): void {
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

  console.log("\nObservation: the YAML `insights.observed_failure_rate` and `stats`");
  console.log("track the regression and recovery automatically. The `annotation.risk`");
  console.log("field stays 'high' because it is the human's static view, not learned.");
  console.log("The `recommendations` list is populated from the SSOT, not the YAML.");
  runtime.close();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
