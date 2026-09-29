import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SubscribeRequestSchema, UnsubscribeRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { AdaptiveRuntime } from "@adaptivemcp/runtime";
import { TOOLS_METADATA_RESOURCE_URI, riskToToolAnnotations, type RiskLevel } from "@adaptivemcp/spec";

/**
 * Merge an Adaptive MCP static `risk` level into a tool's core `annotations`
 * (Strategy 2 of the governance hybrid, doubts.md §11): the host's native,
 * already-parsed risk signal carries the risk instead of a parallel field.
 */
function withRisk(
  annotations: Record<string, unknown>,
  risk?: RiskLevel,
): Record<string, unknown> {
  return { ...annotations, ...riskToToolAnnotations(risk) };
}

/**
 * A minimal MCP server that exposes two application-level tools and the
 * Adaptive MCP `tools-metadata.yaml` resource. The server stays stateless and
 * lightweight; all adaptive behavior lives in the runtime (middleware).
 */
export async function startServer(dbPath?: string, yamlPath?: string): Promise<McpServer> {
  const runtime = new AdaptiveRuntime({ dbPath, yamlPath, enableGraph: true });

  // Server governance: publish static policy for a high-risk tool via the
  // dev.adaptivemcp/tools-metadata resource. The client reads it and applies it
  // as a floor (host consent > server policy > learned). See the SEP-2133 draft.
  const policyNow = new Date().toISOString();
  runtime.memory.setAnnotation({
    toolName: "deploy_service",
    serverName: "adaptive-example-server",
    owner: "platform",
    description: "Production deploy; server policy requires human approval.",
  });
  runtime.memory.addRecommendation({
    toolName: "deploy_service",
    serverName: "adaptive-example-server",
    type: "approval",
    payload: { decision: "require_confirmation" },
    rationale: "Server policy: production deploys require human approval.",
    confidence: 1,
    generatedAt: policyNow,
  });
  runtime.memory.addRecommendation({
    toolName: "deploy_service",
    serverName: "adaptive-example-server",
    type: "routing",
    payload: { perToolLimit: 10, spent: 0, status: "ok" },
    rationale: "Server policy: cost budget for deploys.",
    confidence: 1,
    generatedAt: policyNow,
  });
  runtime.extension.sync();

  const server = new McpServer(
    { name: "adaptive-example-server", version: "0.1.0" },
    // Advertise the Adaptive MCP extension via the SEP-2133 `extensions`
    // capability (present in @modelcontextprotocol/sdk >= 1.29.0). Clients that
    // don't parse capabilities still discover the resource via `resources/list`.
    // `resources.subscribe` must be declared here (before `connect()`) for the
    // execution-graph resource's subscribe/notify demo below to work.
    {
      capabilities: {
        extensions: { "dev.adaptivemcp/tools-metadata": {} },
        resources: { subscribe: true, listChanged: true },
      },
    },
  );

  // Phase 11.2: track subscribed resource URIs so completed tool calls can
  // notify clients watching a session's execution graph. `McpServer` has no
  // subscribe/notify convenience methods — this uses the low-level `Server`
  // it exposes via the public `server.server` field.
  const subscribedUris = new Set<string>();
  server.server.setRequestHandler(SubscribeRequestSchema, async (request) => {
    subscribedUris.add(request.params.uri);
    return {};
  });
  server.server.setRequestHandler(UnsubscribeRequestSchema, async (request) => {
    subscribedUris.delete(request.params.uri);
    return {};
  });

  /** Notify a subscribed client that a session's execution graph changed. */
  async function notifyExecutionGraphUpdated(sessionId: string): Promise<void> {
    const uri = runtime.extension.executionGraphResourceUri(sessionId);
    if (subscribedUris.has(uri)) {
      await server.server.sendResourceUpdated({ uri });
    }
  }

  // Tool: deploy a service (high-risk, slow). Static risk is projected onto
  // core Tool.annotations via riskToToolAnnotations (Strategy 2 demo).
  server.registerTool(
    "deploy_service",
    {
      title: "Deploy Service",
      description: "Deploy a service to the target environment.",
      inputSchema: { environment: z.string(), version: z.string() },
      annotations: withRisk(
        { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
        "high",
      ),
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

      // Phase 11.2 demo: each call is its own execution-graph session/workflow
      // root, so a client subscribed to that session's resource gets notified.
      const { nodeId, sessionId } = runtime.startWorkflow({ toolName: "deploy_service", workflowId: "deploy_service" });
      if (failed) {
        runtime.failNode(nodeId, { message: "rollout timed out" });
      } else {
        runtime.completeNode(nodeId, { durationMs, cost: { amount: 0.0021, currency: "USD" } });
      }
      await notifyExecutionGraphUpdated(sessionId);

      return {
        content: failed
          ? [{ type: "text", text: `deploy failed: rollout timed out (session: ${sessionId})` }]
          : [{ type: "text", text: `deployed ${version} to ${environment} (session: ${sessionId})` }],
        isError: failed,
      };
    },
  );

  // Tool: search a customer (low-risk, fast). Static risk projected onto core
  // Tool.annotations (Strategy 2 demo).
  server.registerTool(
    "search_customer",
    {
      title: "Search Customer",
      description: "Look up a customer by id.",
      inputSchema: {
        customerId: z.string(),
        // Demo-only: lets a client continue an existing execution-graph
        // session (e.g. to exercise Phase 11.2's subscribe/notify against a
        // session it already subscribed to) instead of always starting a new one.
        sessionId: z.string().optional(),
      },
      annotations: withRisk(
        { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
        "low",
      ),
    },
    async ({ customerId, sessionId: continueSessionId }) => {
      const durationMs = 20 + Math.floor(Math.random() * 60);
      runtime.observeCompleted({
        toolName: "search_customer",
        serverName: "adaptive-example-server",
        durationMs,
        status: "completed",
        model: "gpt-5-mini",
        cost: { amount: 0.0003, currency: "USD" },
      });

      const { nodeId, sessionId } = runtime.startWorkflow({
        toolName: "search_customer",
        workflowId: "search_customer",
        sessionId: continueSessionId,
      });
      runtime.completeNode(nodeId, { durationMs, cost: { amount: 0.0003, currency: "USD" } });
      await notifyExecutionGraphUpdated(sessionId);

      return { content: [{ type: "text", text: `customer ${customerId}: active (session: ${sessionId})` }] };
    },
  );

  // Adaptive MCP resource: the derived YAML tools-metadata view.
  server.registerResource(
    "tools-metadata",
    TOOLS_METADATA_RESOURCE_URI,
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

  // Adaptive MCP resource (Phase 11.1): a session's execution graph, paginated
  // over `nodes` via `?cursor=`/`?pageSize=` query params (the SDK has no
  // built-in pagination for a single resource read — see
  // `ExtensionController.executionGraphResourceText`'s docstring). Also
  // subscribable (Phase 11.2): `notifyExecutionGraphUpdated` fires
  // `notifications/resources/updated` for subscribed sessions after each
  // tool call above.
  server.registerResource(
    "execution-graph",
    new ResourceTemplate("dev.adaptivemcp://execution-graph/{sessionId}", { list: undefined }),
    {
      title: "Adaptive MCP Execution Graph",
      description: "Per-session execution graph (nodes/edges), paginated over `nodes` via ?cursor=/?pageSize=.",
      mimeType: "application/json",
    },
    async (uri) => {
      // Don't trust the SDK's matched `variables.sessionId`: its template
      // matcher's regex for a plain `{var}` segment is `[^/]+`, which does
      // NOT exclude `?` — a request URI with a query string (needed for
      // pagination below) gets the whole `sessionId?cursor=...` tail
      // captured as one variable. `URL` itself parses `pathname`/
      // `searchParams` correctly, so use those instead.
      const sessionId = decodeURIComponent(uri.pathname.replace(/^\//, ""));
      const cursor = uri.searchParams.get("cursor") ?? undefined;
      const pageSizeParam = uri.searchParams.get("pageSize");
      const pageSize = pageSizeParam ? Number(pageSizeParam) : undefined;

      const result = runtime.extension.executionGraphResourceText(sessionId, "application/json", {
        cursor,
        pageSize,
      });
      const text = typeof result === "string" ? result : JSON.stringify(result);
      return { contents: [{ uri: uri.href, mimeType: "application/json", text }] };
    },
  );

  // Adaptive MCP report channel: clients report tool observations back to the
  // server via the `report_observation` tool (the spec-legal client→server
  // mechanism). The server validates and folds the report into the store and
  // re-syncs the view. A stateless server MAY ignore reports; set foldReports
  // to false to register the tool as a no-op (conformance signal only).
  const reportTool = runtime.extension.reportObservationTool();
  const foldReports = process.env.ADAPTIVE_FOLD_REPORTS !== "false";
  server.registerTool(
    reportTool.name,
    {
      title: "Report Observation",
      description: reportTool.description,
      inputSchema: {
        tool: z.string(),
        status: z.enum(["success", "failure", "error"]),
        duration_ms: z.number().optional(),
        cost: z.number().optional(),
        timestamp: z.string(),
        client_id: z.string().optional(),
      },
    },
    async ({ tool, status, duration_ms, cost, timestamp, client_id }) => {
      // Ensure the tool record exists before folding (graceful on unknown tools).
      runtime.memory.ensureTool(tool, "adaptive-example-server");
      const result = runtime.extension.reportObservation({
        tool,
        status,
        duration_ms,
        cost,
        timestamp,
        client_id,
        foldReports,
      });
      if (!result.accepted) {
        return {
          content: [{ type: "text", text: `observation for ${tool} not persisted (${result.reason})` }],
        };
      }
      runtime.extension.sync();
      return {
        content: [{ type: "text", text: `observation for ${tool} recorded at ${timestamp}` }],
      };
    },
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
