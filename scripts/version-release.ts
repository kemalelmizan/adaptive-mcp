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
  gitSha,
} from "./lib/workspace.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const DRY_RUN = process.argv.includes("--dry-run");
const NO_PUSH = process.argv.includes("--no-push");

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
  if (isDirty()) {
    console.error(
      "[version-release] working tree is dirty. Run this only after `release.ts` " +
        "has bumped versions and you have reviewed the changes.",
    );
    process.exit(1);
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

  // 1. Commit the version bump + CHANGELOGs.
  run("git", ["add", "-A"], { cwd: REPO_ROOT });
  run("git", ["commit", "-m", message], { cwd: REPO_ROOT });

  // 2. Annotated tag.
  run("git", ["tag", "-a", tag, "-m", message], { cwd: REPO_ROOT });

  // 3. Push commit + tags.
  if (NO_PUSH) {
    console.log("[version-release] --no-push: commit + tag created locally; not pushed.");
    return;
  }
  run("git", ["push", "--follow-tags"], { cwd: REPO_ROOT });

  console.log(`[version-release] done. Pushed ${tag} (from ${gitSha()}).`);
}

main();
