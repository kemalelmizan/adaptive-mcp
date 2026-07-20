import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

/**
 * A single CLI subcommand exposed as an MCP tool.
 *
 * The wrapper shells out to `<command> <subcommand> [args...]` and returns the
 * combined stdout/stderr as the tool result. This is the **only** place in
 * Adaptive MCP permitted to spawn processes (doubts.md §12b / D10) — it is the
 * sanctioned shell-out layer that lets binaries like rtk become chainable MCP
 * servers instead of living at the host layer or shelling out inside core.
 */
export interface BinaryToolSpec {
  /** MCP tool name, e.g. `rtk_exec`. */
  name: string;
  /** Human description shown in `tools/list`. */
  description: string;
  /** The subcommand passed to the binary (e.g. `gain`, `compress`). */
  subcommand: string;
  /**
   * Zod-validated input schema for the tool. The parsed args are forwarded to
   * the binary as CLI flags/positionals. Use `argStyle` to control formatting.
   */
  inputSchema: z.ZodRawShape;
  /** How to render parsed args on the command line. Defaults to `--key value`. */
  argStyle?: "flags" | "positionals";
}

export interface BinaryMcpServerOptions {
  /** Server identity advertised in `initialize`. */
  name: string;
  version?: string;
  /** The binary to invoke, e.g. `"rtk"` or `"/usr/local/bin/rtk"`. */
  command: string;
  /** Base args always prepended (e.g. `["--json"]`). */
  baseArgs?: string[];
  /** Tools to expose. */
  tools: BinaryToolSpec[];
  /** Shell out timeout in ms (per invocation). Defaults to 30s. */
  timeoutMs?: number;
}

/**
 * Wraps a CLI binary into an MCP stdio server. Each `BinaryToolSpec` becomes an
 * MCP tool that runs `<command> <subcommand> <args>` and returns the output.
 *
 * This is intentionally generic (D10): rtk is the reference binary, but any
 * CLI tool whose output benefits from in-loop transformation can be wrapped the
 * same way and then chained through `@adaptivemcp/middleware`.
 */
export class BinaryMcpServer {
  private server: McpServer;
  private opts: BinaryMcpServerOptions;

  constructor(options: BinaryMcpServerOptions) {
    this.opts = options;
    this.server = new McpServer(
      { name: options.name, version: options.version ?? "0.1.0" },
      { capabilities: {} },
    );
    for (const tool of options.tools) {
      this.registerTool(tool);
    }
  }

  private registerTool(tool: BinaryToolSpec): void {
    this.server.registerTool(
      tool.name,
      {
        title: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      },
      async (args: Record<string, unknown>) => {
        const out = await this.run(tool.subcommand, args, tool.argStyle ?? "flags");
        return {
          content: [{ type: "text", text: out }],
        };
      },
    );
  }

  /** Server identity advertised in `initialize`. */
  get name(): string {
    return this.opts.name;
  }

  /** Server version advertised in `initialize`. */
  get version(): string {
    return this.opts.version ?? "0.1.0";
  }

  /** Names of the tools registered on this server. */
  toolNames(): string[] {
    return this.opts.tools.map((t) => t.name);
  }

  /** Spawn the binary, write `input` (if any) to stdin, resolve with stdout. */
  private run(subcommand: string, args: Record<string, unknown>, style: "flags" | "positionals"): Promise<string> {
    const cliArgs = [
      ...(this.opts.baseArgs ?? []),
      subcommand,
      ...this.renderArgs(args, style),
    ];
    return new Promise((resolve, reject) => {
      const child: ChildProcessWithoutNullStreams = spawn(this.opts.command, cliArgs, {
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error(`binary ${this.opts.command} timed out after ${this.opts.timeoutMs ?? 30000}ms`));
      }, this.opts.timeoutMs ?? 30000);

      child.stdout.on("data", (d) => (stdout += d.toString()));
      child.stderr.on("data", (d) => (stderr += d.toString()));
      child.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve(stdout.trim());
        else reject(new Error(`${this.opts.command} exited ${code}: ${stderr.trim() || stdout.trim()}`));
      });
    });
  }

  private renderArgs(args: Record<string, unknown>, style: "flags" | "positionals"): string[] {
    if (style === "positionals") {
      return Object.values(args).map(String);
    }
    const out: string[] = [];
    for (const [key, value] of Object.entries(args)) {
      if (value === undefined || value === null) continue;
      out.push(`--${key}`, String(value));
    }
    return out;
  }

  /** Attach to stdio and start listening. */
  async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }

  /** Stop the server. */
  async close(): Promise<void> {
    await this.server.close();
  }
}
