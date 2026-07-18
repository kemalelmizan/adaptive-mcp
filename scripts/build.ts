/**
 * scripts/build.ts — build the publishable Adaptive MCP packages.
 *
 * Builds every `@adaptivemcp/*` library package (the same set that `release.ts`
 * publishes). The `examples` and `apps` workspaces are excluded — they are
 * runnable demos, not distributable libraries.
 *
 * Usage:
 *   node scripts/build.ts            # build all publishable packages
 *   node scripts/build.ts --check    # build, then fail if git tree is dirty
 *                                     # (used in CI to catch missing rebuilds)
 */

import { PUBLISHABLE_PACKAGES, pnpm, isDirty, gitSha } from "./lib/workspace.ts";

const CHECK = process.argv.includes("--check");

function main(): void {
  console.log(`[build] publishable packages: ${PUBLISHABLE_PACKAGES.join(", ")}`);
  console.log(`[build] workspace @ ${gitSha()}`);

  pnpm(["-r", ...PUBLISHABLE_PACKAGES.flatMap((p) => ["--filter", p]), "run", "build"]);

  console.log("[build] done.");
  if (CHECK && isDirty()) {
    console.error(
      "[build] --check: working tree is dirty after build. " +
        "Commit the regenerated dist/ outputs or adjust .gitignore.",
    );
    process.exit(1);
  }
}

main();
