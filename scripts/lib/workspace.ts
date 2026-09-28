/**
 * Shared helpers for Adaptive MCP maintenance scripts.
 *
 * These scripts run on Node 26 with native type stripping (`node script.ts`),
 * so no tsx/tshy dependency is required. They shell out to pnpm/npm/git via
 * `child_process` and never couple to a specific CI provider.
 */

import { execFile, execFileSync, type ExecFileSyncOptions } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(__dirname, "..", "..");

/** Packages published to npm. The `examples`/`apps` workspaces stay private. */
export const PUBLISHABLE_PACKAGES = [
  "@adaptivemcp/spec",
  "@adaptivemcp/memory",
  "@adaptivemcp/telemetry",
  "@adaptivemcp/evaluation",
  "@adaptivemcp/extension",
  "@adaptivemcp/runtime",
  "@adaptivemcp/routing",
  "@adaptivemcp/orchestration",
  "@adaptivemcp/approval",
  "@adaptivemcp/thin-client",
  "@adaptivemcp/middleware",
  "@adaptivemcp/mcp-binary",
] as const;

export type PackageJson = {
  name: string;
  version: string;
  private?: boolean;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

/** Run a command, inheriting stdio by default. Throws on non-zero exit. */
export function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; silent?: boolean } = {},
): string {
  const options: ExecFileSyncOptions = {
    cwd: opts.cwd ?? REPO_ROOT,
    stdio: opts.silent ? "pipe" : "inherit",
    encoding: "utf8",
  };
  return execFileSync(cmd, args, options) as string;
}

const execFileAsync = promisify(execFile);

/**
 * Async variant of `run`, for publishing several packages in parallel. Captures
 * stdout/stderr instead of inheriting stdio (parallel writers would interleave);
 * on a non-zero exit the rejected error carries `.stdout`/`.stderr`.
 */
export async function runAsync(
  cmd: string,
  args: string[],
  opts: { cwd?: string; maxBuffer?: number } = {},
): Promise<string> {
  const { stdout } = await execFileAsync(cmd, args, {
    cwd: opts.cwd ?? REPO_ROOT,
    encoding: "utf8",
    maxBuffer: opts.maxBuffer ?? 16 * 1024 * 1024,
  });
  return stdout;
}

/** Run a pnpm workspace command from the repo root. */
export function pnpm(args: string[], opts: { silent?: boolean } = {}): string {
  return run("pnpm", args, opts);
}

/**
 * Run `changeset status`. Returns the output even when there are no pending
 * changesets (changeset exits 1 in that case, which is not a failure for our
 * dry-run gate — it just means there is nothing to release). Throws on any
 * other non-zero exit so genuine configuration errors still surface.
 */
export function changesetStatus(): string {
  try {
    return run("pnpm", ["changeset", "status"], { silent: true });
  } catch (err) {
    const exit = (err as { status?: number }).status;
    if (exit === 1) return ""; // no pending changesets — not an error
    throw err;
  }
}

/** Read and parse a package.json by workspace-relative path. */
export function readPackageJson(relPath: string): PackageJson {
  const file = join(REPO_ROOT, relPath, "package.json");
  return JSON.parse(readFileSync(file, "utf8")) as PackageJson;
}

/** List every package directory under `packages/*` (workspace-relative). */
export function listPackageDirs(): string[] {
  const pkgsRoot = join(REPO_ROOT, "packages");
  return readdirSync(pkgsRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => join("packages", d.name));
}

/** True when a dist/ output exists for the given package directory. */
export function hasDist(pkgDir: string): boolean {
  return existsSync(join(REPO_ROOT, pkgDir, "dist"));
}

/** Current git short SHA, or "unknown" when not in a repo. */
export function gitSha(): string {
  try {
    return run("git", ["rev-parse", "--short", "HEAD"], { silent: true }).trim();
  } catch {
    return "unknown";
  }
}

/** True when the working tree has uncommitted changes. */
export function isDirty(): boolean {
  try {
    return run("git", ["status", "--porcelain"], { silent: true }).trim().length > 0;
  } catch {
    return false;
  }
}

/** List of uncommitted/untracked files, relative to the repo root. */
/**
 * The only files a release is allowed to dirty: the version bump that
 * `changeset version` writes (package.json / CHANGELOG.md under packages/* and
 * the repo root, plus the consumed `.changeset/*.md` files). Used to let
 * `--continue` resume on a tree that holds an unconsumed/committed bump.
 */
export function isExpectedBumpFile(file: string): boolean {
  if (file === "package.json" || file === "CHANGELOG.md") return true;
  if (file.endsWith("/package.json") || file.endsWith("/CHANGELOG.md")) return true;
  if (file.startsWith(".changeset/")) return true;
  return false;
}

/** True when every dirty file is part of the expected version bump. */
export function onlyBumpIsDirty(): boolean {
  return dirtyFiles().every(isExpectedBumpFile);
}

export function dirtyFiles(): string[] {
  try {
    const out = run("git", ["status", "--porcelain"], { silent: true }).trim();
    if (!out) return [];
    return out
      .split("\n")
      // Porcelain format is "XY path" (2 status chars + 1 space + path).
      // Skip the 2 status chars, then trim the single separator space so
      // paths beginning with "." (e.g. ".changeset/") are preserved.
      .map((line) => line.slice(2).trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** Read the current npm registry (respects .npmrc / env). */
export function npmRegistry(): string {
  try {
    return run("npm", ["config", "get", "registry"], { silent: true }).trim();
  } catch {
    return "https://registry.npmjs.org/";
  }
}
