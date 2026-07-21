import { execFileSync } from "node:child_process";
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
 *
 * **Layering — this is NOT the rtk hook.** rtk's own value comes from its
 * PreToolUse hook (installed by `rtk init -g`), which rewrites an agent's Bash
 * calls (`git status` → `rtk git status`) *before* they execute. That hook
 * operates at the agent's shell layer. This MCP wrapper is a *different* layer:
 * it runs rtk as a normal CLI subprocess inside the Adaptive MCP middleware
 * chain, compressing the output of a tool call that already returned. The two
 * compose — the hook compresses what the agent sends to the shell, this wrapper
 * compresses what a tool's MCP result carries back. See `docs/doubts.md` §12b.
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
  /**
   * Path or name of the rtk binary. Defaults to `"rtk"`.
   *
   * If omitted, `resolveRtkCommand()` is used to locate the user's existing
   * install (graceful coexistence — we prefer the binary the user already has
   * and configured over bundling or re-installing one).
   */
  command?: string;
  version?: string;
  timeoutMs?: number;
}

/**
 * The result of locating the rtk binary on the host.
 *
 * `status` tells the caller how to behave:
 *  - `"found"`: a working rtk-ai binary is available — wrap it directly.
 *  - `"missing"`: no rtk on PATH — the caller should degrade gracefully
 *    (e.g. skip the rtk middleware, or surface a setup hint) rather than
 *    spawn a binary that does not exist.
 *  - `"wrong-package"`: a binary named `rtk` exists but it is the unrelated
 *    Rust *Type Kit* crate from crates.io (its `rtk gain` fails). The caller
 *    must NOT treat this as rtk-ai; it should warn and skip.
 */
export interface RtkResolution {
  status: "found" | "missing" | "wrong-package";
  /** The command/path to use, when `status === "found"`. */
  command?: string;
  /** Human-readable detail for logs / `contributeView`. */
  detail?: string;
}

/**
 * Locate a usable rtk-ai binary on the host.
 *
 * 1. If `command` is an absolute/relative path, verify it exists and that
 *    `rtk --version` reports an `rtk <semver>` line (the rtk-ai binary),
 *    not the Rust Type Kit crate.
 * 2. Otherwise search `PATH` for `rtk`, then probe it the same way.
 *
 * This is the sanctioned, read-only discovery step. It never downloads or
 * installs anything — Adaptive MCP must not mutate the host's toolchain. If the
 * user already has rtk (from Homebrew, the official installer, or cargo), we
 * reuse it; if not, we report `missing` and let the caller degrade.
 */
export function resolveRtkCommand(command?: string): RtkResolution {
  const candidates = command ? [command] : ["rtk"];
  for (const candidate of candidates) {
    // Probe: rtk-ai prints "rtk <version>"; the Rust Type Kit crate does not.
    // `execFileSync` resolves PATH names itself, so a bare "rtk" works.
    try {
      const out = execFileSync(candidate, ["--version"], {
        encoding: "utf8",
        timeout: 5000,
        windowsHide: true,
      });
      if (/^rtk\s+\d+\.\d+/.test(out.trim())) {
        return { status: "found", command: candidate, detail: out.trim() };
      }
      // A binary named `rtk` exists but is not rtk-ai (name collision).
      return {
        status: "wrong-package",
        detail: `Found a binary named 'rtk' at ${candidate}, but it is not rtk-ai (its --version is "${out.trim()}"). This is likely the unrelated Rust 'Type Kit' crate. Install rtk-ai from https://rtk-ai.app instead.`,
      };
    } catch {
      // Probe failed: not on PATH, not executable, or the wrong package that
      // errors on --version. If an explicit path was given, report it as a
      // collision; otherwise keep looking (PATH name collision).
      if (command) {
        return {
          status: "wrong-package",
          detail: `The binary at '${command}' did not respond to 'rtk --version' like rtk-ai. Verify it is the rtk-ai binary (https://rtk-ai.app).`,
        };
      }
      continue;
    }
  }
  return {
    status: "missing",
    detail: "rtk-ai not found on PATH. Install it from https://rtk-ai.app (or set RtkWrapperOptions.command to an explicit path). The rtk middleware will be skipped.",
  };
}

/**
 * Build an `BinaryMcpServer` that wraps the rtk CLI. This is the sanctioned
 * shell-out layer (D4/D10): rtk becomes a chainable MCP server instead of
 * living at the host layer or shelling out inside core.
 *
 * Discovery is graceful: when `command` is omitted we resolve the user's
 * existing rtk install via `resolveRtkCommand()`. If none is found (or the
 * `rtk` name collides with another package), the returned server is marked
 * `unavailable` and its `rtk_exec` tool will report a clear setup message
 * instead of spawning a missing binary. Call `server.available` to check.
 */
export function createRtkWrapper(options: RtkWrapperOptions = {}): BinaryMcpServer {
  const resolution = resolveRtkCommand(options.command);
  const opts: BinaryMcpServerOptions = {
    name: "adaptive-rtk-wrapper",
    version: options.version ?? "0.1.0",
    command: resolution.command ?? "rtk",
    tools: RTK_TOOLS,
    timeoutMs: options.timeoutMs,
    unavailable: resolution.status !== "found" ? resolution.detail : undefined,
  };
  return new BinaryMcpServer(opts);
}
