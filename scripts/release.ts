/**
 * scripts/release.ts — publish the core @adaptivemcp/* packages to npm.
 *
 * Flow:
 *   1. ensure a clean working tree (no accidental publishes of half-built state);
 *   2. build the publishable packages;
 *   3. run `changeset version` to apply pending changesets and bump versions;
 *   4. build again (version bump may change emitted code);
 *   5. `npm publish` each publishable package in dependency order.
 *
 * Only the core subset is published (see PUBLISHABLE_PACKAGES in lib/workspace):
 *   spec · memory · telemetry · evaluation · extension
 * `routing`, `orchestration`, `approval`, `thin-client` and the `examples`/
 * `apps` workspaces remain private for now.
 *
 * Usage:
 *   node scripts/release.ts            # full version + build + publish
 *   node scripts/release.ts --dry-run  # build + version, but do not publish
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
import { join } from "node:path";

const DRY_RUN = process.argv.includes("--dry-run");
const SKIP_VERSION = process.argv.includes("--no-version");
const TAG = process.argv.includes("--tag");

function main(): void {
  console.log(`[release] registry: ${npmRegistry()}`);
  console.log(`[release] packages: ${PUBLISHABLE_PACKAGES.join(", ")}`);

  if (isDirty()) {
    console.error(
      "[release] working tree is dirty. Commit or stash changes before releasing.",
    );
    process.exit(1);
  }

  // 1. Build publishable packages.
  pnpm(["-r", ...PUBLISHABLE_PACKAGES.flatMap((p) => ["--filter", p]), "run", "build"]);

  // 2. Apply pending changesets (bumps versions, updates CHANGELOG).
  if (!SKIP_VERSION) {
    pnpm(["changeset", "version"]);
  }

  // 3. Rebuild after version bump.
  pnpm(["-r", ...PUBLISHABLE_PACKAGES.flatMap((p) => ["--filter", p]), "run", "build"]);

  if (DRY_RUN) {
    console.log("[release] --dry-run: skipping publish.");
    return;
  }

  // 4. Publish each package in declared order.
  for (const pkg of PUBLISHABLE_PACKAGES) {
    const cwd = join(REPO_ROOT, "packages", pkg.replace("@adaptivemcp/", ""));
    console.log(`[release] publishing ${pkg}`);
    run("npm", ["publish", "--access", "public", "--ignore-scripts"], { cwd });
  }

  console.log("[release] done. Remember to push the version commit + tags.");

  // 5. Optionally commit the version bump and push the tag.
  if (TAG) {
    console.log("[release] --tag: committing version bump + pushing tag");
    run("node", [join(REPO_ROOT, "scripts", "version-release.ts")], { cwd: REPO_ROOT });
  }
}

main();
