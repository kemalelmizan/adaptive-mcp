/**
 * scripts/check-docs.ts — documentation/plan consistency guard.
 *
 * The ROADMAP and README drift because status is written in prose. This check
 * makes the structural claims and the "documented capability" claims
 * machine-verifiable, so a plan can no longer go stale silently:
 *
 *   1. every `packages/<dir>` is accounted for: either in `PUBLISHABLE_PACKAGES`
 *      or in the documented `UNPUBLISHED_PACKAGES` allowlist below;
 *   2. the README `packages:published` table lists exactly `PUBLISHABLE_PACKAGES`
 *      (catches a stale `pnpm docs` run);
 *   3. every package name is mentioned in `docs/ROADMAP.md`;
 *   4. every Phase 6 (6a-6j) and Phase 8 (8a-8f) item row is still present in
 *      `docs/ROADMAP.md` (items cannot silently disappear);
 *   5. each `CLAIMS` entry's code probe agrees with its ROADMAP status marker:
 *      a capability that exists in code must be marked ✅/🟡, and a marker must
 *      not claim a capability the code no longer has.
 *
 * Read-only. Run standalone (`node scripts/check-docs.ts` / `pnpm docs:check`)
 * or via `pnpm maintenance:check`.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  PUBLISHABLE_PACKAGES,
  REPO_ROOT,
  listPackageDirs,
  readPackageJson,
} from "./lib/workspace.ts";

const PUBLISHABLE = PUBLISHABLE_PACKAGES as readonly string[];

/**
 * Packages that are intentionally not published, with the documented reason.
 * Mirrors README's "Not yet published" section; adding a package here requires a
 * matching README note.
 */
const UNPUBLISHED_PACKAGES: Record<string, string> = {
  "@adaptivemcp/graph-analysis": "implemented and tested, not yet in PUBLISHABLE_PACKAGES",
  "@adaptivemcp/opencode-plugin": "experimental, untested, unvalidated OpenCode host adapter",
};

/** Minimum ROADMAP status for a documented capability: ✅ "done" or 🟡 "partial". */
type MinStatus = "done" | "partial";

interface Claim {
  /** ROADMAP item id, e.g. "6a". */
  id: string;
  /** Human-readable capability, for the failure message. */
  capability: string;
  /** Repo-relative file containing the probe. */
  file: string;
  /** Pattern that, when matched, proves the capability is implemented. */
  pattern: RegExp;
  /** Minimum status the ROADMAP row must carry when the probe matches. */
  minStatus: MinStatus;
}

/**
 * Capabilities that have drifted before. Keep this list small and high-signal:
 * one entry per documented claim whose truth is checkable from the code.
 */
const CLAIMS: Claim[] = [
  {
    id: "6a",
    capability: "glob pattern matching in ApprovalPolicy.denyTools",
    file: "packages/approval/src/gate.ts",
    pattern: /matchGlob\s*\(/,
    minStatus: "done",
  },
  {
    id: "6b",
    capability: "context-cost (output tokens) tracked",
    file: "packages/evaluation/src/evaluator.ts",
    pattern: /avg_output_tokens/,
    minStatus: "partial",
  },
  {
    id: "6c",
    capability: "cost drift / latency regression / approval friction insights",
    file: "packages/evaluation/src/evaluator.ts",
    pattern: /cost_drift/,
    minStatus: "done",
  },
  {
    id: "6d",
    capability: "repetition_detected insight",
    file: "packages/evaluation/src/evaluator.ts",
    pattern: /repetition_detected/,
    minStatus: "done",
  },
  {
    id: "6f",
    capability: "budget / require_approval emitted in the derived view",
    file: "packages/extension/src/view.ts",
    pattern: /require_approval/,
    minStatus: "done",
  },
  {
    id: "8b",
    capability: "DecodingResolver",
    file: "packages/routing/src/decoding-resolver.ts",
    pattern: /DecodingResolver/,
    minStatus: "done",
  },
];

const ROADMAP_ITEMS = [
  "6a", "6b", "6c", "6d", "6e", "6f", "6g", "6h", "6i", "6j",
  "8a", "8b", "8c", "8d", "8e", "8f",
];

const failures: string[] = [];

function fail(msg: string): void {
  failures.push(msg);
}

function read(relPath: string): string {
  const file = resolve(REPO_ROOT, relPath);
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

function roadmapRow(roadmap: string, id: string): string | undefined {
  return roadmap.split("\n").find((line) => line.startsWith(`| ${id} |`));
}

function statusLevel(row: string): "done" | "partial" | "none" {
  if (row.includes("✅")) return "done";
  if (row.includes("🟡")) return "partial";
  return "none";
}

function checkPackageInventory(): void {
  for (const dir of listPackageDirs()) {
    const { name } = readPackageJson(dir);
    if (!PUBLISHABLE.includes(name) && !(name in UNPUBLISHED_PACKAGES)) {
      fail(
        `package ${name} (${dir}) is neither in PUBLISHABLE_PACKAGES nor the ` +
          `UNPUBLISHED_PACKAGES allowlist in scripts/check-docs.ts`,
      );
    }
  }
}

function checkReadmeTable(): void {
  const readme = read("README.md");
  const start = readme.indexOf("<!-- packages:published:start -->");
  const end = readme.indexOf("<!-- packages:published:end -->");
  if (start === -1 || end === -1) {
    fail("README.md is missing the packages:published markers");
    return;
  }
  const block = readme.slice(start, end);
  const listed = new Set(
    [...block.matchAll(/`(@adaptivemcp\/[a-z0-9-]+)`/g)].map((m) => m[1]),
  );
  const expected = new Set(PUBLISHABLE);
  for (const name of expected) {
    if (!listed.has(name)) fail(`README published table is missing ${name} (run \`pnpm docs\`)`);
  }
  for (const name of listed) {
    if (!expected.has(name)) {
      fail(`README published table lists ${name}, which is not in PUBLISHABLE_PACKAGES (run \`pnpm docs\`)`);
    }
  }
}

function checkRoadmapInventory(): void {
  const roadmap = read("docs/ROADMAP.md");
  if (!roadmap) {
    fail("docs/ROADMAP.md is missing");
    return;
  }
  for (const dir of listPackageDirs()) {
    const { name } = readPackageJson(dir);
    if (!roadmap.includes(name)) fail(`docs/ROADMAP.md does not mention ${name}`);
  }
  for (const id of ROADMAP_ITEMS) {
    if (!roadmapRow(roadmap, id)) fail(`docs/ROADMAP.md is missing item row ${id}`);
  }
}

function checkClaims(): void {
  const roadmap = read("docs/ROADMAP.md");
  for (const claim of CLAIMS) {
    const implemented = claim.pattern.test(read(claim.file));
    const row = roadmapRow(roadmap, claim.id);
    if (!row) {
      fail(`claim ${claim.id}: no ROADMAP row to compare against`);
      continue;
    }
    const level = statusLevel(row);
    if (implemented && level === "none") {
      fail(
        `claim ${claim.id} (${claim.capability}) is implemented in ${claim.file} ` +
          `but its ROADMAP row has no status marker (✅/🟡)`,
      );
    }
    if (!implemented && level !== "none") {
      fail(
        `claim ${claim.id} ROADMAP row claims "${level}" but no probe matched in ${claim.file}`,
      );
    }
    if (implemented && claim.minStatus === "done" && level === "partial") {
      fail(
        `claim ${claim.id} (${claim.capability}) is declared done but the ROADMAP row is only partial`,
      );
    }
  }
}

function main(): void {
  checkPackageInventory();
  checkReadmeTable();
  checkRoadmapInventory();
  checkClaims();

  if (failures.length > 0) {
    console.error("docs check failed:");
    for (const message of failures) console.error(`  - ${message}`);
    process.exit(1);
  }
  console.log(
    "docs check passed: package inventory, README table, ROADMAP inventory, and status claims are consistent.",
  );
}

main();
