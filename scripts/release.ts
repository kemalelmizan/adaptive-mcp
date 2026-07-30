/**
 * scripts/release.ts — publish the core @adaptivemcp/* packages to npm.
 *
 * IMPORTANT: this script does NOT build. Building is a separate, slow step that
 * does not need the npm 2FA OTP, so it is kept out of the publish path. Run
 * `pnpm build:publishable` (scripts/build.ts) BEFORE this script so the `dist/`
 * outputs already exist on disk; this script only bumps versions and calls
 * `npm publish`.
 *
 * Flow:
 *   1. ensure a clean working tree (no accidental publishes of half-built state);
 *   2. determine the publish set — ONLY the packages named in pending
 *      changesets (not every publishable package);
 *   3. run `changeset version` to apply pending changesets and bump versions;
 *   4. `npm publish` each package in the publish set, in dependency order,
 *      skipping any version that is already on the registry (resume-safe).
 *
 * Publishable set (defined once in scripts/lib/workspace.ts →
 * PUBLISHABLE_PACKAGES): spec · memory · telemetry · evaluation · extension ·
 * runtime · routing · orchestration · approval · thin-client · middleware ·
 * mcp-binary. `examples` and `apps` stay private.
 *
 * Usage:
 *   pnpm build:publishable            # SEPARATE step: build dist/ (no OTP)
 *   node scripts/release.ts           # version + publish only the changed packages
 *   node scripts/release.ts --dry-run # preview pending changesets; no build, no publish
 *   node scripts/release.ts --no-version # skip changeset version; publish ALL publishable pkgs
 *   node scripts/release.ts --packages extension,runtime --otp <CODE> # publish ONLY these (manual)
 *   node scripts/release.ts --tag     # also commit the bump + push tag (via version-release.ts)
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
  changesetStatus,
} from "./lib/workspace.ts";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const CHANGESET_DIR = join(REPO_ROOT, ".changeset");

const DRY_RUN = process.argv.includes("--dry-run");
const SKIP_VERSION = process.argv.includes("--no-version");
const TAG = process.argv.includes("--tag");
const OTP_INDEX = process.argv.indexOf("--otp");
const OTP = OTP_INDEX >= 0 ? process.argv[OTP_INDEX + 1] : undefined;
const PKG_INDEX = process.argv.indexOf("--packages");
const PACKAGES_ARG = PKG_INDEX >= 0 ? process.argv[PKG_INDEX + 1] : undefined;

/** True when `pkg@version` already exists on the registry (resume-safe skip). */
function isPublished(pkg: string, version: string): boolean {
  try {
    const out = run("npm", ["view", `${pkg}@${version}`, "version"], { silent: true }).trim();
    return out === version;
  } catch {
    return false; // 404 / network error → treat as not published
  }
}

/**
 * Packages named in pending changeset files — the EXPLICIT release set. We
 * publish only these, not every publishable package. Changeset frontmatter
 * lists one `"<pkg>": <bump>` line per affected package.
 */
function changedPackages(): string[] {
  if (!existsSync(CHANGESET_DIR)) return [];
  const names = new Set<string>();
  for (const file of readdirSync(CHANGESET_DIR)) {
    if (!file.endsWith(".md") || file === "README.md") continue;
    const text = readFileSync(join(CHANGESET_DIR, file), "utf8");
    const fm = text.match(/^---\n([\s\S]*?)\n---/);
    if (!fm) continue;
    for (const line of fm[1].split("\n")) {
      const m = line.match(/^\s*"([^"]+)":\s*(patch|minor|major)\s*$/);
      if (m) names.add(m[1]);
    }
  }
  // Only publishable packages are released by this script.
  return [...names].filter((p) => (PUBLISHABLE_PACKAGES as readonly string[]).includes(p));
}

/**
 * Parse + validate a `--packages a,b` argument into a publish set. Accepts
 * bare names (`extension`) or fully-qualified (`@adaptivemcp/extension`).
 * Exits with a clear error if any named package is not in PUBLISHABLE_PACKAGES.
 */
function parsePackagesArg(raw: string): string[] {
  const wanted = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (s.startsWith("@adaptivemcp/") ? s : `@adaptivemcp/${s}`));
  const invalid = wanted.filter((p) => !(PUBLISHABLE_PACKAGES as readonly string[]).includes(p));
  if (invalid.length > 0) {
    console.error(
      `[release] --packages contains unknown package(s): ${invalid.join(", ")}.\n` +
        `[release] valid packages: ${PUBLISHABLE_PACKAGES.join(", ")}`,
    );
    process.exit(1);
  }
  return wanted;
}

function main(): void {
  console.log(`[release] registry: ${npmRegistry()}`);
  console.log(`[release] packages: ${PUBLISHABLE_PACKAGES.join(", ")}`);

  if (DRY_RUN) {
    // True dry run: preview the pending changesets WITHOUT consuming them or
    // bumping versions. `changeset status` reads the changeset files and prints
    // the packages/versions that *would* change, leaving the working tree
    // untouched (no version bump, no CHANGELOG edit, no build, no publish).
    // Build separately with `pnpm build:publishable` before the real release.
    console.log("[release] --dry-run: previewing pending changesets (no build, no publish, no version bump)");
    changesetStatus();
    console.log(
      "[release] --dry-run: done. Build separately with `pnpm build:publishable`, " +
        "then re-run without --dry-run to publish only the changed packages.",
    );
    return;
  }

  if (isDirty()) {
    console.error(
      "[release] working tree is dirty. Commit or stash changes before releasing.",
    );
    process.exit(1);
  }

  // 1. Determine the publish set. By default we publish ONLY the packages named
  //    in pending changesets — not every publishable package. `--no-version` is
  //    the escape hatch for republishing: it skips the changeset step and
  //    publishes ALL publishable packages (already-published versions skip).
  //    `--packages a,b` is a manual override: publish ONLY the named packages
  //    (their current, already-bumped versions) and skip the changeset version
  //    step, so you can target one or two packages without bumping the rest.
  const packagesArg = PACKAGES_ARG ? parsePackagesArg(PACKAGES_ARG) : undefined;
  const toPublish = packagesArg
    ? packagesArg
    : SKIP_VERSION
      ? [...PUBLISHABLE_PACKAGES]
      : changedPackages();

  if (!SKIP_VERSION && !packagesArg && toPublish.length === 0) {
    console.log(
      "[release] no pending changesets; nothing to publish. " +
        "Author a changeset, or pass --no-version to republish all publishable packages.",
    );
    return;
  }

  const setLabel = packagesArg
    ? "manual --packages"
    : SKIP_VERSION
      ? "all publishable"
      : "changed-only";
  console.log(`[release] publishing (${setLabel}): ${toPublish.join(", ")}`);

  // 2. Apply pending changesets (bumps versions, updates CHANGELOG). Skipped
  //    when `--no-version` (republish) or `--packages` (manual targeted publish
  //    of already-bumped versions) is given.
  if (!SKIP_VERSION && !packagesArg) {
    pnpm(["changeset", "version"]);
  }

  // 3. Publish each package in the publish set, in declared dependency order.
  //    Already-published versions are skipped (resume-safe): if a prior run
  //    died mid-publish, re-running will not fail on packages already on the
  //    registry. The build is NOT done here — dist/ must already exist from the
  //    separate `pnpm build:publishable` step.
  for (const pkg of PUBLISHABLE_PACKAGES) {
    if (!toPublish.includes(pkg)) continue;
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
    const scoped = toPublish.join(",");
    run("node", [join(REPO_ROOT, "scripts", "version-release.ts"), "--packages", scoped], {
      cwd: REPO_ROOT,
    });
  }
}

main();
