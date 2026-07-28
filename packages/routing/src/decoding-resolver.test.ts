import { describe, it, expect } from "vitest";
import {
  DecodingResolver,
  toDecodingRecommendation,
  DECODING_RESOLVER_VERSION,
  OPENAI_CAPABILITIES,
  LLAMA_CPP_CAPABILITIES,
  VLLM_CAPABILITIES,
} from "./decoding-resolver.js";
import type { DecodingProfile, Recommendation } from "@adaptivemcp/spec";

describe("@adaptivemcp/routing DecodingResolver", () => {
  const resolver = new DecodingResolver();

  it("only emits knobs the backend actually supports (OpenAI-style)", () => {
    const resolved = resolver.resolve({ id: "balanced" }, OPENAI_CAPABILITIES);
    expect(resolved).toEqual({ temperature: 0.5, topP: 0.9 });
    expect(resolved.minP).toBeUndefined();
    expect(resolved.topK).toBeUndefined();
  });

  it("emits a different knob set for a llama.cpp-style backend", () => {
    const resolved = resolver.resolve({ id: "balanced" }, LLAMA_CPP_CAPABILITIES);
    expect(resolved).toEqual({ temperature: 0.5, topK: 40, minP: 0.05, repetitionPenalty: 1.05 });
    expect(resolved.topP).toBeUndefined();
  });

  it("never substitutes one knob for another the backend lacks (no minP<->topP approximation)", () => {
    const resolved = resolver.resolve({ id: "creative" }, VLLM_CAPABILITIES);
    expect(resolved.minP).toBeUndefined();
    expect(resolved).toEqual({ temperature: 0.9, topP: 0.95, repetitionPenalty: 1.0 });
  });

  it("resolves each profile to a distinct target", () => {
    const profiles: DecodingProfile["id"][] = ["deterministic", "balanced", "creative"];
    const results = profiles.map((id) => resolver.resolve({ id }, LLAMA_CPP_CAPABILITIES));
    expect(new Set(results.map((r) => r.temperature)).size).toBe(3);
  });

  it("toDecodingRecommendation composes an advisor recommendation with a resolver's output", () => {
    const rec: Recommendation = {
      toolName: "deploy_service",
      serverName: "srv",
      type: "decoding",
      payload: { id: "deterministic" } satisfies DecodingProfile,
      rationale: "intent baseline: balanced; high observed failure rate (0.25) overrides the baseline toward deterministic",
      confidence: 0.7,
      generatedAt: new Date().toISOString(),
    };

    const decodingRec = toDecodingRecommendation(rec, resolver, LLAMA_CPP_CAPABILITIES);

    expect(decodingRec.profile).toEqual({ id: "deterministic" });
    expect(decodingRec.resolved).toEqual({ temperature: 0.2, topK: 20, minP: 0.1, repetitionPenalty: 1.1 });
    expect(decodingRec.resolverVersion).toBe(DECODING_RESOLVER_VERSION);
    expect(decodingRec.confidence).toBe(0.7);
    expect(decodingRec.reasons).toEqual([
      "intent baseline: balanced",
      "high observed failure rate (0.25) overrides the baseline toward deterministic",
    ]);
  });
});
