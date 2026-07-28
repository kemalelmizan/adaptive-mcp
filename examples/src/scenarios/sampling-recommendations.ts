import { AdaptiveRuntime } from "@adaptivemcp/runtime";
import { ThinClient } from "@adaptivemcp/thin-client";
import { SamplingAdvisor } from "@adaptivemcp/routing";
import { runTool, section, seedRandom } from "./shared.js";

/**
 * Scenario: sampling-parameter recommendations.
 *
 * Demonstrates turning observed failure rates into suggested LLM sampling
 * parameters (temperature/top_p), following the same
 * evaluate-stats -> persist-recommendation shape as `Router`'s model/budget
 * recommendations.
 *
 * IMPORTANT: this is advisory only. Nothing in Adaptive MCP makes an LLM
 * completion call — `SamplingAdvisor` only writes a `sampling` recommendation,
 * and `ThinClient` only *reads* it back via `onSamplingRecommendation`. A real
 * host would apply `rec.payload` to its own next completion request; here we
 * just log what it would have received.
 */
async function main(): Promise<void> {
  seedRandom(20260719); // deterministic output so the narrative matches the print
  const runtime = new AdaptiveRuntime({ yamlPath: "yaml/sampling-recommendations.yaml" });

  // A healthy tool and a flaky one.
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

  section("Sampling recommendations (SamplingAdvisor)");
  const advisor = new SamplingAdvisor({ memory: runtime.memory });
  advisor.adviseAll();
  console.log(
    "search_customer:",
    runtime.memory.getTool("search_customer")?.recommendations.filter((r) => r.type === "sampling"),
  );
  console.log(
    "deploy_service:",
    runtime.memory.getTool("deploy_service")?.recommendations.filter((r) => r.type === "sampling"),
  );

  section("Thin client loop (host reads the hook per call)");
  const client = new ThinClient({
    memory: runtime.memory,
    gate: runtime.approval,
    samplingAdvisor: advisor,
    onSamplingRecommendation: (rec, ctx) => {
      // A real host would thread `rec.payload` into its own next LLM
      // completion call here. ThinClient never makes that call itself.
      console.log(`  [next LLM turn for ${ctx.toolName}] would apply sampling:`, rec.payload, `(${rec.rationale})`);
    },
  });
  for (let i = 0; i < 3; i++) {
    await client.run(
      "deploy_service",
      async () => ({ ok: i !== 1, error: i === 1 ? "simulated failure" : undefined }),
      {},
      (ok, error, output) => {
        runtime.memory.recordExecution({
          id: `deploy_service-extra-${i}`,
          toolName: "deploy_service",
          serverName: "platform",
          timestamp: new Date().toISOString(),
          durationMs: 400,
          status: ok ? "completed" : "failed",
          error: error ? { message: error } : undefined,
          output,
        });
      },
      "platform",
    );
  }

  section("Derived YAML view (dev.adaptivemcp/tools-metadata)");
  runtime.extension.sync();
  console.log(runtime.extension.resourceText());

  runtime.close();
}

if (import.meta.url === `file://${process.argv[1]}` || import.meta.url.endsWith(process.argv[1]?.replace(/\\/g, '/') ?? '')) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
