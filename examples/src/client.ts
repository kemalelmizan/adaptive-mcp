import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ResourceUpdatedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { AdaptiveRuntime } from "@adaptivemcp/runtime";
import { TOOLS_METADATA_RESOURCE_URI } from "@adaptivemcp/spec";

/** Pull the `(session: <uuid>)` suffix the example server's tools append to their result text. */
function extractSessionId(text: string): string | undefined {
  return text.match(/\(session: ([^)]+)\)/)?.[1];
}

/**
 * A minimal MCP client that:
 *  1. connects to the example server over stdio;
 *  2. lists and calls tools;
 *  3. reads the Adaptive MCP `tools-metadata.yaml` resource;
 *  4. reads a session's execution-graph resource, paginated (Phase 11.1);
 *  5. subscribes to that resource and observes a live update notification
 *     fire after another tool call in the same session (Phase 11.2).
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

  const res = await client.readResource({ uri: TOOLS_METADATA_RESOURCE_URI });
  const text = (res.contents[0] as { text: string }).text;
  console.log("\n--- tools-metadata.yaml (from server resource) ---\n");
  console.log(text);

  await demoExecutionGraphResource(client);

  await client.close();
}

/** Phase 11.1/11.2 demo: paginated resource read + live subscribe/notify. */
async function demoExecutionGraphResource(client: Client): Promise<void> {
  // Call the tool twice in one session so the graph has 2 nodes to paginate over.
  const first = await client.callTool({ name: "search_customer", arguments: { customerId: "graph-demo" } });
  const firstText = (first.content as Array<{ text: string }>)[0]?.text ?? "";
  const sessionId = extractSessionId(firstText);
  if (!sessionId) {
    console.log("\n--- execution-graph demo skipped: could not extract a session id ---\n");
    return;
  }
  const uri = `dev.adaptivemcp://execution-graph/${sessionId}`;
  console.log(`\n--- execution-graph resource (session: ${sessionId}) ---\n`);

  let notified = false;
  client.setNotificationHandler(ResourceUpdatedNotificationSchema, (notification) => {
    if (notification.params.uri === uri) notified = true;
  });
  await client.subscribeResource({ uri });

  // Continue the *same* session (the demo tool accepts an explicit `sessionId`
  // to make this possible) so the server's `notifyExecutionGraphUpdated` call
  // matches this subscription's uri and actually fires.
  await client.callTool({ name: "search_customer", arguments: { customerId: "graph-demo-2", sessionId } });
  await new Promise((resolve) => setTimeout(resolve, 50)); // let the notification arrive
  console.log(`subscribed and received a resources/updated notification: ${notified}`);
  await client.unsubscribeResource({ uri });

  // Now the session has 2 nodes - page through them one at a time.
  const page1 = await client.readResource({ uri: `${uri}?pageSize=1` });
  const page1Doc = JSON.parse((page1.contents[0] as { text: string }).text);
  console.log(`page 1: ${page1Doc.nodes.length} node(s), next_cursor=${page1Doc.next_cursor}`);

  const page2 = await client.readResource({ uri: `${uri}?pageSize=1&cursor=${page1Doc.next_cursor}` });
  const page2Doc = JSON.parse((page2.contents[0] as { text: string }).text);
  console.log(`page 2: ${page2Doc.nodes.length} node(s), next_cursor=${page2Doc.next_cursor}`);
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
  // `pnpm client` runs the real stdio client that spawns the server and reads
  // the derived resource. Use `pnpm client:local` for the no-child-process demo.
  runClient().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
