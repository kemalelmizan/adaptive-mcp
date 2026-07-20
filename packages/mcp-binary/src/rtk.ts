import { z } from "zod";
import { BinaryMcpServer, type BinaryMcpServerOptions, type BinaryToolSpec } from "./server.js";

/**
 * Reference binary config for **rtk** (rtk-ai.app).
 *
 * rtk has no native MCP server (doubts.md §12b, issue #1442 is "gauging
 * interest" only), so it is wrapped here into an MCP server. The wrapper exposes
 * a single `rtk_exec` tool that runs an arbitrary shell command through rtk's
 * output compression. Once rtk ships a native MCP server, this wrapper becomes
 * redundant and rtk can be chained directly like headroom.
 */
export const RTK_TOOLS: BinaryToolSpec[] = [
  {
    name: "rtk_exec",
    description:
      "Run a shell command through rtk's CLI-output compression. Returns the compressed command output.",
    subcommand: "gain",
    inputSchema: {
      command: z.string().describe("The shell command to run and compress."),
    },
    argStyle: "positionals",
  },
];

export interface RtkWrapperOptions {
  /** Path or name of the rtk binary. Defaults to `"rtk"`. */
  command?: string;
  version?: string;
  timeoutMs?: number;
}

/**
 * Build an `BinaryMcpServer` that wraps the rtk CLI. This is the sanctioned
 * shell-out layer (D4/D10): rtk becomes a chainable MCP server instead of
 * living at the host layer or shelling out inside core.
 */
export function createRtkWrapper(options: RtkWrapperOptions = {}): BinaryMcpServer {
  const opts: BinaryMcpServerOptions = {
    name: "adaptive-rtk-wrapper",
    version: options.version ?? "0.1.0",
    command: options.command ?? "rtk",
    tools: RTK_TOOLS,
    timeoutMs: options.timeoutMs,
  };
  return new BinaryMcpServer(opts);
}
