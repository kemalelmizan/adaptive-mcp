import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { TOOLS_METADATA_RESOURCE_URI } from "@adaptivemcp/spec";

/**
 * Integration check for the *real* stdio MCP server (the built `examples`
 * package), not the in-memory runtime unit test. It spawns the server as a child
 * process, lists and calls tools, and reads the published `tools-metadata`
 * resource over the wire.
 *
 * Skipped when `examples/dist/server.js` is absent (plain `pnpm test` on a clean
 * checkout). CI builds `examples` and runs `pnpm test:integration`.
 */
const serverPath = fileURLToPath(new URL("../dist/server.js", import.meta.url));
const hasBuiltServer = existsSync(serverPath);

describe.skipIf(!hasBuiltServer)("example MCP server (stdio integration)", () => {
  let client!: Client;
  let workdir: string;

  beforeAll(async () => {
    workdir = mkdtempSync(join(tmpdir(), "adaptivemcp-integration-"));
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [serverPath],
      env: { ...process.env, ADAPTIVE_YAML: join(workdir, "tools-metadata.yaml") },
    });
    client = new Client({ name: "adaptivemcp-integration", version: "0.0.0" });
    await client.connect(transport);
  }, 20_000);

  afterAll(async () => {
    await client?.close();
  });

  it("lists the example tools", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);
    expect(names).toContain("search_customer");
    expect(names).toContain("deploy_service");
  });

  it("calls a tool over stdio", async () => {
    const result = await client.callTool({
      name: "search_customer",
      arguments: { customerId: "it-1" },
    });
    const text =
      (result.content as Array<{ type: string; text?: string }>).find((c) => c.type === "text")
        ?.text ?? "";
    expect(text.length).toBeGreaterThan(0);
    expect(result.isError).toBeFalsy();
  });

  it("publishes the server-governed tools-metadata resource", async () => {
    const resource = await client.readResource({ uri: TOOLS_METADATA_RESOURCE_URI });
    const text = (resource.contents[0] as { text: string }).text;
    expect(text).toContain("deploy_service");
    expect(text).toContain("platform");
  });
});
