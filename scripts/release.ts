/**
 * scripts/release.ts — publish the core @adaptivemcp/* packages to npm.
 *
 * Flow:
 *   1. ensure a clean working tree (no accidental publishes of half-built state);
 *   2. run `changeset version` to apply pending changesets and bump versions;
 *   3. build the publishable packages ONCE (after the bump, so the 2FA OTP
 *      stays fresh for the publish step — the OTP is time-limited);
 *   4. `npm publish` each publishable package in dependency order, skipping
 *      any version that is already on the registry (resume-safe).
 *
 * Only the core subset is published (see PUBLISHABLE_PACKAGES in lib/workspace):
 *   spec · memory · telemetry · evaluation · extension
 * `routing`, `orchestration`, `approval`, `thin-client` and the `examples`/
 * `apps` workspaces remain private for now.
 *
 * Usage:
 *   node scripts/release.ts            # full version + build + publish
 *   node scripts/release.ts --dry-run  # build + preview pending changesets; no version bump, no publish
 *   node scripts/release.ts --no-version # skip changeset version (publish as-is)
 *   node scripts/release.ts --tag      # also commit the bump + push tag (via version-release.ts)
 *
 * Requires: `NPM_TOKEN` in the environment (or a logged-in npm session) and
 * network access to the registry. By default it never commits the version bump
 * — that is left to `scripts/version-release.ts` (or a Changesets release CI
 * workflow) to keep history clean. Pass `--tag` to do it in one flow.
 */

import {
  PUBLISHABLE_PACKAGES,
  REPO_ROOT,
  pnpm,
  run,
  isDirty,
  npmRegistry,
} from "./lib/workspace.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const DRY_RUN = process.argv.includes("--dry-run");
const SKIP_VERSION = process.argv.includes("--no-version");
const TAG = process.argv.includes("--tag");
const OTP_INDEX = process.argv.indexOf("--otp");
const OTP = OTP_INDEX >= 0 ? process.argv[OTP_INDEX + 1] : undefined;

/** True when `pkg@version` already exists on the registry (resume-safe skip). */
function isPublished(pkg: string, version: string): boolean {
  try {
    const out = run("npm", ["view", `${pkg}@${version}`, "version"], { silent: true }).trim();
    return out === version;
  } catch {
    return false; // 404 / network error → treat as not published
  }
}

function main(): void {
  console.log(`[release] registry: ${npmRegistry()}`);
  console.log(`[release] packages: ${PUBLISHABLE_PACKAGES.join(", ")}`);

  if (isDirty()) {
    console.error(
      "[release] working tree is dirty. Commit or stash changes before releasing.",
    );
    process.exit(1);
  }

  if (DRY_RUN) {
    // True dry run: build + preview the pending changesets WITHOUT consuming
    // them or bumping versions. `changeset status` reads the changeset files
    // and prints the packages/versions that *would* change, leaving the working
    // tree untouched (no version bump, no CHANGELOG edit, no publish).
    console.log("[release] --dry-run: building + previewing pending changesets (no publish, no version bump)");
    pnpm(["-r", ...PUBLISHABLE_PACKAGES.flatMap((p) => ["--filter", p]), "run", "build"]);
    pnpm(["changeset", "status"]);
    console.log("[release] --dry-run: done. Working tree is unchanged; re-run without --dry-run to publish.");
    return;
  }

  // 1. Apply pending changesets (bumps versions, updates CHANGELOG).
  if (!SKIP_VERSION) {
    pnpm(["changeset", "version"]);
  }

  // 2. Build ONCE, after the version bump. The bump can change emitted code,
  //    and building here (rather than before *and* after) keeps the 2FA OTP
  //    fresh for the publish step below — the OTP is time-limited and the
  //    publish must happen promptly after the build finishes.
  pnpm(["-r", ...PUBLISHABLE_PACKAGES.flatMap((p) => ["--filter", p]), "run", "build"]);

  // 3. Publish each package in declared order. Already-published versions are
  //    skipped (resume-safe): if a prior run died mid-publish, re-running will
  //    not fail on the packages that already made it to the registry.
  for (const pkg of PUBLISHABLE_PACKAGES) {
    const cwd = join(REPO_ROOT, "packages", pkg.replace("@adaptivemcp/", ""));
    const version = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8")).version;
    if (isPublished(pkg, version)) {
      console.log(`[release] ${pkg}@${version} already published; skipping.`);
      continue;
    }
    console.log(`[release] publishing ${pkg}@${version}`);
    const args = ["publish", "--access", "public", "--ignore-scripts"];
    if (OTP) args.push("--otp", OTP);
    run("npm", args, { cwd });
  }

  console.log("[release] done. Remember to push the version commit + tags.");

  // 4. Optionally commit the version bump and push the tag.
  if (TAG) {
    console.log("[release] --tag: committing version bump + pushing tag");
    run("node", [join(REPO_ROOT, "scripts", "version-release.ts")], { cwd: REPO_ROOT });
  }
}

main();
