# ADR-003: Table-driven, versioned decoding resolver

**Status:** Accepted (2026-07-28, refined 2026-09-29). Plan: `docs/ROADMAP.md`
Phase 8a–8f; rationale: `docs/doubts.md` §13 D4.

## Context

Telemetry can suggest a decoding posture (failures → stricter sampling), but raw
sampler numbers (`temperature`, `top_p`, …) are backend-specific and would leak
one provider's conventions into the learning core. The project needs to separate
*choosing a posture* (learned, advisory) from *translating a posture into
concrete knobs* (mechanical, backend-specific).

## Decision

Split the concern in two:

1. **`DecodingAdvisor`** (`packages/routing`) emits a symbolic `DecodingProfile`
   (`deterministic` | `balanced` | `creative`) from intent plus observed
   behavior. No numbers, no backend knowledge.
2. **`DecodingResolver`** translates a profile into `ResolvedDecodingSettings`
   for a specific backend's `ModelCapabilities`. It is deliberately dumb,
   static, table-driven, and **versioned** (`DECODING_RESOLVER_VERSION`).

Fallback rule: **drop knobs the backend does not support — never approximate**
one knob with another (`minP` is never substituted for `topP`). At least two
capability shapes ship (OpenAI-style, llama.cpp-style) so the logic is designed
against more than one backend from the start.

`toDecodingRecommendation` is the only place that combines selection with
translation, producing a `DecodingRecommendation` (`profile`, `resolved`,
`resolverVersion`, `confidence`, `reasons[]`) the host may choose to apply.

## Consequences

- The learning core stays backend-agnostic; adding a backend is a capability
  table, not a change to the advisor.
- A recorded `resolverVersion` keeps past decisions reproducible even after the
  tables are retuned.
- Hosts decide whether to apply an override (e.g. a confidence threshold);
  nothing is enforced.
- The `resolved` shape is the strict superset `ResolvedDecodingSettings`, so the
  deprecated `SamplingRecommendationPayload` stays readable until the next major
  version.

## Alternatives considered

- **Advisor emits numbers.** Rejected: bakes backend quirks into the learned
  core and makes recommendations non-portable.
- **Approximate missing knobs** (e.g. map `topP`→`minP`). Rejected: they are not
  equivalent; silent approximation would misrepresent the applied decoding.
- **A full `ExecutionPolicy` generalization now.** Deferred: retry/budget/model
  policies already work independently; a shared abstraction should be inferred
  from two real cases, not guessed (see `docs/ROADMAP.md`).
