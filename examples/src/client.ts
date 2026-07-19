import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { AdaptiveRuntime } from "./runtime.js";

/**
 * A minimal MCP client that:
 *  1. connects to the example server over stdio;
 *  2. lists and calls tools;
 *  3. reads the Adaptive MCP `tools-metadata.yaml` resource.
 *
 * It also demonstrates the same adaptive loop locally (AdaptiveRuntime) so the
 * example runs without spawning a child process.
 */
export async function runClient(): Promise<void> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [new URL("./server.js", import.meta.url).pathname],
    env: { ...process.env, ADAPTIVE_YAML: "tools-metadata.client.yaml" },
  });
  const client = new Client({ name: "adaptive-example-client", version: "0.1.0" });
  await client.connect(transport);

  const tools = await client.listTools();
  console.log("Server tools:", tools.tools.map((t) => t.name).join(", "));

  for (let i = 0; i < 5; i++) {
    await client.callTool({ name: "search_customer", arguments: { customerId: `c-${i}` } });
  }
  await client.callTool({ name: "deploy_service", arguments: { environment: "prod", version: "1.0.0" } });

  const res = await client.readResource({ uri: "dev.adaptivemcp/tools-metadata" });
  const text = (res.contents[0] as { text: string }).text;
  console.log("\n--- tools-metadata.yaml (from server resource) ---\n");
  console.log(text);

  await client.close();
}

// Local, no-child-process demonstration of the adaptive loop.
export function runLocalLoop(): void {
  const runtime = new AdaptiveRuntime({ yamlPath: "tools-metadata.local.yaml" });
  for (let i = 0; i < 25; i++) {
    runtime.observeCompleted({
      toolName: "deploy_service",
      serverName: "local",
      durationMs: 900 + Math.floor(Math.random() * 400),
      status: i % 7 === 0 ? "failed" : "completed",
      cost: { amount: 0.0021 },
    });
  }
  for (let i = 0; i < 25; i++) {
    runtime.observeCompleted({
      toolName: "search_customer",
      serverName: "local",
      durationMs: 30 + Math.floor(Math.random() * 20),
      status: "completed",
      cost: { amount: 0.0003 },
    });
  }
  console.log("\n--- tools-metadata.yaml (local loop) ---\n");
  console.log(runtime.extension.resourceText());
  runtime.close();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runLocalLoop();
}
