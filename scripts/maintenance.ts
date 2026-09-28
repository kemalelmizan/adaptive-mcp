/**
 * scripts/maintenance.ts — repo hygiene + status report for Adaptive MCP.
 *
 * Subcommands:
 *   node scripts/maintenance.ts status     # package versions, dirty tree, dist state
 *   node scripts/maintenance.ts stale-dist # list packages whose dist/ is missing
 *   node scripts/maintenance.ts docs       # doc/plan consistency guard (check-docs.ts)
 *   node scripts/maintenance.ts check      # docs + build + lint + test (CI gate)
 *   node scripts/maintenance.ts outdated   # pnpm outdated for the workspace
 *
 * These are read-only or CI-style checks; none of them publish or rewrite
 * source. Use `release.ts` for distribution.
 */

import {
  PUBLISHABLE_PACKAGES,
  listPackageDirs,
  readPackageJson,
  hasDist,
  run,
  pnpm,
  isDirty,
  gitSha,
} from "./lib/workspace.ts";

type Command = "status" | "stale-dist" | "docs" | "check" | "outdated";

const command = (process.argv[2] as Command) ?? "status";

function reportStatus(): void {
  console.log(`workspace @ ${gitSha()}  dirty=${isDirty()}`);
  for (const dir of listPackageDirs()) {
    const pkg = readPackageJson(dir);
    const built = hasDist(dir) ? "built" : "NO DIST";
    const flag = pkg.private ? " (private)" : "";
    console.log(`  ${pkg.name.padEnd(28)} ${pkg.version.padEnd(8)} ${built}${flag}`);
  }
  console.log(`publishable: ${PUBLISHABLE_PACKAGES.join(", ")}`);
}

function reportStaleDist(): void {
  const missing = listPackageDirs().filter((d) => !hasDist(d));
  if (missing.length === 0) {
    console.log("all packages have dist/ outputs.");
    return;
  }
  console.log("packages missing dist/ (run `node scripts/build.ts`):");
  for (const d of missing) console.log(`  ${d}`);
  process.exitCode = 1;
}

/** Doc/plan consistency guard — fails if docs and code have drifted apart. */
function checkDocs(): void {
  run("node", ["scripts/check-docs.ts"]);
}

function runChecks(): void {
  checkDocs();
  pnpm(["-r", ...PUBLISHABLE_PACKAGES.flatMap((p) => ["--filter", p]), "run", "build"]);
  pnpm(["lint"]);
  pnpm(["test"]);
  console.log("maintenance check: docs + build + lint + test passed.");
}

function reportOutdated(): void {
  pnpm(["outdated"]);
}

function main(): void {
  switch (command) {
    case "status":
      return reportStatus();
    case "stale-dist":
      return reportStaleDist();
    case "docs":
      return checkDocs();
    case "check":
      return runChecks();
    case "outdated":
      return reportOutdated();
    default:
      console.error(`unknown command: ${command}`);
      console.error("usage: node scripts/maintenance.ts [status|stale-dist|docs|check|outdated]");
      process.exit(1);
  }
}

main();
