import { AdaptiveRuntime } from "../runtime.js";
import { ThinClient } from "@adaptivemcp/thin-client";
import { runTool, section } from "./shared.js";

/**
 * Scenario: adaptive behavior across the full stack.
 *
 * Demonstrates the four planned packages wired into the runtime:
 *   - routing:        model selection + budget warnings
 *   - orchestration:  retry policy for flaky tools
 *   - approval:       enforcement gate for high-risk tools
 *   - thin-client:    client-side loop that consults the gate + retry policy
 *
 * The YAML view (dev.adaptivemcp/tools-metadata) reflects all recommendations.
 */
async function main(): Promise<void> {
  const runtime = new AdaptiveRuntime({ yamlPath: "examples/yaml/adaptive.yaml" });

  // Two tools: a cheap read-only search, and a destructive deploy.
  runtime.memory.ensureTool("search_customer", "crm");
  runtime.memory.ensureTool("deploy_service", "platform");

  section("Phase 1: baseline traffic");
  runTool(runtime, "search_customer", "crm", {
    calls: 40,
    failRate: 0.0,
    durationBase: 120,
    cost: 0.0003,
  });
  runTool(runtime, "deploy_service", "platform", {
    calls: 40,
    failRate: 0.15,
    durationBase: 400,
    cost: 0.0021,
  });

  section("Routing recommendations (model + budget)");
  runtime.router.routeTool("search_customer");
  runtime.router.routeTool("deploy_service");
  console.log(runtime.memory.getTool("search_customer")?.recommendations);
  console.log(runtime.memory.getTool("deploy_service")?.recommendations);

  section("Orchestration recommendation (retry policy)");
  runtime.orchestrator.planTool("deploy_service");
  console.log(runtime.memory.getTool("deploy_service")?.recommendations);

  section("Approval gate (enforcement hook)");
  // Before annotation: deploy_service is allowed (low observed failure rate).
  console.log("deploy_service gate:", runtime.gate("deploy_service"));
  // Human annotates deploy_service as high-risk -> gate now requires confirmation.
  runtime.memory.setAnnotation({ toolName: "deploy_service", risk: "high" });
  console.log("deploy_service gate after annotation:", runtime.gate("deploy_service"));

  section("Thin client loop (gate + retry)");
  const client = new ThinClient({
    memory: runtime.memory,
    gate: runtime.approval,
    requestApproval: (tool) => {
      console.log(`  [approval prompt] confirm ${tool}? -> yes`);
      return true;
    },
  });
  let approvedRuns = 0;
  let blockedRuns = 0;
  for (let i = 0; i < 3; i++) {
    const result = await client.run(
      "deploy_service",
      async () => ({ ok: true }),
      {},
      (ok, err) => {
        if (!ok) console.log(`  [blocked] ${err}`);
      },
    );
    if (result.executed) approvedRuns++;
    else blockedRuns++;
  }
  console.log(`deploy_service executed ${approvedRuns}x, blocked ${blockedRuns}x`);

  section("Derived YAML view (dev.adaptivemcp/tools-metadata)");
  console.log(runtime.extension.resourceText());

  runtime.close();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
