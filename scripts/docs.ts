/**
 * Generate package documentation tables from `package.json` +
 * `PUBLISHABLE_PACKAGES`.
 *
 * The version column is a live shields.io badge (resolved from npm at render
 * time), and the name/description columns come straight from each package's
 * `package.json`. This keeps the docs single-sourced: add a package to
 * `PUBLISHABLE_PACKAGES` (and its `package.json`) and re-run `pnpm docs`.
 *
 * Tables live between marker comments so prose around them stays hand-written:
 *   <!-- packages:published:start --> ... <!-- packages:published:end -->
 *   <!-- packages:responsibilities:start --> ... <!-- packages:responsibilities:end -->
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  PUBLISHABLE_PACKAGES,
  REPO_ROOT,
  readPackageJson,
  type PackageJson,
} from "./lib/workspace.ts";

// The docs site repo is a sibling of the `adaptive-mcp` repo at the
// workspace root. Optional; skip with a warning if absent.
const SITE_ROOT = resolve(REPO_ROOT, "..", "adaptivemcp.github.io");
// The GitHub profile README lives at the workspace root, outside the
// `adaptive-mcp` git repo. Optional; skip with a warning if absent.
const PROFILE_ROOT = resolve(REPO_ROOT, "..", ".github", "profile");

type Pkg = PackageJson & { dir: string };

function loadPublishable(): Pkg[] {
  return PUBLISHABLE_PACKAGES.map((name) => {
    const dir = join("packages", name.replace("@adaptivemcp/", ""));
    return { ...readPackageJson(dir), dir };
  });
}

function badge(name: string): string {
  return `[![npm](https://img.shields.io/npm/v/${name})](https://www.npmjs.com/package/${name})`;
}

function publishedTable(pkgs: Pkg[]): string {
  const rows = pkgs.map((p) => {
    const name = p.name;
    const desc = p.description ?? "";
    return `| \`${name}\` | ${badge(name)} | \`npm i ${name}\` | ${desc} |`;
  });
  return [
    "| Package | Version | Install | Description |",
    "| --- | --- | --- | --- |",
    ...rows,
  ].join("\n");
}

function responsibilitiesTable(pkgs: Pkg[]): string {
  const rows = pkgs.map((p) => `| \`${p.name}\` | ${p.description ?? ""} |`);
  return [
    "| Package | Responsibility |",
    "| --- | --- |",
    ...rows,
  ].join("\n");
}

/** Replace the text between `<!-- marker:start -->` and `<!-- marker:end -->`. */
function replaceRegion(file: string, marker: string, content: string): void {
  const path = resolve(file);
  const text = readFileSync(path, "utf8");
  const startTag = `<!-- ${marker}:start -->`;
  const endTag = `<!-- ${marker}:end -->`;
  const i = text.indexOf(startTag);
  const j = text.indexOf(endTag);
  if (i === -1 || j === -1 || j < i) {
    throw new Error(`markers "${marker}" not found in ${path}`);
  }
  const before = text.slice(0, i + startTag.length);
  const after = text.slice(j);
  writeFileSync(path, `${before}\n${content}\n${after}`);
  console.log(`[docs] updated ${path} (${marker})`);
}

function main(): void {
  const pkgs = loadPublishable();
  const published = publishedTable(pkgs);
  const responsibilities = responsibilitiesTable(pkgs);

  // Main repo README + GitHub profile README (published table only).
  replaceRegion(join(REPO_ROOT, "README.md"), "packages:published", published);
  const profileReadme = join(PROFILE_ROOT, "README.md");
  if (existsSync(profileReadme)) {
    replaceRegion(profileReadme, "packages:published", published);
  } else {
    console.warn(`[docs] skipping profile README: ${profileReadme} not found`);
  }

  // Site docs (separate repo, sibling of this one).
  if (existsSync(SITE_ROOT)) {
    replaceRegion(
      join(SITE_ROOT, "docs", "packages.md"),
      "packages:published",
      published,
    );
    replaceRegion(
      join(SITE_ROOT, "docs", "packages.md"),
      "packages:responsibilities",
      responsibilities,
    );
  } else {
    console.warn(`[docs] skipping site docs: ${SITE_ROOT} not found`);
  }

  console.log("[docs] done");
}

main();
