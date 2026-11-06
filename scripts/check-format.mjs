#!/usr/bin/env node
/**
 * Formatting gate for the files a change actually touches.
 *
 * The repository's committed tree predates the current prettier's output for markdown
 * bullets and long TS argument lists, and **no version in the declared range reproduces
 * it** (#49 measured 98–116 unformatted files across 3.3.3 / 3.5.3 / 3.7.4 / 3.9.5, and
 * 114 with `printWidth: 120`). So a repository-wide `prettier --check` cannot be a gate
 * without a ~100-file reformat, and a blanket `prettier --write` is the trap the same
 * issue describes.
 *
 * This gates the part that matters instead: a file must be formatted if it is new, or if
 * it was already formatted at the merge base. Files carrying pre-existing drift are
 * listed as a warning and left alone — which is the same rule the maintainers have been
 * applying by hand, now enforced by CI.
 *
 *   pnpm format:check                 # vs origin/main (falls back to main, then HEAD~1)
 *   FORMAT_BASE=<ref> pnpm format:check
 */
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const PRETTIER = require.resolve("prettier/bin/prettier.cjs");

/** Extensions prettier formats here; anything else is out of scope for this gate. */
const FORMATTED = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".yml",
  ".yaml",
];

const git = (args, options = {}) =>
  execFileSync("git", args, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], ...options });

const hasRef = (ref) => {
  try {
    git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
    return true;
  } catch {
    return false;
  }
};

/** The ref to compare against: an env override, then origin/main, then main, then HEAD~1. */
function baseRef() {
  const candidates = [process.env.FORMAT_BASE, "origin/main", "main", "HEAD~1"].filter(Boolean);
  const found = candidates.find(hasRef);
  return found ?? null;
}

/** Run prettier's check over stdin text; true when it is already formatted. */
function isFormatted(text, path) {
  try {
    execFileSync(process.execPath, [PRETTIER, "--check", "--stdin-filepath", path], {
      input: text,
      stdio: ["pipe", "ignore", "ignore"],
    });
    return true;
  } catch {
    return false;
  }
}

const base = baseRef();
if (!base) {
  console.log("[format] no base ref to compare against; nothing to check");
  process.exit(0);
}

const mergeBase = git(["merge-base", base, "HEAD"]).trim();
// Against the working tree, not HEAD, so this is usable before a commit; plus untracked
// files, which `git diff` never shows.
const tracked = git(["diff", "--name-only", "--diff-filter=ACMR", mergeBase]);
const untracked = git(["ls-files", "--others", "--exclude-standard"]);
const changed = `${tracked}\n${untracked}`
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean)
  .filter((file) => FORMATTED.some((ext) => file.endsWith(ext)));

if (changed.length === 0) {
  console.log(`[format] ${changed.length} formatted file(s) changed since ${base}; clean`);
  process.exit(0);
}

const violations = [];
const grandfathered = [];

for (const file of changed) {
  if (!existsSync(file)) continue; // deleted between the diff and here
  const current = readFileSync(file, "utf8");
  if (isFormatted(current, file)) continue;

  // Was it already unformatted at the merge base? Then the drift is not this change's.
  let before = null;
  try {
    before = git(["show", `${mergeBase}:${file}`]);
  } catch {
    before = null; // a new file: it has no excuse
  }
  if (before !== null && !isFormatted(before, file)) {
    grandfathered.push(file);
    continue;
  }
  violations.push(file);
}

if (grandfathered.length > 0) {
  console.log(
    `[format] ${grandfathered.length} changed file(s) carry pre-existing drift and are not gated ` +
      `(#49):\n  ${grandfathered.join("\n  ")}`,
  );
}

if (violations.length > 0) {
  console.error(
    `[format] ${violations.length} file(s) need formatting. Run prettier on them:\n  ` +
      violations.join("\n  ") +
      `\n  pnpm exec prettier --write <file>`,
  );
  process.exit(1);
}

console.log(`[format] ${changed.length} changed formatted file(s) clean since ${base}`);
