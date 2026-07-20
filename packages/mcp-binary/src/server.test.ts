import { describe, it, expect } from "vitest";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { BinaryMcpServer } from "./server.js";
import { createRtkWrapper, RTK_TOOLS } from "./rtk.js";

// A tiny fake "binary" implemented as a node `-e` script: it echoes the
// subcommand and the rendered args as JSON on stdout. This lets us exercise the
// real spawn path without an external binary.
const FAKE_BIN = process.execPath;
const FAKE_SCRIPT = `
  const sub = process.argv[1];
  const rest = process.argv.slice(2);
  process.stdout.write(JSON.stringify({ sub, rest }));
`;

function fakeServer(): BinaryMcpServer {
  return new BinaryMcpServer({
    name: "fake",
    command: FAKE_BIN,
    baseArgs: ["-e", FAKE_SCRIPT],
    tools: [
      {
        name: "fake_run",
        description: "run",
        subcommand: "run",
        inputSchema: { command: z.string() },
        argStyle: "positionals",
      },
      {
        name: "fake_flags",
        description: "flags",
        subcommand: "flags",
        inputSchema: { a: z.string(), b: z.string() },
        argStyle: "flags",
      },
    ],
  });
}

async function withClient(
  server: BinaryMcpServer,
  fn: (client: Client) => Promise<void>,
): Promise<void> {
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0.0.0" });
  await Promise.all([server.server.connect(serverT), client.connect(clientT)]);
  try {
    await fn(client);
  } finally {
    await client.close();
    await server.close();
  }
}

describe("@adaptivemcp/mcp-binary", () => {
  it("exposes rtk tools with an rtk_exec entry", () => {
    expect(RTK_TOOLS.map((t) => t.name)).toContain("rtk_exec");
  });

  it("createRtkWrapper builds a BinaryMcpServer wrapping rtk", () => {
    const srv = createRtkWrapper({ command: FAKE_BIN, baseArgs: ["-e", FAKE_SCRIPT] } as never);
    expect(srv).toBeInstanceOf(BinaryMcpServer);
    expect(srv.toolNames()).toContain("rtk_exec");
  });

  it("renders positional args through the wrapped binary", async () => {
    const srv = fakeServer();
    await withClient(srv, async (client) => {
      const res = await client.callTool({ name: "fake_run", arguments: { command: "git status" } });
      const text = (res.content[0] as { text: string }).text;
      expect(JSON.parse(text)).toEqual({ sub: "run", rest: ["git status"] });
    });
  });

  it("renders flag args through the wrapped binary", async () => {
    const srv = fakeServer();
    await withClient(srv, async (client) => {
      const res = await client.callTool({ name: "fake_flags", arguments: { a: "1", b: "2" } });
      const text = (res.content[0] as { text: string }).text;
      expect(JSON.parse(text)).toEqual({ sub: "flags", rest: ["--a", "1", "--b", "2"] });
    });
  });
});
