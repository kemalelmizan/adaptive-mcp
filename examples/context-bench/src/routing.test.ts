import { describe, it, expect } from "vitest";

import { MemoryStore } from "@adaptivemcp/memory";

import { adaptive, seedEdges } from "./adaptive.js";
import { CORPUS } from "./corpus.js";
import { progressive, type Strategy } from "./strategies.js";
import { policyFor, profileFromEnv, routed } from "./routing.js";
import { TASKS } from "./tasks.js";

function arms(): { memory: MemoryStore; retain: Strategy; fresh: Strategy } {
  const memory = new MemoryStore({ path: ":memory:" });
  seedEdges(memory, CORPUS);
  return {
    memory,
    retain: adaptive(memory, { name: "retain", session: true }),
    fresh: progressive(),
  };
}

/** One pass over the pack, as the table would run it. */
function pass(strategy: Strategy) {
  return TASKS.map((task) => strategy(task, CORPUS));
}

describe("routing on model capability", () => {
  it("gives a limited model the retaining policy and a capable one the fresh policy", () => {
    // The measurement this encodes: retention is worth a task to the 8B and costs two to
    // the 30B, so the policy cannot be the same for both.
    expect(policyFor("limited")).toBe("retain");
    expect(policyFor("capable")).toBe("fresh");
  });

  it("defaults to capable, and rejects anything else", () => {
    expect(profileFromEnv([], {})).toBe("capable");
    expect(profileFromEnv([], { CONTEXT_BENCH_MODEL_PROFILE: "limited" })).toBe("limited");
    expect(profileFromEnv(["--model-profile", "limited"], {})).toBe("limited");
    expect(() => profileFromEnv(["--model-profile", "tiny"], {})).toThrow(/capable or limited/);
  });

  it("labels the row 'routed' whichever arm it took", () => {
    const { memory, retain, fresh } = arms();

    expect(routed("capable", { retain, fresh })(TASKS[0]!, CORPUS).strategy).toBe("routed");
    expect(routed("limited", { retain, fresh })(TASKS[0]!, CORPUS).strategy).toBe("routed");
    memory.close();
  });

  it("behaves like the arm the profile selects", () => {
    const cases = [
      { profile: "capable", pick: (a: ReturnType<typeof arms>) => a.fresh },
      { profile: "limited", pick: (a: ReturnType<typeof arms>) => a.retain },
    ] as const;

    for (const { profile, pick } of cases) {
      // Two independent arm sets: the routed run must not inherit the reference's state.
      const reference = arms();
      const expected = pass(pick(reference));
      reference.memory.close();

      const subject = arms();
      const actual = pass(routed(profile, subject));
      subject.memory.close();

      expect(
        actual.map((r) => r.loaded),
        profile,
      ).toEqual(expected.map((r) => r.loaded));
      expect(
        actual.map((r) => r.tokens),
        profile,
      ).toEqual(expected.map((r) => r.tokens));
    }
  });

  it("trades tokens for reads, which is what the models turn into pass counts", () => {
    // A guard on the argument, not on the routing code: on this pack no fixed policy wins
    // everywhere, so the seam is a real decision. Retention carries more context and
    // reads less; the deterministic pass count is identical, and only a model can turn
    // that cost difference into a difference in success.
    const { memory, retain, fresh } = arms();
    const retained = pass(retain);
    const freshRun = pass(fresh);
    memory.close();

    const retainedTokens = retained.reduce((sum, r) => sum + r.tokens, 0);
    const freshTokens = freshRun.reduce((sum, r) => sum + r.tokens, 0);
    const retainedReads = retained.reduce((sum, r) => sum + r.reads, 0);
    const freshReads = freshRun.reduce((sum, r) => sum + r.reads, 0);

    expect(retainedTokens).toBeGreaterThan(freshTokens);
    expect(retainedReads).toBeLessThan(freshReads);
  });
});
