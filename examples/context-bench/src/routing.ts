/**
 * Routing the context policy on model capability.
 *
 * The measured fact this encodes: session retention is worth ~one task to a small model
 * (8B: 9/11 retained vs 8/11 fresh) and costs ~two tasks to a large one (30B: 9/11 retained
 * vs 11/11 fresh). The same policy has opposite signs, so "pick a strategy" is the wrong
 * question — a host should pick per model.
 *
 * This is deliberately a *thin* seam: two policies, one predicate, and an explicit
 * profile flag. Guessing capability from a model name would be the kind of heuristic that
 * looks clever and ages badly; a host that knows its model declares it.
 */
import type { Strategy } from "./strategies.js";

/** What the host knows about the model it is about to call. */
export type ModelProfile = "capable" | "limited";

/**
 * Which context policy this profile gets.
 *
 * `limited` retains the working set: it reads less and keeps earlier documents around,
 * which is what carries a small model through a follow-up question. `capable` starts
 * fresh: it reads more per task but is not distracted by what it read before.
 */
export function policyFor(profile: ModelProfile): "retain" | "fresh" {
  return profile === "limited" ? "retain" : "fresh";
}

/** Read the profile from the flags; `capable` is the default because it is the safe one. */
export function profileFromEnv(argv: string[], env: NodeJS.ProcessEnv = process.env): ModelProfile {
  const at = argv.indexOf("--model-profile");
  const raw = at >= 0 ? argv[at + 1] : env.CONTEXT_BENCH_MODEL_PROFILE;
  if (raw === undefined) return "capable";
  if (raw !== "capable" && raw !== "limited") {
    throw new Error(`unknown model profile "${raw}"; expected capable or limited`);
  }
  return raw;
}

/** The strategy the profile selects, relabelled so the table says which arm it took. */
export function routed(
  profile: ModelProfile,
  arms: { retain: Strategy; fresh: Strategy },
): Strategy {
  const chosen = policyFor(profile) === "retain" ? arms.retain : arms.fresh;
  return (task, corpus) => ({ ...chosen(task, corpus), strategy: "routed" });
}
