/**
 * Shared helpers for Adaptive MCP maintenance scripts.
 *
 * These scripts run on Node 26 with native type stripping (`node script.ts`),
 * so no tsx/tshy dependency is required. They shell out to pnpm/npm/git via
 * `child_process` and never couple to a specific CI provider.
 */

import { execFileSync, type ExecFileSyncOptions } from "node:child_process";
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

/** Run a pnpm workspace command from the repo root. */
export function pnpm(args: string[], opts: { silent?: boolean } = {}): string {
  return run("pnpm", args, opts);
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

/** Read the current npm registry (respects .npmrc / env). */
export function npmRegistry(): string {
  try {
    return run("npm", ["config", "get", "registry"], { silent: true }).trim();
  } catch {
    return "https://registry.npmjs.org/";
  }
}
