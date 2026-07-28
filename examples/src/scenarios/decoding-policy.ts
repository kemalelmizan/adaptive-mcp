import { AdaptiveRuntime } from "@adaptivemcp/runtime";
import {
  DecodingAdvisor,
  DecodingResolver,
  toDecodingRecommendation,
  OPENAI_CAPABILITIES,
  LLAMA_CPP_CAPABILITIES,
} from "@adaptivemcp/routing";
import { runTool, section, seedRandom } from "./shared.js";

/**
 * Scenario: Decoding Policy (Phase 8).
 *
 * Demonstrates the split introduced in docs/ROADMAP.md Phase 8 /
 * docs/doubts.md §13: `DecodingAdvisor` selects a symbolic, backend-agnostic
 * `DecodingProfile` from an intent baseline + observed failure rate;
 * `DecodingResolver` separately translates that profile into whatever
 * concrete knobs a specific backend actually exposes. Neither knows about
 * the other — `toDecodingRecommendation` is the only place that composes
 * them.
 *
 * IMPORTANT: still advisory only. Nothing here makes an LLM completion call
 * or applies these settings to anything — a host would read the resolved
 * `DecodingRecommendation` and thread it into its own next request.
 */
async function main(): Promise<void> {
  seedRandom(20260728); // deterministic output so the narrative matches the print
  const runtime = new AdaptiveRuntime({ yamlPath: "yaml/decoding-policy.yaml" });

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
    failRate: 0.25,
    durationBase: 400,
    cost: 0.0021,
  });

  section("Profile selection (DecodingAdvisor) — intent baseline + telemetry");
  const advisor = new DecodingAdvisor({ memory: runtime.memory });
  // Both tools are asked for "creative" (e.g. a brainstorming task); only the
  // flaky one gets overridden toward something more deterministic.
  advisor.adviseAll("creative");
  const searchRec = runtime.memory.getTool("search_customer")?.recommendations.find((r) => r.type === "decoding");
  const deployRec = runtime.memory.getTool("deploy_service")?.recommendations.find((r) => r.type === "decoding");
  console.log("search_customer profile:", searchRec?.payload, `(${searchRec?.rationale})`);
  console.log("deploy_service profile:", deployRec?.payload, `(${deployRec?.rationale})`);

  section("Profile resolution (DecodingResolver) — same profile, different backends");
  const resolver = new DecodingResolver();
  if (deployRec) {
    const forOpenAI = toDecodingRecommendation(deployRec, resolver, OPENAI_CAPABILITIES);
    const forLlamaCpp = toDecodingRecommendation(deployRec, resolver, LLAMA_CPP_CAPABILITIES);
    console.log("deploy_service resolved for OpenAI-style backend:", forOpenAI);
    console.log("deploy_service resolved for llama.cpp-style backend:", forLlamaCpp);
    console.log(
      "\nNote: same profile (`%s`), different knobs — OpenAI-style has no min_p/top_k, llama.cpp-style has\n" +
        "no top_p. Neither is approximated with the other; each resolver output only uses what the\n" +
        "backend's ModelCapabilities actually declares support for.",
      deployRec.payload && typeof deployRec.payload === "object" && "id" in deployRec.payload
        ? (deployRec.payload as { id: string }).id
        : "unknown",
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
