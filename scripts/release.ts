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
 *   1. ensure a clean working tree (or, with `--continue`, a tree that holds
 *      only the version bump from a previous interrupted run);
 *   2. require at least one pending changeset (unless `--no-version`,
 *      `--continue`, or `--packages`);
 *   3. run `changeset version` to apply pending changesets and bump versions
 *      (skipped with `--no-version` / `--continue` / `--packages`);
 *   4. publish every publishable package whose version is not yet on the
 *      registry, in dependency waves (parallel within a wave, dependencies
 *      first), skipping already-published versions (resume-safe).
 *
 * Publishable set (defined once in scripts/lib/workspace.ts →
 * PUBLISHABLE_PACKAGES): spec · memory · telemetry · evaluation · extension ·
 * runtime · routing · orchestration · approval · thin-client · middleware ·
 * mcp-binary. `examples` and `apps` stay private.
 *
 * Usage:
 *   pnpm build:publishable            # SEPARATE step: build dist/ (no OTP)
 *   node scripts/release.ts           # version + publish every unpublished package
 *   node scripts/release.ts --dry-run # preview pending changesets; no mutation
 *   node scripts/release.ts --continue --otp <NEW_CODE>  # resume a failed release
 *   node scripts/release.ts --no-version # skip version; publish all publishable
 *   node scripts/release.ts --packages extension,runtime --otp <CODE> # only these
 *   node scripts/release.ts --tag     # also commit the bump + push the tag
 *
 * Requires: `NPM_TOKEN` in the environment (or a logged-in npm session), network
 * access to the registry, and — when 2FA is enabled — a fresh `--otp`/`NPM_OTP`.
 * The OTP is reused across the parallel publishes within a wave; if it expires,
 * the run reports exactly which packages failed and `--continue --otp <NEW>`
 * resumes from where it stopped.
 *
 * Note: the npm registry is eventually consistent, so right after a publish
 * `isPublished()` can still read a version as missing. A resulting
 * `EPUBLISHCONFLICT` is treated as "already published" (skipped), never as a
 * failure.
 */

import {
  PUBLISHABLE_PACKAGES,
  REPO_ROOT,
  pnpm,
  run,
  runAsync,
  isDirty,
  onlyBumpIsDirty,
  npmRegistry,
  changesetStatus,
  readPackageJson,
} from "./lib/workspace.ts";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const CHANGESET_DIR = join(REPO_ROOT, ".changeset");

const DRY_RUN = process.argv.includes("--dry-run");
const SKIP_VERSION = process.argv.includes("--no-version");
const CONTINUE = process.argv.includes("--continue");
const TAG = process.argv.includes("--tag");
const OTP_INDEX = process.argv.indexOf("--otp");
const OTP = OTP_INDEX >= 0 ? process.argv[OTP_INDEX + 1] : undefined;
const PKG_INDEX = process.argv.indexOf("--packages");
const PACKAGES_ARG = PKG_INDEX >= 0 ? process.argv[PKG_INDEX + 1] : undefined;

const PUBLISHABLE = PUBLISHABLE_PACKAGES as readonly string[];

function packageDir(pkg: string): string {
  return join(REPO_ROOT, "packages", pkg.replace("@adaptivemcp/", ""));
}

function packageVersion(pkg: string): string {
  const json = JSON.parse(readFileSync(join(packageDir(pkg), "package.json"), "utf8")) as {
    version: string;
  };
  return json.version;
}

/** True when `pkg@version` already exists on the registry (resume-safe skip). */
async function isPublished(pkg: string, version: string): Promise<boolean> {
  try {
    const out = (await runAsync("npm", ["view", `${pkg}@${version}`, "version"])).trim();
    return out === version;
  } catch {
    return false; // 404 / network error → treat as not published
  }
}

/**
 * Publishable packages named in pending changeset files. Used as the "is there
 * anything to release?" guard and for the log label — NOT as the publish set.
 * The actual publish set is every publishable package whose current version is
 * not yet on the registry, which also covers internal dependents cascaded by
 * Changesets and first-time publishes.
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
  return [...names].filter((p) => PUBLISHABLE.includes(p));
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
  const invalid = wanted.filter((p) => !PUBLISHABLE.includes(p));
  if (invalid.length > 0) {
    console.error(
      `[release] --packages contains unknown package(s): ${invalid.join(", ")}.\n` +
        `[release] valid packages: ${PUBLISHABLE_PACKAGES.join(", ")}`,
    );
    process.exit(1);
  }
  return wanted;
}

/** Internal @adaptivemcp dependencies of a publishable package. */
function internalDeps(pkg: string): string[] {
  const json = readPackageJson(join("packages", pkg.replace("@adaptivemcp/", "")));
  return Object.keys(json.dependencies ?? {}).filter((dep) => PUBLISHABLE.includes(dep));
}

/**
 * Topologically sort the publishable packages into dependency waves: every
 * package in wave N depends only on packages in waves < N. Publishing wave by
 * wave (parallel within a wave) keeps dependencies first, so a dependent's
 * `latest` never references a dependency version that isn't on npm yet.
 */
function buildWaves(): string[][] {
  const deps = new Map([...PUBLISHABLE_PACKAGES].map((p) => [p, internalDeps(p)]));
  const remaining = new Set<string>([...PUBLISHABLE_PACKAGES]);
  const done = new Set<string>();
  const waves: string[][] = [];
  while (remaining.size > 0) {
    const wave = [...remaining].filter((p) =>
      (deps.get(p) ?? []).every((dep) => done.has(dep) || !remaining.has(dep)),
    );
    if (wave.length === 0) {
      waves.push([...remaining]); // cycle guard (should not happen)
      break;
    }
    for (const p of wave) {
      remaining.delete(p);
      done.add(p);
    }
    waves.push(wave);
  }
  return waves;
}

interface PublishResult {
  pkg: string;
  version: string;
  status: "published" | "skipped" | "failed";
  error?: string;
}

async function publishOne(pkg: string): Promise<PublishResult> {
  const version = packageVersion(pkg);
  if (await isPublished(pkg, version)) {
    return { pkg, version, status: "skipped" };
  }
  const args = ["publish", "--access", "public", "--ignore-scripts"];
  if (OTP) args.push("--otp", OTP);
  try {
    await runAsync("npm", args, { cwd: packageDir(pkg) });
    return { pkg, version, status: "published" };
  } catch (error) {
    const e = error as { stderr?: string; message?: string };
    const raw = `${e.stderr ?? ""}\n${e.message ?? ""}`;
    // The registry is eventually consistent: a just-published version can read
    // as missing (isPublished false), so we attempt a publish that npm rejects
    // as a conflict. That is NOT a failure — the version is already on npm.
    if (/EPUBLISHCONFLICT|previously published|cannot publish over/i.test(raw)) {
      return { pkg, version, status: "skipped" };
    }
    const detail = raw.trim().split("\n").slice(-4).join(" | ");
    return { pkg, version, status: "failed", error: detail };
  }
}

/** Publish all candidate packages, wave by wave, and report per-package results. */
async function publishAll(candidates: string[]): Promise<PublishResult[]> {
  const waves = buildWaves();
  const results: PublishResult[] = [];
  for (const [index, wave] of waves.entries()) {
    const due = wave.filter((p) => candidates.includes(p));
    if (due.length === 0) continue;
    console.log(`[release] wave ${index + 1}/${waves.length} (${due.length}): ${due.join(", ")}`);
    const settled = await Promise.all(due.map((pkg) => publishOne(pkg)));
    for (const result of settled) {
      const icon = result.status === "published" ? "✓" : result.status === "skipped" ? "=" : "✗";
      const suffix = result.status === "failed" ? ` — ${result.error}` : "";
      console.log(`[release]   ${icon} ${result.pkg}@${result.version}${suffix}`);
    }
    results.push(...settled);
  }
  return results;
}

async function main(): Promise<void> {
  console.log(`[release] registry: ${npmRegistry()}`);
  console.log(`[release] packages: ${PUBLISHABLE_PACKAGES.join(", ")}`);

  if (DRY_RUN) {
    // True dry run: preview the pending changesets WITHOUT consuming them or
    // bumping versions. Build separately with `pnpm build:publishable` first.
    console.log("[release] --dry-run: previewing pending changesets (no build, no publish, no version bump)");
    changesetStatus();
    console.log("[release] --dry-run: publish waves (dependency order, parallel within a wave):");
    for (const [index, wave] of buildWaves().entries()) {
      console.log(`[release]   wave ${index + 1}: ${wave.join(", ")}`);
    }
    console.log(
      "[release] --dry-run: done. Build separately with `pnpm build:publishable`, " +
        "then re-run without --dry-run to publish every unpublished package.",
    );
    return;
  }

  if (isDirty() && !(CONTINUE && onlyBumpIsDirty())) {
    console.error(
      "[release] working tree is dirty. Commit or stash changes before releasing " +
        "(with --continue, a tree holding only the version bump is allowed).",
    );
    process.exit(1);
  }
  if (isDirty()) {
    console.log("[release] --continue: tree holds the version bump; resuming the release.");
  }

  const packagesArg = PACKAGES_ARG ? parsePackagesArg(PACKAGES_ARG) : undefined;
  const changed = changedPackages();

  if (!SKIP_VERSION && !CONTINUE && !packagesArg && changed.length === 0) {
    console.log(
      "[release] no pending changesets; nothing to publish. " +
        "Author a changeset, or pass --no-version to republish all publishable packages.",
    );
    return;
  }

  const candidates = packagesArg ?? [...PUBLISHABLE_PACKAGES];
  const mode = CONTINUE
    ? "continue (resume a failed release)"
    : packagesArg
      ? "manual --packages"
      : SKIP_VERSION
        ? "no-version (skip changeset version)"
        : "version (apply changesets)";
  console.log(`[release] mode: ${mode}`);
  if (!packagesArg) {
    console.log(`[release] changesets: ${changed.length > 0 ? changed.join(", ") : "(none)"}`);
  }

  // Apply pending changesets (skipped with --no-version / --continue / --packages).
  if (!SKIP_VERSION && !CONTINUE && !packagesArg) {
    pnpm(["changeset", "version"]);
  }

  const results = await publishAll(candidates);
  const published = results.filter((r) => r.status === "published");
  const skipped = results.filter((r) => r.status === "skipped");
  const failed = results.filter((r) => r.status === "failed");

  console.log(
    `[release] published ${published.length}, skipped ${skipped.length} (already on npm), failed ${failed.length}`,
  );

  if (failed.length > 0) {
    console.error(`[release] FAILED: ${failed.map((f) => `${f.pkg}@${f.version}`).join(", ")}`);
    console.error("[release] not tagging. Fix the cause (e.g. a fresh OTP), then resume with:");
    console.error("[release]   node scripts/release.ts --continue --otp <NEW_CODE>");
    process.exit(1);
  }

  console.log("[release] done.");
  if (TAG) {
    console.log("[release] --tag: committing version bump + pushing tag");
    run("node", [join(REPO_ROOT, "scripts", "version-release.ts"), "--packages", candidates.join(",")], {
      cwd: REPO_ROOT,
    });
  } else {
    console.log("[release] remember to push the version commit + tags (or re-run with --tag).");
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
