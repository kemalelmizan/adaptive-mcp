/**
 * scripts/version-release.ts — commit the version bump and push tags to GitHub.
 *
 * `release.ts` publishes to npm but deliberately does NOT touch git history
 * (so the version bump and the publish stay independent). This script closes
 * that gap: after a successful publish, run it to record the release as a
 * commit + annotated tag and push both to the remote.
 *
 * It derives the release version from the published packages (the highest
 * `version` among the explicitly-changed packages) and uses it for the tag/
 * commit message. When run standalone (Flow B), pass the changed packages via
 * `--packages spec,memory` so the tag reflects the right version; without it,
 * it falls back to the highest version among PUBLISHABLE_PACKAGES.
 *
 * Before touching git it verifies that every package in scope is on npm (the
 * registry is polled briefly — it lags a publish by seconds). The tag is a claim
 * about the registry, so a version that is missing refuses the tag rather than
 * recording a release nobody can install. `--skip-verify` tags anyway, for when
 * the registry itself cannot be read.
 *
 * Usage:
 *   node scripts/version-release.ts                       # commit + tag + push --follow-tags
 *   node scripts/version-release.ts --packages spec,memory # scope the version to these
 *   node scripts/version-release.ts --dry-run             # show what would happen, no push
 *   node scripts/version-release.ts --no-push             # commit + tag, but do not push
 *   node scripts/version-release.ts --skip-verify         # tag without checking npm
 *
 * Requires: a clean working tree (the version bump from `release.ts` must be
 * the only change) and a configured git remote.
 */

import {
  PUBLISHABLE_PACKAGES,
  REPO_ROOT,
  run,
  isDirty,
  onlyBumpIsDirty,
  gitSha,
  findUnpublished,
  waitForPublished,
} from "./lib/workspace.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const DRY_RUN = process.argv.includes("--dry-run");
const NO_PUSH = process.argv.includes("--no-push");
const SKIP_VERIFY = process.argv.includes("--skip-verify");
const PKG_INDEX = process.argv.indexOf("--packages");
const PACKAGES_ARG = PKG_INDEX >= 0 ? process.argv[PKG_INDEX + 1] : undefined;
const SCOPED_PACKAGES = PACKAGES_ARG
  ? PACKAGES_ARG.split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      // `--packages spec,memory` is documented in bare form; normalise so the
      // registry check and the tag message use the published names.
      .map((s) => (s.startsWith("@adaptivemcp/") ? s : `@adaptivemcp/${s}`))
  : undefined;

// `isExpectedBumpFile` / `onlyBumpIsDirty` live in scripts/lib/workspace.ts and
// are shared with release.ts (`--continue`).

/** Read the current version of a package from its package.json. */
function packageVersion(pkg: string): string {
  const file = join(REPO_ROOT, "packages", pkg.replace("@adaptivemcp/", ""), "package.json");
  const json = JSON.parse(readFileSync(file, "utf8")) as { version: string };
  return json.version;
}

/** Highest semver among the (scoped) packages — the release version. */
function releaseVersion(): string {
  const pkgs = SCOPED_PACKAGES ?? [...PUBLISHABLE_PACKAGES];
  const versions = pkgs.map(packageVersion);
  return versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0] ?? "0.0.0";
}

async function main(): Promise<void> {
  if (isDirty() && !onlyBumpIsDirty()) {
    console.error(
      "[version-release] working tree is dirty with unexpected changes. " +
        "Only the version bump (package.json/CHANGELOG.md under packages/* and " +
        "consumed .changeset files) is allowed. Stash or commit other changes first.",
    );
    process.exit(1);
  }
  if (isDirty()) {
    console.log(
      "[version-release] working tree has the expected version bump; proceeding to commit it.",
    );
  }

  // The tag claims a release happened. Nothing else verified that the packages
  // it names are installable: v0.6.0 was tagged while `memory@0.6.0` was never
  // published, because the publish-failure was worked around rather than
  // resumed. Check before any git operation, so a gap costs nothing to fix.
  const scope = SCOPED_PACKAGES ?? [...PUBLISHABLE_PACKAGES];
  if (SKIP_VERIFY) {
    console.log("[version-release] --skip-verify: tagging without checking the registry");
  } else {
    // A dry run reports the gaps as they are now; a real run gives the registry
    // a moment to catch up with the publish it was just asked to serve.
    const missing = DRY_RUN ? await findUnpublished(scope) : await waitForPublished(scope);
    if (missing.length > 0) {
      console.error(
        `[version-release] refusing to tag: ${missing.length} version(s) are not on the registry:`,
      );
      for (const m of missing) console.error(`[version-release]   ${m.pkg}@${m.version}`);
      console.error(
        "[version-release] publish them first (the registry is eventually consistent, so " +
          "re-check before concluding a publish failed), then re-run:",
      );
      console.error("[version-release]   node scripts/release.ts --continue --otp <CODE>");
      console.error("[version-release] (registry unreachable? pass --skip-verify to tag anyway)");
      process.exit(1);
    }
    console.log(`[version-release] verified ${scope.length} package version(s) on the registry`);
  }

  const version = releaseVersion();
  const tag = `v${version}`;
  const message = `release: @adaptivemcp/* ${tag}`;

  console.log(`[version-release] release version: ${version}`);
  console.log(`[version-release] tag: ${tag}`);
  console.log(`[version-release] message: ${message}`);

  if (DRY_RUN) {
    console.log(
      `[version-release] --dry-run: would tag ${tag} from ` +
        (SCOPED_PACKAGES ? SCOPED_PACKAGES.join(", ") : "all publishable packages") +
        ". No git operations performed.",
    );
    return;
  }

  // 1. Commit the version bump + CHANGELOGs (only if there is something to commit).
  run("git", ["add", "-A"], { cwd: REPO_ROOT });
  const staged = run("git", ["diff", "--cached", "--name-only"], {
    cwd: REPO_ROOT,
    silent: true,
  }).trim();
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

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
