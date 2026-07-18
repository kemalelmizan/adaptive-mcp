import { AdaptiveRuntime } from "./runtime.js";

/**
 * Scenario: improvement over time.
 *
 * We simulate a tool whose behavior changes across three phases and watch the
 * derived YAML metadata evolve — without anyone editing the YAML by hand.
 *
 *  Phase 1: deploy_service is reliable (failure rate ~2%).
 *  Phase 2: a regression makes it flaky (failure rate ~30%).
 *  Phase 3: a fix restores reliability, and a human annotates it as high-risk.
 *
 * After each phase we print the YAML view so the evolution is visible.
 */
function phase(label: string, runtime: AdaptiveRuntime, opts: {
  calls: number;
  failRate: number;
  toolName: string;
  durationBase: number;
}): void {
  console.log(`\n================ ${label} ================`);
  for (let i = 0; i < opts.calls; i++) {
    const failed = Math.random() < opts.failRate;
    runtime.observeCompleted({
      toolName: opts.toolName,
      serverName: "scenario-server",
      durationMs: opts.durationBase + Math.floor(Math.random() * 200),
      status: failed ? "failed" : "completed",
      model: "gpt-5-mini",
      cost: { amount: 0.0021 },
      error: failed ? { message: "rollout timed out" } : undefined,
    });
  }
  console.log(runtime.extension.resourceText());
}

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

  phase("Phase 1: healthy service", runtime, {
    calls: 40,
    failRate: 0.02,
    toolName: "deploy_service",
    durationBase: 900,
  });

  phase("Phase 2: regression -> flaky", runtime, {
    calls: 40,
    failRate: 0.3,
    toolName: "deploy_service",
    durationBase: 1400,
  });

  phase("Phase 3: fix applied", runtime, {
    calls: 40,
    failRate: 0.03,
    toolName: "deploy_service",
    durationBase: 950,
  });

  console.log("\nObservation: the YAML `insights.observed_failure_rate` and `stats`");
  console.log("track the regression and recovery automatically. The `annotation.risk`");
  console.log("field stays 'high' because it is the human's static view, not learned.");
  runtime.close();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
