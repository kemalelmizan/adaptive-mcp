import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

/**
 * Conformance (ROADMAP 6e): a host that **ignores the Adaptive MCP extension**.
 * The client does not advertise the extension, never reads the
 * `tools-metadata` resource, and never calls `report_observation`. The whole
 * design bets on graceful degradation for such hosts; this asserts the base
 * MCP server/client still work normally.
 *
 * Skipped when `examples/dist/server.js` is absent (CI builds examples first).
 */
const serverPath = fileURLToPath(new URL("../dist/server.js", import.meta.url));
const hasServer = existsSync(serverPath);

describe.skipIf(!hasServer)("conformance: host ignores the extension", () => {
  let client!: Client;
  let workdir: string;

  beforeAll(async () => {
    workdir = mkdtempSync(join(tmpdir(), "adaptivemcp-conformance-"));
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [serverPath],
      env: { ...process.env, ADAPTIVE_YAML: join(workdir, "tools-metadata.yaml") },
    });
    // Deliberately no `capabilities.extensions` and no resource reads.
    client = new Client({ name: "extension-ignoring-host", version: "0.0.0" });
    await client.connect(transport);
  }, 20_000);

  afterAll(async () => {
    await client?.close();
  });

  it("still lists and calls tools without reading any resource", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name)).toContain("search_customer");

    const result = await client.callTool({
      name: "search_customer",
      arguments: { customerId: "c-1" },
    });
    expect(result.isError ?? false).toBe(false);
  });

  it("never requires report_observation to be called", async () => {
    const { tools } = await client.listTools();
    // The observation tool exists, but a host that ignores it is unaffected.
    expect(tools.some((tool) => tool.name === "report_observation")).toBe(true);

    const result = await client.callTool({
      name: "deploy_service",
      arguments: { environment: "staging", version: "1.0.0" },
    });
    // deploy may randomly fail, but it must never be a protocol error.
    expect(result.content).toBeDefined();
  });
});
