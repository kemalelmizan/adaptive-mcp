import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { AdaptiveRuntime } from "./runtime.js";

/**
 * A minimal MCP server that exposes two application-level tools and the
 * Adaptive MCP `tools-metadata.yaml` resource. The server stays stateless and
 * lightweight; all adaptive behavior lives in the runtime (middleware).
 */
export async function startServer(dbPath?: string, yamlPath?: string): Promise<McpServer> {
  const runtime = new AdaptiveRuntime({ dbPath, yamlPath });
  const server = new McpServer({ name: "adaptive-example-server", version: "0.1.0" });

  // Tool: deploy a service (high-risk, slow).
  server.registerTool(
    "deploy_service",
    {
      title: "Deploy Service",
      description: "Deploy a service to the target environment.",
      inputSchema: { environment: z.string(), version: z.string() },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    async ({ environment, version }) => {
      // Simulate occasional failure.
      const failed = Math.random() < 0.15;
      const durationMs = 800 + Math.floor(Math.random() * 1200);
      runtime.observeCompleted({
        toolName: "deploy_service",
        serverName: "adaptive-example-server",
        durationMs,
        status: failed ? "failed" : "completed",
        model: "gpt-5-mini",
        cost: { amount: 0.0021, currency: "USD" },
        error: failed ? { message: "rollout timed out" } : undefined,
      });
      return {
        content: failed
          ? [{ type: "text", text: "deploy failed: rollout timed out" }]
          : [{ type: "text", text: `deployed ${version} to ${environment}` }],
        isError: failed,
      };
    },
  );

  // Tool: search a customer (low-risk, fast).
  server.registerTool(
    "search_customer",
    {
      title: "Search Customer",
      description: "Look up a customer by id.",
      inputSchema: { customerId: z.string() },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ customerId }) => {
      const durationMs = 20 + Math.floor(Math.random() * 60);
      runtime.observeCompleted({
        toolName: "search_customer",
        serverName: "adaptive-example-server",
        durationMs,
        status: "completed",
        model: "gpt-5-mini",
        cost: { amount: 0.0003, currency: "USD" },
      });
      return { content: [{ type: "text", text: `customer ${customerId}: active` }] };
    },
  );

  // Adaptive MCP resource: the derived YAML tools-metadata view.
  server.registerResource(
    "tools-metadata",
    "dev.adaptivemcp/tools-metadata",
    {
      title: "Adaptive MCP Tools Metadata",
      description:
        "Derived view of tool metadata (annotations, learned insights, recommendations, stats) from the SQLite store.",
      mimeType: "application/yaml",
    },
    async (uri) => ({
      contents: [{ uri: uri.href, mimeType: "application/yaml", text: runtime.extension.resourceText() }],
    }),
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  return server;
}

// Run directly: node dist/server.js
if (import.meta.url === `file://${process.argv[1]}`) {
  const dbPath = process.env.ADAPTIVE_DB;
  const yamlPath = process.env.ADAPTIVE_YAML ?? "tools-metadata.yaml";
  startServer(dbPath, yamlPath).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
