# MCP SDK tiers: where we stand

[The MCP SDK tiering system](https://modelcontextprotocol.io/community/sdk-tiers)
grades SDKs on conformance, feature tracking, triage, releases, documentation,
dependency policy and roadmap, with three tiers and measurable thresholds.

**We are not an SDK.** Adaptive MCP is a library ecosystem that _consumes_ MCP and
enriches what a client learns from using it; `@adaptivemcp/mcp-binary` is the only
package that talks to the protocol SDK directly. There is no tier to apply for, and
the conformance score below is not a claim anyone can make on our behalf.

The requirements are still a useful checklist, because most of them transfer to any
project shipping MCP-facing code, and the two that do not (a published conformance
score, and the SDK Working Group advancement process) are marked N/A. This page is a
gap assessment against that list, not a compliance claim.

| Requirement                         | Status | Where we stand                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Conformance tests**               | ✗      | We do not run [`@modelcontextprotocol/conformance`](https://github.com/modelcontextprotocol/conformance). The two files named "conformance" are ours: `examples/src/ignore-extension.conformance.test.ts` (the extension degrades cleanly when a server ignores it) and `packages/evaluation/src/conformance.test.ts` (graceful degradation in the learning loop). Neither exercises MCP protocol conformance.                                                |
| **New protocol features**           | ◐      | `@adaptivemcp/mcp-binary` pins the SDK at `^1.30.1`; the other packages are transport-agnostic. There is no published timeline for adopting a spec release — `docs/ROADMAP.md` tracks our phases, and `SPEC_VERSION` (`packages/spec/src/version.ts`, `0.1.0`) versions our _extension_, not the protocol.                                                                                                                                                    |
| **Issue triage**                    | ✓      | Type and status labels are the required set: `bug`, `enhancement`, `question`; `needs confirmation`, `needs repro`, `ready for work`, `good first issue`, `help wanted`. Time-to-first-label is therefore measurable; no SLA is claimed.                                                                                                                                                                                                                      |
| **Critical bug resolution**         | ◐      | `P0`–`P3` replace the old `priority:high`/`medium`/`low` labels (existing issues migrated: high→`P1`, medium→`P2`, low→`P3`), so the metric is computable. No 7-day resolution commitment is published because we are not claiming a tier.                                                                                                                                                                                                                    |
| **Stable release**                  | ◐      | Releases are real and verifiable: `scripts/release.ts` publishes, waits for the registry to serve the version, then commits and tags (`docs/RELEASE.md`). The core packages are still `0.x` (see each `package.json`), and the tiering system defines a stable release as `1.0.0` or above without pre-release identifiers — so this stays partial until that line is crossed. Naming an exact version here only meant this page went stale at every release. |
| **Documentation**                   | ✓      | `README.md`, `AGENTS.md`, `docs/ROADMAP.md`, `docs/doubts.md`, `docs/adr/`, `docs/archetypes.md`, `docs/RELEASE.md`, plus runnable examples under `examples/`. Per-feature examples are uneven — some packages are documented only by their tests.                                                                                                                                                                                                            |
| **Dependency policy**               | ◐      | The graph is _proven_ both ways by `pnpm deps:check` (no undeclared imports, no unused declarations), `SECURITY.md` records why each transitive override exists, and Dependabot-style drift is not automated. There is no published update cadence or advisory-response policy.                                                                                                                                                                               |
| **Roadmap**                         | ✓      | `docs/ROADMAP.md` (phases, status, open work), and `pnpm docs:check` fails if a documented capability and its status marker disagree.                                                                                                                                                                                                                                                                                                                         |
| **Conformance score / advancement** | N/A    | Only applies to SDKs applying for a tier.                                                                                                                                                                                                                                                                                                                                                                                                                     |

## What we would change first

1. **Publish the triage and P0 commitments.** The required labels now exist, so both
   metrics are computable; what is missing is saying — and holding to — a triage
   window and a critical-resolution window.
2. **Run the official conformance suite** against our client surface. The SDK ships
   the harness; pointing it at a client that drives a real server is a small adapter,
   and the result is evidence rather than assertion.
3. **Publish the dependency policy** in `SECURITY.md`: how often SDK/spec versions are
   reviewed, how advisories are triaged, and who decides. The behaviour exists; the
   commitment is what is missing.
