import type { DecodingProfile, ModelCapabilities, ResolvedDecodingSettings, Recommendation, DecodingRecommendation } from "@adaptivemcp/spec";

/**
 * Bumped by hand whenever `PROFILE_TARGETS` below changes, so a
 * `DecodingRecommendation`'s `resolverVersion` lets old telemetry stay
 * reproducible even after the tables are retuned (docs/doubts.md §13 D4).
 */
export const DECODING_RESOLVER_VERSION = "1.0.0";

/**
 * Per-profile targets, expressed in the full knob space. `DecodingResolver`
 * only copies through whichever of these a backend's `ModelCapabilities`
 * actually supports — it never approximates a missing knob with a different
 * one (e.g. `minP` is never substituted for `topP`; they aren't equivalent).
 */
const PROFILE_TARGETS: Record<DecodingProfile["id"], ResolvedDecodingSettings> = {
  deterministic: { temperature: 0.2, topP: 0.5, topK: 20, minP: 0.1, repetitionPenalty: 1.1 },
  balanced: { temperature: 0.5, topP: 0.9, topK: 40, minP: 0.05, repetitionPenalty: 1.05 },
  creative: { temperature: 0.9, topP: 0.95, topK: 80, minP: 0.02, repetitionPenalty: 1.0 },
};

/**
 * Translates a backend-agnostic `DecodingProfile` into whatever concrete
 * decoding knobs a specific backend actually exposes.
 *
 * Deliberately dumb (docs/doubts.md §13 D4): static, table-driven, versioned
 * (`DECODING_RESOLVER_VERSION`). Fallback rules and backend quirks live here,
 * never telemetry or learning — that stays in `DecodingAdvisor`.
 */
export class DecodingResolver {
  resolve(profile: DecodingProfile, capabilities: ModelCapabilities): ResolvedDecodingSettings {
    const target = PROFILE_TARGETS[profile.id];
    const { supports } = capabilities;
    const resolved: ResolvedDecodingSettings = {};

    if (supports.temperature && target.temperature !== undefined) resolved.temperature = target.temperature;
    if (supports.topP && target.topP !== undefined) resolved.topP = target.topP;
    if (supports.topK && target.topK !== undefined) resolved.topK = target.topK;
    if (supports.minP && target.minP !== undefined) resolved.minP = target.minP;
    if (supports.presencePenalty && target.presencePenalty !== undefined) resolved.presencePenalty = target.presencePenalty;
    if (supports.repetitionPenalty && target.repetitionPenalty !== undefined) resolved.repetitionPenalty = target.repetitionPenalty;
    if (supports.frequencyPenalty && target.frequencyPenalty !== undefined) resolved.frequencyPenalty = target.frequencyPenalty;

    return resolved;
  }
}

/** Starting backend-capability presets (ROADMAP 8b) — ship more than one shape from day one. */
export const OPENAI_CAPABILITIES: ModelCapabilities = {
  supports: { temperature: true, topP: true, presencePenalty: true, frequencyPenalty: true },
};

export const LLAMA_CPP_CAPABILITIES: ModelCapabilities = {
  supports: { temperature: true, topK: true, minP: true, repetitionPenalty: true },
};

export const VLLM_CAPABILITIES: ModelCapabilities = {
  supports: { temperature: true, topP: true, repetitionPenalty: true },
};

/**
 * Composes a `DecodingAdvisor`-produced `Recommendation` (`type: "decoding"`,
 * `payload: DecodingProfile`) with a `DecodingResolver`'s output into the
 * full `DecodingRecommendation` a host consumes. Neither `DecodingAdvisor`
 * nor `DecodingResolver` know about each other — this is the only place that
 * combines profile *selection* with profile *translation* (docs/doubts.md
 * §13 D1).
 */
export function toDecodingRecommendation(
  rec: Recommendation,
  resolver: DecodingResolver,
  capabilities: ModelCapabilities,
): DecodingRecommendation {
  const profile = rec.payload as DecodingProfile;
  return {
    profile,
    resolved: resolver.resolve(profile, capabilities),
    resolverVersion: DECODING_RESOLVER_VERSION,
    confidence: rec.confidence,
    reasons: rec.rationale.split("; "),
  };
}
