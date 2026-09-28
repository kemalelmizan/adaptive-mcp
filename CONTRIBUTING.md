# Contributing to Adaptive MCP

Thanks for your interest. Adaptive MCP is a small, opinionated project, so the
bar for contributions is mostly: keep it narrow and keep it honest.

## What this project is

Adaptive MCP learns behavior around existing MCP primitives. It does not
replace MCP, define new protocol primitives, or couple to shell/filesystem/
process internals. If a change introduces `adaptiveTool`, `adaptiveSkill`,
`adaptiveIntent`, or `adaptiveWorkflow` as first-class concepts, it is out of
scope.

## Getting started

```bash
pnpm install
pnpm build
pnpm test
```

Requirements:

- **Node 22+** (Node 26 recommended; the built-in `node:sqlite` module is used without a flag).
- **pnpm 11+** (pinned via the repo `packageManager` field).

Run the examples from the repo root:

```bash
pnpm --filter @adaptivemcp/examples quickstart
pnpm --filter @adaptivemcp/examples scenario
```

## Project layout

- `packages/spec` owns identifiers, event schemas, and shared types. Keep it
  dependency-light.
- `packages/memory` is the SQLite store.
- `packages/telemetry`, `packages/evaluation`, `packages/extension` form the
  observe, evaluate, and view steps.
- `packages/routing`, `packages/orchestration`, `packages/approval`,
  `packages/thin-client` are client-side executors, and `packages/middleware`
  and `packages/mcp-binary` are the pluggable middleware chain and its
  CLI-binary wrapper. All of these are published to npm.
- `packages/graph-analysis` (execution-graph intelligence) is fully
  implemented and tested but not yet published — see README's "Not yet
  published" section. `packages/opencode-plugin` is an experimental,
  unpublished OpenCode host adapter, unit-tested against the documented V1 hook
  shape but not yet run against a live host.
- `docs/ROADMAP.md` tracks phased status. `docs/RELEASE.md` is the release
  runbook. `docs/sep-2133-tools-metadata.md` is the extension draft.

## Adding an insight type

Insights are learned signals folded into the store by `packages/evaluation`. To
add one:

1. Define the insight key and shape in `packages/spec` (add it to the
   `Insight` type and any relevant constants).
2. Compute it in `packages/evaluation` behind a confidence threshold so it only
   appears once enough samples accumulate.
3. Render it in `packages/extension` (the YAML view is a projection of the
   store, never hand-edited).
4. Add a scenario or unit test that exercises the new signal.

Do not write insights directly into the YAML file. The YAML is derived.

## Changesets

This repo uses [Changesets](https://github.com/changesets/changesets). Every
user-facing change to a published package needs a changeset:

```bash
pnpm changeset
```

Select the affected `@adaptivemcp/*` packages and the semver bump. The release
tooling consumes the changeset and bumps versions; you do not run
`changeset version` by hand.

## Tests

- Unit tests live next to the package code and run under Vitest.
- `examples/src/runtime.test.ts` is the integration test that drives
  `AdaptiveRuntime` end to end.

Run the full suite with `pnpm test`. Keep `pnpm build` and `pnpm test` green
before opening a PR.

## Pull requests

- Keep PRs focused. One logical change per PR reads better than a wide diff.
- Describe the motivation, not just the diff. Link the issue if there is one.
- The maintainer runs the release; do not publish packages by hand.

## License

By contributing, you agree that your contributions are licensed under the MIT
License, the same as the project.
