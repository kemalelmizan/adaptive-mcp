import { MemoryStore } from "@adaptivemcp/memory";
import { ExtensionController } from "@adaptivemcp/extension";
import { SPEC_VERSION } from "@adaptivemcp/spec";
import { renderToolsMetadata, toYaml } from "@adaptivemcp/extension";

/**
 * Scenario: the SQLite store is the single source of truth (SSOT).
 *
 * Highlights:
 *   - `@adaptivemcp/spec`  : the shared `ToolRecord` / `Annotation` / `Insight` types.
 *   - `@adaptivemcp/memory`: the SQLite-backed `MemoryStore` that persists them.
 *   - `@adaptivemcp/extension`: the YAML view is *derived* from the SSOT, never the reverse.
 *
 * We write metadata directly into the store, then show that the YAML view is a
 * pure projection of whatever the store contains.
 */
function main(): void {
  const memory = new MemoryStore({ path: ":memory:" });
  const extension = new ExtensionController({ memory });

  console.log("--- 1. Seed the SSOT directly (no YAML involved yet) ---\n");

  // Human-written static annotation (the operator's view of the tool).
  memory.setAnnotation({
    toolName: "deploy_service",
    risk: "high",
    owner: "platform",
    tags: ["deploy", "prod"],
    description: "Deploys a service to production.",
  });

  // A learned insight, written by evaluation (here we write it by hand to show
  // that the store is the source of truth for insights too).
  memory.addInsight({
    toolName: "deploy_service",
    key: "observed_failure_rate",
    value: 0.12,
    confidence: 0.7,
    source: "evaluation",
    observedAt: new Date().toISOString(),
    sampleSize: 40,
  });

  // Fold a few executions into the durable stats.
  for (let i = 0; i < 40; i++) {
    memory.recordExecution({
      id: `evt-${i}`,
      toolName: "deploy_service",
      serverName: "demo-server",
      timestamp: new Date().toISOString(),
      durationMs: 900 + Math.floor(Math.random() * 200),
      status: i % 8 === 0 ? "failed" : "completed",
      cost: { amount: 0.0021, currency: "USD" },
    });
  }

  console.log("--- 2. Read the raw SSOT record (what SQLite actually stores) ---\n");
  const record = memory.getTool("deploy_service");
  console.log(JSON.stringify(record, null, 2));

  console.log("\n--- 3. Derive the YAML view from the SSOT ---\n");
  const doc = renderToolsMetadata(memory.allTools(), SPEC_VERSION);
  console.log(toYaml(doc));

  console.log("--- 4. The view is recomputed on demand; editing YAML has no effect ---\n");
  console.log("resourceUri():", extension.resourceUri());
  // The two renders differ only by the freshly-generated `generated_at`
  // timestamp; the tool content (the actual projection) is identical.
  const a = extension.view().tools;
  const b = extension.view().tools;
  console.log("view() is a stable projection of the SSOT:", JSON.stringify(a) === JSON.stringify(b));

  memory.close();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
