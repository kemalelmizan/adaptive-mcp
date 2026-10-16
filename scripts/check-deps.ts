/**
 * scripts/check-deps.ts — prove the workspace dependency graph, in both
 * directions.
 *
 *   1. **No undeclared imports.** Every bare import in `packages/<p>/src` must be
 *      declared in that package's `dependencies` or `devDependencies`.
 *   2. **No unused declarations.** Every declared `@adaptivemcp/*` dependency must
 *      be imported somewhere in `packages/<p>/src`.
 *
 * **Test files count on purpose.** Excluding them once classified
 * `@adaptivemcp/evaluation`'s six cross-package conformance deps as "unused"
 * (#35) — and the vitest config aliases every `@adaptivemcp/*` to its package
 * `src`, so a *missing* dependency cannot fail there either: silent drift in both
 * directions. This script is the guard for both.
 *
 * Run: `pnpm deps:check` (also part of `pnpm maintenance:check` and CI).
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { REPO_ROOT, listPackageDirs, readPackageJson } from "./lib/workspace.ts";

/** `from "x"`, `import("x")`, `require("x")` — enough for this codebase. */
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)"([^\s"]+)"/g;

/**
 * Drop comments before scanning, so prose cannot look like an import. A JSDoc
 * block once contained ``…from "edge hidden by pagination."`` and was reported as
 * an undeclared package. Line comments are only stripped when `//` follows
 * whitespace, so `https://…` inside a string survives.
 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|\s)\/\/[^\n]*/g, "$1");
}

/** Walk every `.ts` file under a directory (no symlink chasing). */
function* typescriptFiles(dir: string): Generator<string> {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // no src/ (or unreadable) — nothing to check
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      yield* typescriptFiles(full);
    } else if (entry.name.endsWith(".ts")) {
      yield full;
    }
  }
}

/** The package a bare specifier resolves to: `@scope/name/sub` → `@scope/name`. */
function packageOf(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? specifier);
}

/** True when a specifier is not a package we should resolve (paths, builtins). */
function isIgnorable(specifier: string): boolean {
  return (
    specifier.startsWith(".") ||
    specifier.startsWith("/") ||
    specifier.startsWith("node:") ||
    specifier.startsWith("bun:") ||
    specifier.includes("://")
  );
}

interface Problem {
  pkg: string;
  message: string;
}

function checkPackage(dir: string): Problem[] {
  const pkg = readPackageJson(dir);
  const name = pkg.name;
  const declared = new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
  ]);
  const internal = Object.keys(pkg.dependencies ?? {}).filter((d) => d.startsWith("@adaptivemcp/"));

  const imported = new Set<string>();
  for (const file of typescriptFiles(join(REPO_ROOT, dir, "src"))) {
    const text = stripComments(readFileSync(file, "utf8"));
    for (const match of text.matchAll(SPECIFIER)) {
      const specifier = match[1];
      if (specifier === undefined || isIgnorable(specifier)) continue;
      imported.add(packageOf(specifier));
    }
  }

  const problems: Problem[] = [];
  for (const used of [...imported].sort()) {
    if (!declared.has(used)) {
      problems.push({
        pkg: name,
        message: `imports "${used}" but does not declare it (add it to dependencies/devDependencies, or use a relative import)`,
      });
    }
  }
  for (const dep of [...internal].sort()) {
    if (!imported.has(dep)) {
      problems.push({
        pkg: name,
        message: `declares "${dep}" but never imports it (drop it, or move it to devDependencies if only a test uses it)`,
      });
    }
  }
  return problems;
}

function main(): void {
  const problems = listPackageDirs().flatMap(checkPackage);
  if (problems.length === 0) {
    console.log(
      `deps check passed: ${listPackageDirs().length} packages — no undeclared imports, no unused declarations.`,
    );
    return;
  }
  console.error("[deps] the workspace dependency graph does not match the code:");
  for (const problem of problems) {
    console.error(`  ✗ ${problem.pkg}: ${problem.message}`);
  }
  console.error(`[deps] ${problems.length} problem(s).`);
  process.exit(1);
}

main();
