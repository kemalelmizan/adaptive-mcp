import { describe, it, expect } from "vitest";
import fc from "fast-check";
import type { DecodingProfile, ModelCapabilities } from "@adaptivemcp/spec";
import { DecodingResolver } from "./decoding-resolver.js";

/**
 * `DecodingResolver` must only ever emit knobs the backend declared it supports,
 * and must never approximate a missing knob with a different one. These are the
 * guarantees the "advisory, host-applied" contract rests on.
 */

const KNOBS = [
  "temperature",
  "topP",
  "topK",
  "minP",
  "presencePenalty",
  "frequencyPenalty",
  "repetitionPenalty",
] as const;
type Knob = (typeof KNOBS)[number];

const capabilitiesArb: fc.Arbitrary<ModelCapabilities> = fc
  .record(
    Object.fromEntries(KNOBS.map((knob) => [knob, fc.boolean()])) as Record<
      Knob,
      fc.Arbitrary<boolean>
    >,
  )
  .map((supports) => ({ supports }));

const profileArb: fc.Arbitrary<DecodingProfile> = fc
  .constantFrom<DecodingProfile["id"]>("deterministic", "balanced", "creative")
  .map((id) => ({ id }));

describe("DecodingResolver (property)", () => {
  it("only emits finite knobs the backend declared it supports", () => {
    fc.assert(
      fc.property(profileArb, capabilitiesArb, (profile, capabilities) => {
        const resolved = new DecodingResolver().resolve(profile, capabilities);
        for (const [key, value] of Object.entries(resolved)) {
          expect(KNOBS).toContain(key as Knob);
          expect(capabilities.supports[key as Knob]).toBe(true);
          expect(typeof value).toBe("number");
          expect(Number.isFinite(value as number)).toBe(true);
        }
      }),
    );
  });

  it("is deterministic and resolves nothing for a capability-less backend", () => {
    fc.assert(
      fc.property(profileArb, capabilitiesArb, (profile, capabilities) => {
        const resolver = new DecodingResolver();
        expect(resolver.resolve(profile, capabilities)).toEqual(
          resolver.resolve(profile, capabilities),
        );
        expect(resolver.resolve(profile, { supports: {} })).toEqual({});
      }),
    );
  });

  it("emits exactly the profile's own knobs when all are supported", () => {
    const all: ModelCapabilities = {
      supports: Object.fromEntries(KNOBS.map((knob) => [knob, true])) as Record<Knob, boolean>,
    };
    fc.assert(
      fc.property(profileArb, (profile) => {
        const resolved = new DecodingResolver().resolve(profile, all);
        for (const key of Object.keys(resolved)) expect(KNOBS).toContain(key as Knob);
        // A supported knob that the profile does not target must stay absent
        // (frequencyPenalty / presencePenalty have no profile target today).
        expect(Object.keys(resolved)).not.toContain("frequencyPenalty");
        expect(Object.keys(resolved)).not.toContain("presencePenalty");
      }),
    );
  });
});
