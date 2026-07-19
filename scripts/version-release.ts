/**
 * scripts/version-release.ts — commit the version bump and push tags to GitHub.
 *
 * `release.ts` publishes to npm but deliberately does NOT touch git history
 * (so the version bump and the publish stay independent). This script closes
 * that gap: after a successful publish, run it to record the release as a
 * commit + annotated tag and push both to the remote.
 *
 * It derives the release version from the published packages (the highest
 * `version` among PUBLISHABLE_PACKAGES) and uses it for the tag/commit message.
 *
 * Usage:
 *   node scripts/version-release.ts            # commit + tag + push --follow-tags
 *   node scripts/version-release.ts --dry-run  # show what would happen, no push
 *   node scripts/version-release.ts --no-push  # commit + tag, but do not push
 *
 * Requires: a clean working tree (the version bump from `release.ts` must be
 * the only change) and a configured git remote.
 */

import {
  PUBLISHABLE_PACKAGES,
  REPO_ROOT,
  run,
  isDirty,
  dirtyFiles,
  gitSha,
} from "./lib/workspace.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const DRY_RUN = process.argv.includes("--dry-run");
const NO_PUSH = process.argv.includes("--no-push");

/**
 * `release.ts` starts on a clean tree and the only thing that dirties it is
 * `changeset version`, which only ever modifies `package.json`, `CHANGELOG.md`,
 * and consumes `.changeset/*.md` files (across every package in the changeset,
 * including private ones). Any dirty file outside that set means there is
 * unrelated WIP and we must refuse to commit.
 */
function isExpectedBumpFile(file: string): boolean {
  if (file === "package.json" || file === "CHANGELOG.md") return true;
  if (file.endsWith("/package.json") || file.endsWith("/CHANGELOG.md")) return true;
  if (file.startsWith(".changeset/")) return true;
  return false;
}

/** True when every dirty file is part of the expected version bump. */
function onlyBumpIsDirty(): boolean {
  return dirtyFiles().every(isExpectedBumpFile);
}

/** Read the current version of a package from its package.json. */
function packageVersion(pkg: string): string {
  const file = join(REPO_ROOT, "packages", pkg.replace("@adaptivemcp/", ""), "package.json");
  const json = JSON.parse(readFileSync(file, "utf8")) as { version: string };
  return json.version;
}

/** Highest semver among the publishable packages (the release version). */
function releaseVersion(): string {
  const versions = PUBLISHABLE_PACKAGES.map(packageVersion);
  return versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0];
}

function main(): void {
  if (isDirty() && !onlyBumpIsDirty()) {
    console.error(
      "[version-release] working tree is dirty with unexpected changes. " +
        "Only the version bump (package.json/CHANGELOG.md under packages/* and " +
        "consumed .changeset files) is allowed. Stash or commit other changes first.",
    );
    process.exit(1);
  }
  if (isDirty()) {
    console.log("[version-release] working tree has the expected version bump; proceeding to commit it.");
  }

  const version = releaseVersion();
  const tag = `v${version}`;
  const message = `release: @adaptivemcp/* ${tag}`;

  console.log(`[version-release] release version: ${version}`);
  console.log(`[version-release] tag: ${tag}`);
  console.log(`[version-release] message: ${message}`);

  if (DRY_RUN) {
    console.log("[version-release] --dry-run: no git operations performed.");
    return;
  }

  // 1. Commit the version bump + CHANGELOGs (only if there is something to commit).
  run("git", ["add", "-A"], { cwd: REPO_ROOT });
  const staged = run("git", ["diff", "--cached", "--name-only"], { cwd: REPO_ROOT, silent: true }).trim();
  if (staged.length === 0) {
    console.log("[version-release] nothing staged to commit; skipping commit.");
  } else {
    run("git", ["commit", "-m", message], { cwd: REPO_ROOT });
  }

  // 2. Annotated tag (skip if it already exists — e.g. a re-run with no new
  //    version bump, or a re-tag after an interrupted push).
  const tagExists = run("git", ["tag", "-l", tag], { silent: true }).trim() === tag;
  if (tagExists) {
    console.log(`[version-release] tag ${tag} already exists; skipping tag creation.`);
  } else {
    run("git", ["tag", "-a", tag, "-m", message], { cwd: REPO_ROOT });
  }

  // 3. Push commit + tags.
  if (NO_PUSH) {
    console.log("[version-release] --no-push: commit + tag created locally; not pushed.");
    return;
  }
  run("git", ["push", "--follow-tags"], { cwd: REPO_ROOT });

  console.log(`[version-release] done. Pushed ${tag} (from ${gitSha()}).`);
}

main();
