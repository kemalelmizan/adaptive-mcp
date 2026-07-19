import { AdaptiveRuntime } from "../runtime.js";
import { runTool, section } from "./shared.js";

/**
 * Scenario: human annotation vs. learned insight.
 *
 * Highlights:
 *   - `@adaptivemcp/spec`: the `Annotation` type (risk/owner/tags/description) is
 *     the *static, human-written* layer.
 *   - `@adaptivemcp/extension`: `ExtensionController.annotate()` writes the
 *     annotation into the store and re-syncs the YAML view.
 *
 * The key teaching point: annotations and insights live side by side in the same
 * YAML view but come from different sources. Annotations never change on their
 * own; insights update automatically as behavior changes.
 */
function main(): void {
  const runtime = new AdaptiveRuntime({ yamlPath: "tools-metadata.annotation.yaml" });

  section("1. Operator annotates deploy_service as high-risk BEFORE any usage");
  runtime.extension.annotate("deploy_service", {
    toolName: "deploy_service",
    risk: "high",
    owner: "platform",
    tags: ["deploy", "prod"],
    description: "Deploys a service to production. Destructive: rolls forward.",
  });
  console.log(runtime.extension.resourceText());

  section("2. Tool runs reliably for a while");
  runTool(runtime, "deploy_service", "demo-server", {
    calls: 50,
    failRate: 0.02,
    durationBase: 900,
    cost: 0.0021,
  });
  console.log(runtime.extension.resourceText());

  section("3. A regression hits — insight diverges from the static annotation");
  runTool(runtime, "deploy_service", "demo-server", {
    calls: 50,
    failRate: 0.4,
    durationBase: 1500,
    cost: 0.0021,
  });
  console.log(runtime.extension.resourceText());

  console.log("\nObservation:");
  console.log("  - `annotation.risk` is still 'high' — the human's view did not change.");
  console.log("  - `insights.observed_failure_rate` now reflects the regression automatically.");
  console.log("  - This is the separation Adaptive MCP enforces: human intent vs. observed reality.");

  runtime.close();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
