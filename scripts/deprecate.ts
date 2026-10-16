/**
 * scripts/deprecate.ts — deprecate published @adaptivemcp/* versions that still
 * carry `workspace:` dependency specs on the registry.
 *
 * Context: an older release path published with `npm publish`, which ships
 * `workspace:*` verbatim, so those versions are uninstallable by consumers
 * (EUNSUPPORTEDPROTOCOL). npm versions are immutable — they can never be fixed
 * in place — so the remedy is to *deprecate* them with a pointer to a working
 * version. See #20.
 *
 * The set is computed from the registry (any version whose manifest declares a
 * `workspace:` dependency), so there is no hard-coded version list to drift.
 * Where a package's broken versions are exactly every version at or below the
 * highest broken one, they are deprecated with a single `<=X` range instead of
 * one call per version — which keeps a single 2FA OTP valid for the whole run.
 *
 * Usage:
 *   node scripts/deprecate.ts --dry-run            # list the plan (no auth, no changes)
 *   node scripts/deprecate.ts --otp <CODE>         # deprecate each (one OTP for all)
 *   node scripts/deprecate.ts --otp <CODE> --packages runtime,memory
 *   node scripts/deprecate.ts --otp <CODE> --message "use a newer version"
 *
 * Requires npm publish rights (an npm session or token). With 2FA on, pass
 * `--otp`/`NPM_OTP` — the code is reused across every `npm deprecate` call.
 */

import { PUBLISHABLE_PACKAGES, npmRegistry, runAsync } from "./lib/workspace.ts";

const DRY_RUN = process.argv.includes("--dry-run");
const OTP_INDEX = process.argv.indexOf("--otp");
const OTP = OTP_INDEX >= 0 ? process.argv[OTP_INDEX + 1] : process.env.NPM_OTP;
const MSG_INDEX = process.argv.indexOf("--message");
const MESSAGE =
  (MSG_INDEX >= 0 ? process.argv[MSG_INDEX + 1] : undefined) ??
  "broken workspace: dependency spec — install a newer version";
const PKG_INDEX = process.argv.indexOf("--packages");
const PACKAGES_ARG = PKG_INDEX >= 0 ? process.argv[PKG_INDEX + 1] : undefined;

const PUBLISHABLE = PUBLISHABLE_PACKAGES as readonly string[];

interface VersionManifest {
  dependencies?: Record<string, string>;
  deprecated?: string;
}

interface Packument {
  versions?: Record<string, VersionManifest>;
}

/** Parse `MAJOR.MINOR.PATCH[-pre]` into comparable parts. */
function parseVersion(v: string): [number, number, number, string] {
  const [core = "", pre = ""] = v.split("-", 2);
  const [maj = 0, min = 0, pat = 0] = core.split(".").map((n) => Number(n));
  return [maj, min, pat, pre];
}

/** Semver compare (prerelease sorts below its release). */
function compareVersions(a: string, b: string): number {
  const [a1, a2, a3, apre] = parseVersion(a);
  const [b1, b2, b3, bpre] = parseVersion(b);
  if (a1 !== b1) return a1 - b1;
  if (a2 !== b2) return a2 - b2;
  if (a3 !== b3) return a3 - b3;
  if (!apre && bpre) return 1;
  if (apre && !bpre) return -1;
  return apre < bpre ? -1 : apre > bpre ? 1 : 0;
}

/** A published version is "broken" when it declares a `workspace:` dependency. */
function hasWorkspaceDep(manifest: VersionManifest): boolean {
  return Object.values(manifest.dependencies ?? {}).some((spec) =>
    String(spec).startsWith("workspace:"),
  );
}

async function fetchPackument(pkg: string): Promise<Packument | null> {
  const url = `${npmRegistry()}${encodeURIComponent(pkg)}`;
  try {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) return null;
    return (await res.json()) as Packument;
  } catch {
    return null;
  }
}

/**
 * The deprecate spec for one package: a single `<=X` range when the broken
 * versions are exactly the prefix at or below the highest broken one, else one
 * spec per broken version.
 */
function deprecationSpecs(pkg: string, packument: Packument): string[] {
  const versions = Object.keys(packument.versions ?? {});
  const broken = versions.filter((v) => hasWorkspaceDep(packument.versions![v]!));
  if (broken.length === 0) return [];

  const highestBroken = broken.reduce((a, b) => (compareVersions(a, b) >= 0 ? a : b));
  const atOrBelow = versions.filter((v) => compareVersions(v, highestBroken) <= 0);
  const isCleanPrefix = atOrBelow.length === broken.length;

  if (isCleanPrefix) return [`${pkg}@<=${highestBroken}`];
  return broken.sort(compareVersions).map((v) => `${pkg}@${v}`);
}

async function main(): Promise<void> {
  if (!DRY_RUN && !OTP) {
    console.error(
      "[deprecate] an OTP is required to deprecate (2FA). Pass --otp <CODE> or set NPM_OTP.\n" +
        "[deprecate] run with --dry-run to preview the plan without authenticating.",
    );
    process.exit(1);
  }

  const packages = PACKAGES_ARG
    ? PACKAGES_ARG.split(",")
        .map((s) => s.trim())
        .map((s) => (s.startsWith("@adaptivemcp/") ? s : `@adaptivemcp/${s}`))
        .filter(Boolean)
    : [...PUBLISHABLE];

  const invalid = packages.filter((p) => !PUBLISHABLE.includes(p));
  if (invalid.length > 0) {
    console.error(`[deprecate] unknown package(s): ${invalid.join(", ")}`);
    process.exit(1);
  }

  console.log(`[deprecate] registry: ${npmRegistry()}`);
  console.log(`[deprecate] mode: ${DRY_RUN ? "dry-run (list only)" : "deprecate"}`);
  console.log(`[deprecate] message: ${MESSAGE}`);

  const planned: string[] = [];
  for (const pkg of packages) {
    const packument = await fetchPackument(pkg);
    if (!packument) {
      console.log(`[deprecate]   ? ${pkg}: not on the registry — skipped`);
      continue;
    }
    const specs = deprecationSpecs(pkg, packument);
    if (specs.length === 0) {
      console.log(`[deprecate]   = ${pkg}: no workspace: versions — nothing to do`);
      continue;
    }
    planned.push(...specs);
    const shown = specs.map((s) => s.slice(pkg.length + 1)).join(", ");
    console.log(`[deprecate]   • ${pkg}: ${shown}`);
  }

  if (planned.length === 0) {
    console.log("[deprecate] nothing to deprecate.");
    return;
  }

  if (DRY_RUN) {
    console.log(`[deprecate] dry-run: would deprecate ${planned.length} spec(s).`);
    return;
  }

  // Sequential on purpose: the same OTP is reused across calls, and deprecate
  // is cheap. Report per-spec so a mid-run failure is obvious.
  let ok = 0;
  const failed: string[] = [];
  for (const spec of planned) {
    try {
      await runAsync("npm", ["deprecate", spec, MESSAGE, "--otp", OTP!]);
      console.log(`[deprecate]   ✓ ${spec}`);
      ok += 1;
    } catch (error) {
      const e = error as { stderr?: string; message?: string };
      const detail = `${e.stderr ?? ""}\n${e.message ?? ""}`
        .trim()
        .split("\n")
        .slice(-2)
        .join(" | ");
      console.log(`[deprecate]   ✗ ${spec} — ${detail}`);
      failed.push(spec);
    }
  }

  console.log(`[deprecate] deprecated ${ok}, failed ${failed.length}`);
  if (failed.length > 0) {
    console.error("[deprecate] FAILED:", failed.join(", "));
    console.error("[deprecate] re-run with a fresh OTP: node scripts/deprecate.ts --otp <CODE>");
    process.exit(1);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
