# scripts

Build, release, and maintenance scripts for the Adaptive MCP monorepo.

All scripts are plain TypeScript run on **Node 26** with native type stripping
(`node scripts/<name>.ts`) — no `tsx`/`tshy` dependency required. They shell out
to `pnpm` / `npm` / `git` and never couple to a specific CI provider.

## Scripts

| Script | Purpose |
| --- | --- |
| `scripts/build.ts` | Build the publishable `@adaptivemcp/*` packages. `--check` fails if the build leaves the git tree dirty. |
| `scripts/release.ts` | Version (Changesets) + build + publish the core subset to npm. `--dry-run` skips publish; `--no-version` publishes as-is. |
| `scripts/maintenance.ts` | Repo hygiene: `status`, `stale-dist`, `check` (build+lint+test), `outdated`. |

## Published packages

Only the core subset is distributed to npm under the **`@adaptivemcp`**
organization (`https://www.npmjs.com/org/adaptivemcp`). The set is defined once
in `PUBLISHABLE_PACKAGES` (`scripts/lib/workspace.ts`):

- `@adaptivemcp/spec`
- `@adaptivemcp/memory`
- `@adaptivemcp/telemetry`
- `@adaptivemcp/evaluation`
- `@adaptivemcp/extension`

`routing`, `orchestration`, `approval`, `thin-client`, `examples`, and `apps`
remain private for now. To promote a package, add it to `PUBLISHABLE_PACKAGES`
and ensure its `package.json` has no `"private": true` and a `files: ["dist"]`
allowlist.

## Usage

```bash
node scripts/build.ts                 # build publishable packages
node scripts/build.ts --check         # CI: fail on dirty tree after build
node scripts/maintenance.ts status    # versions + dist state
node scripts/maintenance.ts stale-dist # list packages missing dist/
node scripts/maintenance.ts check     # build + lint + test gate
node scripts/maintenance.ts outdated  # pnpm outdated for the workspace
node scripts/release.ts --dry-run     # version + build, no publish
node scripts/release.ts               # publish to npm (needs NPM_TOKEN)
```

## Release flow (coordinated with `docs/PLAN.md` → Phase 6)

`release.ts` is the single entry point for distribution. It:

1. refuses to run on a dirty working tree;
2. builds `PUBLISHABLE_PACKAGES` (`pnpm -r --filter … run build`);
3. applies pending Changesets (`pnpm changeset version`);
4. rebuilds after the version bump;
5. `npm publish --access public --ignore-scripts` each package in dependency
   order (`spec` → `memory` → `telemetry` → `evaluation` → `extension`).

It never commits the version bump or pushes tags — that is left to the caller
(e.g. a Changesets release CI workflow). See `docs/PLAN.md` for the full
step-by-step publish walkthrough.

> Requires `NPM_TOKEN` (org publish rights) in the environment. Use
> `--dry-run` to validate the version bump and emitted `dist/` without
> publishing.
