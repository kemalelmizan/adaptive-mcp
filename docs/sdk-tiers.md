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

| Requirement                         | Status | Where we stand                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Conformance tests**               | ✗      | We do not run [`@modelcontextprotocol/conformance`](https://github.com/modelcontextprotocol/conformance). The two files named "conformance" are ours: `examples/src/ignore-extension.conformance.test.ts` (the extension degrades cleanly when a server ignores it) and `packages/evaluation/src/conformance.test.ts` (graceful degradation in the learning loop). Neither exercises MCP protocol conformance. |
| **New protocol features**           | ◐      | `@modelcontextprotocol/mcp-binary` pins the SDK at `^1.30.1`; the other packages are transport-agnostic. There is no published timeline for adopting a spec release — `docs/ROADMAP.md` tracks our phases, and `SPEC_VERSION` (`packages/spec/src/version.ts`, `0.1.0`) versions our _extension_, not the protocol.                                                                                            |
| **Issue triage**                    | ◐      | Type labels are the required ones (`bug`, `enhancement`, `question`) and the status labels `good first issue` and `help wanted` exist. The required status labels `needs confirmation`, `needs repro` and `ready for work` do **not**, and time-to-first-label is not measured.                                                                                                                                |
| **Critical bug resolution**         | ✗      | Priorities are `priority:high` / `priority:medium` / `priority:low`, not `P0`–`P3`. The tier metric runs from the `P0` label to close, so with today's labels it cannot be computed at all — this is a naming gap, not a process gap.                                                                                                                                                                          |
| **Stable release**                  | ◐      | Releases are real and verifiable: `scripts/release.ts` publishes, waits for the registry to serve the version, then commits and tags (`docs/RELEASE.md`). The core line is `0.6.0`, and the tiering system defines a stable release as `1.0.0` or above without pre-release identifiers.                                                                                                                       |
| **Documentation**                   | ✓      | `README.md`, `AGENTS.md`, `docs/ROADMAP.md`, `docs/doubts.md`, `docs/adr/`, `docs/archetypes.md`, `docs/RELEASE.md`, plus runnable examples under `examples/`. Per-feature examples are uneven — some packages are documented only by their tests.                                                                                                                                                             |
| **Dependency policy**               | ◐      | The graph is _proven_ both ways by `pnpm deps:check` (no undeclared imports, no unused declarations), `SECURITY.md` records why each transitive override exists, and Dependabot-style drift is not automated. There is no published update cadence or advisory-response policy.                                                                                                                                |
| **Roadmap**                         | ✓      | `docs/ROADMAP.md` (phases, status, open work), and `pnpm docs:check` fails if a documented capability and its status marker disagree.                                                                                                                                                                                                                                                                          |
| **Conformance score / advancement** | N/A    | Only applies to SDKs applying for a tier.                                                                                                                                                                                                                                                                                                                                                                      |

## What we would change first

1. **Adopt the required labels** (`needs confirmation`, `needs repro`,
   `ready for work`, `P0`–`P3`). Cheapest change on the list, and it is the
   prerequisite for measuring triage and critical-bug time at all.
2. **Run the official conformance suite** against our client surface. The SDK ships
   the harness; pointing it at a client that drives a real server is a small adapter,
   and the result is evidence rather than assertion.
3. **Publish the dependency policy** in `SECURITY.md`: how often SDK/spec versions are
   reviewed, how advisories are triaged, and who decides. The behaviour exists; the
   commitment is what is missing.
