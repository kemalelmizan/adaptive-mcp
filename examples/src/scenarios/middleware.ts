import { AdaptiveRuntime } from "@adaptivemcp/runtime";
import { ThinClient } from "@adaptivemcp/thin-client";
import {
  HeadroomMiddleware,
  McpHeadroomCompressor,
  type Compressor,
  type Middleware,
  type PlannedCall,
} from "@adaptivemcp/middleware";
import { createRtkWrapper } from "@adaptivemcp/mcp-binary";
import { section } from "./shared.js";

/**
 * Scenario: middleware plumbing (D1–D3, D7–D10).
 *
 * Demonstrates:
 *   - D2/D5: explicit `use()` registration + fixed ordering (beforeCall in
 *            registration order, afterCall/onError in reverse).
 *   - D1:    full output plumbing — `call.output` is mutated by middleware and
 *            carried back to the caller + recorded in the event.
 *   - D3:    the YAML `middleware` map — `contributeView` results from the
 *            registered chain surface in `tools-metadata.yaml`.
 *   - D7/D9: a `Compressor` (here a fake stand-in for headroom) wired via the
 *            MCP-chaining contract; passthrough on compress failure.
 *   - D4/D10: rtk wrapped into an MCP server by `@adaptivemcp/mcp-binary`
 *            (the only sanctioned shell-out layer).
 */
async function main(): Promise<void> {
  section("Middleware: register a compressor + a logging middleware");

  // A fake compressor standing in for `headroom` (D7). Swap in
  // `new McpHeadroomCompressor(client)` to use the real headroom MCP server.
  const fakeCompressor: Compressor = {
    async compress(content: string) {
      const compressed = content.slice(0, Math.max(0, Math.floor(content.length / 2)));
      const savingsPercent = content.length === 0 ? 0 : 1 - compressed.length / content.length;
      return { compressed, hash: `ccr:${content.length}`, savingsPercent };
    },
  };

  const headroom = new HeadroomMiddleware({ compressor: fakeCompressor });

  // A trivial logging middleware to show ordering (D5).
  const log: Middleware = {
    name: "log",
    beforeCall: (call: PlannedCall) => {
      console.log(`  [log.before] ${call.toolName}`);
    },
    afterCall: (_r, call: PlannedCall) => {
      console.log(`  [log.after]  ${call.toolName} -> ${JSON.stringify(call.output)}`);
    },
  };

  const runtime = new AdaptiveRuntime({
    yamlPath: "yaml/middleware.yaml",
    middleware: [headroom, log],
  });

  runtime.memory.ensureTool("summarize", "crm");

  section("Thin client loop with middleware (D1 output plumbing)");
  const client = new ThinClient({
    memory: runtime.memory,
    gate: runtime.approval,
    middleware: [headroom, log],
  });

  const big = "x".repeat(200);
  const result = await client.run(
    "summarize",
    async () => ({ ok: true, output: big }),
    {},
    (ok, _err, output) => {
      console.log(`  [record] ok=${ok} outputLen=${typeof output === "string" ? output.length : "?"}`);
    },
  );
  // The headroom middleware compressed the 200-char output in place.
  console.log(`  compressed output length: ${(result.output as string)?.length}`);

  section("Observe + derive YAML view (D3: middleware map)");
  runtime.observeCompleted({
    toolName: "summarize",
    serverName: "crm",
    durationMs: 120,
    status: "completed",
    output: result.output,
  });
  console.log(runtime.extension.resourceText());

  section("rtk wrapped into an MCP server (D4/D10)");
  // The only sanctioned shell-out: mcp-binary spawns the rtk binary and exposes
  // it as an MCP server. `createRtkWrapper` returns a BinaryMcpServer; call
  // `.run()` (or `.start()`) to serve it over stdio.
  const rtk = createRtkWrapper({ command: "rtk", timeoutMs: 5000 });
  console.log(`  rtk MCP server: ${rtk.name} v${rtk.version}`);
  console.log(`  rtk tools: ${rtk.toolNames().join(", ")}`);

  runtime.close();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
