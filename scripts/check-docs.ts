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
 *   4. every Phase 6 (6a-6j), Phase 8 (8a-8f) and Phase 9 (9a-9b) item row is
 *      still present in `docs/ROADMAP.md` (items cannot silently disappear);
 *   5. each `CLAIMS` entry's code probe agrees with its ROADMAP status marker:
 *      a capability that exists in code must be marked ✅/🟡, and a marker must
 *      not claim a capability the code no longer has;
 *   6. every backticked in-repo path cited in README/docs exists;
 *   7. prose claims that contradict a code probe are caught (a "not yet" left
 *      behind after the work landed), including claims about the sibling
 *      `agent` repo when it is checked out locally;
 *   8. the publishable set is dependency-closed: a published package cannot
 *      depend on an unpublished `@adaptivemcp/*` package, because npm would
 *      have nothing to resolve (this shipped broken once: `routing` and
 *      `evaluation` both depended on `graph-analysis`, which was not
 *      publishable).
 *
 * Read-only. Run standalone (`node scripts/check-docs.ts` / `pnpm docs:check`)
 * or via `pnpm maintenance:check`.
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
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
const UNPUBLISHED_PACKAGES: Record<string, string> = {};

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
    id: "6e",
    capability: "host-ignores-extension conformance scenario",
    file: "examples/src/ignore-extension.conformance.test.ts",
    pattern: /ignore/i,
    minStatus: "done",
  },
  {
    id: "6g",
    capability: "aggregateViews merges stores",
    file: "packages/extension/src/controller.ts",
    pattern: /static aggregateViews/,
    minStatus: "done",
  },
  {
    id: "6h",
    capability: "OAuthMiddleware credential flow",
    file: "packages/thin-client/src/oauth-middleware.ts",
    pattern: /class OAuthMiddleware/,
    minStatus: "done",
  },
  {
    id: "6i",
    capability: "OpenCode host adapter",
    file: "packages/opencode-plugin/src/index.ts",
    pattern: /export function createAdaptivePlugin/,
    minStatus: "done",
  },
  {
    id: "6j",
    capability: "co-occurrence pass",
    file: "packages/evaluation/src/evaluator.ts",
    pattern: /evaluateCooccurrence/,
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
    id: "8a",
    capability: "DecodingAdvisor emits a symbolic DecodingProfile",
    file: "packages/routing/src/decoding-advisor.ts",
    pattern: /class DecodingAdvisor/,
    minStatus: "done",
  },
  {
    id: "8c",
    capability: "DecodingRecommendation wrapper with confidence + reasons",
    file: "packages/spec/src/types.ts",
    pattern: /DecodingRecommendation/,
    minStatus: "done",
  },
  {
    id: "8f",
    capability: "decision trace as staged reasons[]",
    file: "packages/routing/src/decoding-advisor.ts",
    pattern: /intent baseline: \$\{baseline\}/,
    minStatus: "done",
  },
  {
    id: "8b",
    capability: "DecodingResolver",
    file: "packages/routing/src/decoding-resolver.ts",
    pattern: /DecodingResolver/,
    minStatus: "done",
  },
  {
    id: "8d",
    capability: "the decoding actually applied is recorded on the tool-execution event",
    file: "packages/spec/src/types.ts",
    pattern: /decoding\?: ToolDecoding/,
    minStatus: "done",
  },
  {
    id: "8e",
    capability: "cross-execution decoding analysis (retry rate / latency / suggested profile)",
    file: "packages/routing/src/decoding-analyzer.ts",
    pattern: /class DecodingAnalyzer/,
    minStatus: "done",
  },
  {
    id: "9a",
    capability: "shared task list with dependency ordering",
    file: "packages/memory/src/store.ts",
    pattern: /readyTasks\s*\(/,
    minStatus: "done",
  },
  {
    id: "9b",
    capability: "typed memory steps as one history",
    file: "packages/memory/src/store.ts",
    pattern: /getSteps\s*\(/,
    minStatus: "done",
  },
];

const ROADMAP_ITEMS = [
  "6a",
  "6b",
  "6c",
  "6d",
  "6e",
  "6f",
  "6g",
  "6h",
  "6i",
  "6j",
  "8a",
  "8b",
  "8c",
  "8d",
  "8e",
  "8f",
  "9a",
  "9b",
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
  // Tolerate whitespace padding inside the id cell: Prettier's canonical
  // markdown table format right-pads cells (`| 6a  |`), and the check used to
  // require exactly `| 6a |`, so any `pnpm format` pass silently broke it.
  const cell = new RegExp(`^\\|\\s*${id}\\s*\\|`);
  return roadmap.split("\n").find((line) => cell.test(line));
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
    [...block.matchAll(/`(@adaptivemcp\/[a-z0-9-]+)`/g)]
      .map((match) => match[1])
      .filter((name): name is string => name !== undefined),
  );
  const expected = new Set(PUBLISHABLE);
  for (const name of expected) {
    if (!listed.has(name)) fail(`README published table is missing ${name} (run \`pnpm docs\`)`);
  }
  for (const name of listed) {
    if (!expected.has(name)) {
      fail(
        `README published table lists ${name}, which is not in PUBLISHABLE_PACKAGES (run \`pnpm docs\`)`,
      );
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
      fail(`claim ${claim.id} ROADMAP row claims "${level}" but no probe matched in ${claim.file}`);
    }
    if (implemented && claim.minStatus === "done" && level === "partial") {
      fail(
        `claim ${claim.id} (${claim.capability}) is declared done but the ROADMAP row is only partial`,
      );
    }
  }
}

/**
 * A sentence the docs should no longer contain once a capability ships.
 *
 * The status table has probes; the paragraphs under it did not, which is how 6f
 * ended up marked "✅ done" above a body still saying "does not yet emit". These
 * guards are deliberately ugly regexes over exact stale sentences: a broad rule
 * would fail on history that is worth keeping.
 */
interface ProseGuard {
  capability: string;
  /** File whose presence/content proves the capability. */
  probeFile: string;
  probe: RegExp;
  /** Sentence that must be gone once `probe` matches. */
  forbidden: RegExp;
}

const PROSE_GUARDS: ProseGuard[] = [
  {
    capability: "budget / require_approval are emitted in the derived view",
    probeFile: "packages/extension/src/view.ts",
    probe: /require_approval/,
    forbidden: /does not yet emit the `budget` or `require_approval` fields/,
  },
  {
    capability: "the binary wrapper is an @adaptivemcp package",
    probeFile: "packages/mcp-binary/package.json",
    probe: /"name": "@adaptivemcp\/mcp-binary"/,
    forbidden: /@modelcontextprotocol\/mcp-binary/,
  },
  {
    capability: "ApprovalPolicy glob matching has regression tests",
    probeFile: "packages/approval/src/gate.test.ts",
    probe: /denyTools/,
    forbidden: /regression test still to add/,
  },
  {
    capability: "the agent repo has an HTTP MCP transport",
    probeFile: "../agent/src/mcp/http.ts",
    probe: /class HttpToolset/,
    forbidden: /no HTTP transport in the agent yet/,
  },
  {
    capability: "the agent repo implements OAuth discovery",
    probeFile: "../agent/src/mcp/oauth.ts",
    probe: /export function acquireToken/,
    forbidden: /no HTTP transport in the agent yet/,
  },
];

/**
 * Citations that deliberately name a file this repo does not have.
 *
 * Narrow by design: a prefix per document plus the reason. A proposed path in *another*
 * repository is the only case that cannot be fixed by editing the sentence into truth, and
 * listing it here keeps the guard strict everywhere else.
 */
const CITATION_IGNORES: Record<string, Array<{ prefix: string; reason: string }>> = {
  "docs/doubts.md": [
    {
      prefix: "packages/sdk/",
      reason:
        "proposed files inside the upstream @modelcontextprotocol/sdk (the SEP PR skeleton), " +
        "not this repo",
    },
  ],
};

const CITATION = /`((?:packages|examples|docs|scripts|apps)\/[\w./-]+)`/g;

/** Every markdown file under `docs/`, as `[label, relative-path]`, in a stable order. */
function listDocs(): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const walk = (relative: string): void => {
    for (const entry of readdirSync(join(REPO_ROOT, relative), { withFileTypes: true })) {
      const child = `${relative}/${entry.name}`;
      if (entry.isDirectory()) walk(child);
      else if (entry.name.endsWith(".md")) out.push([child, child]);
    }
  };
  walk("docs");
  return out.sort(([a], [b]) => a.localeCompare(b));
}

/**
 * Backticked in-repo paths in the prose must exist.
 *
 * Prose citations decay silently when a file is renamed or a planned path is written as if it
 * were real (`examples/src/scenarios/conformance.js` never existed). README and every
 * `docs/**` file are checked, not just the ROADMAP: the same failure mode applies to
 * `doubts.md` and the SEP draft, and the cost is one filesystem lookup per citation.
 */
function checkCitations(): void {
  const files: Array<[string, string]> = [["README.md", "README.md"], ...listDocs()];
  for (const [label, relative] of files) {
    const ignores = CITATION_IGNORES[label] ?? [];
    const used = new Set<string>();
    const text = read(relative);
    const missing: string[] = [];
    for (const match of text.matchAll(CITATION)) {
      const raw = match[1];
      if (raw === undefined) continue;
      const ignore = ignores.find((entry) => raw.startsWith(entry.prefix));
      if (ignore) {
        used.add(ignore.prefix);
        continue;
      }
      const path = raw.replace(/[.,;:]+$/, "").replace(/\/$/, "");
      if (!existsSync(resolve(REPO_ROOT, path))) missing.push(raw);
    }
    for (const path of missing) {
      fail(`${label} cites \`${path}\`, which does not exist`);
    }
    // A stale exemption is how an allowlist rots into a dumping ground: if the proposed path
    // is gone from the document, or the file now exists, the prefix must go.
    for (const ignore of ignores) {
      if (!used.has(ignore.prefix)) {
        fail(`${label} exemption for \`${ignore.prefix}*\` matches nothing; remove it`);
      }
    }
  }
}

function checkProseClaims(): void {
  const roadmap = read("docs/ROADMAP.md");
  for (const guard of PROSE_GUARDS) {
    // A missing probe file means the capability is not in this checkout (the
    // sibling agent repo is absent in CI), so the claim cannot be contradicted.
    if (!existsSync(resolve(REPO_ROOT, guard.probeFile))) continue;
    if (!guard.probe.test(read(guard.probeFile))) continue;
    if (guard.forbidden.test(roadmap)) {
      fail(
        `docs/ROADMAP.md still says "${guard.forbidden.source}" while ` +
          `${guard.probeFile} shows ${guard.capability}; update the prose`,
      );
    }
  }
}

function checkPublishClosure(): void {
  // npm resolves `dependencies` at install time: a published package pointing
  // at an unpublished one is uninstallable for every user of the published
  // package, and no test in this repo would notice (link: resolves locally).
  const publishable = new Set(PUBLISHABLE);
  for (const dir of listPackageDirs()) {
    const pkg = readPackageJson(dir);
    if (!publishable.has(pkg.name)) continue;
    const deps = Object.keys(pkg.dependencies ?? {}).filter((d) => d.startsWith("@adaptivemcp/"));
    for (const dep of deps) {
      if (!publishable.has(dep)) {
        fail(
          `publishable package ${pkg.name} depends on unpublished ${dep}; ` +
            `add it to PUBLISHABLE_PACKAGES or drop the dependency`,
        );
      }
    }
  }
}

function main(): void {
  checkPackageInventory();
  checkReadmeTable();
  checkRoadmapInventory();
  checkClaims();
  checkProseClaims();
  checkCitations();
  checkPublishClosure();

  if (failures.length > 0) {
    console.error("docs check failed:");
    for (const message of failures) console.error(`  - ${message}`);
    process.exit(1);
  }
  console.log(
    "docs check passed: package inventory, README table, ROADMAP inventory, status claims, " +
      "prose claims, cited paths, and the publishable dependency closure are consistent.",
  );
}

main();
