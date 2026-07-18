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

Only the core subset is distributed to npm (see `PUBLISHABLE_PACKAGES` in
`scripts/lib/workspace.ts`):

- `@adaptivemcp/spec`
- `@adaptivemcp/memory`
- `@adaptivemcp/telemetry`
- `@adaptivemcp/evaluation`
- `@adaptivemcp/extension`

`routing`, `orchestration`, `approval`, `thin-client`, `examples`, and `apps`
remain private for now.

## Usage

```bash
node scripts/build.ts                 # build publishable packages
node scripts/build.ts --check         # CI: fail on dirty tree after build
node scripts/maintenance.ts status    # versions + dist state
node scripts/maintenance.ts check     # build + lint + test gate
node scripts/release.ts --dry-run     # version + build, no publish
node scripts/release.ts               # publish to npm (needs NPM_TOKEN)
```
