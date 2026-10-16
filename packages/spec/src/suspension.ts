/**
 * A **suspension**: the durable record of a run that stopped to wait for a
 * human.
 *
 * This is the durable half of the pause/resume contract
 * ([ADR-004](../../../docs/adr/004-archetype-component-ownership.md)): the
 * *shape* lives here so every host records a pause the same way, `memory`
 * persists it, and the **host** owns the policy — what may suspend, who may
 * answer, how a resume is applied. The host half is the loop's job; this type
 * deliberately contains nothing about graphs, threads or schedulers.
 *
 * Modelled on two references: `langgraph`'s `interrupt`/`Command` pair (pause
 * with a value, resume with an answer — but no graph is required here, since a
 * host can suspend a plain run), and `agno`'s `HumanReview`, whose primitive
 * set the three `kind`s mirror.
 */

/** Why the host stopped. Mirrors the human-review primitives seen in the wild. */
export type SuspensionKind =
  | "confirmation" // may I do this?
  | "input" // I need a value I do not have
  | "review"; // is this result acceptable?

/** Where a suspension is in its lifecycle. */
export type SuspensionStatus =
  | "pending" // waiting for a human
  | "answered" // resolved with an answer
  | "cancelled" // the human declined, or the host abandoned it
  | "expired"; // nobody answered in time

export interface Suspension {
  id: string;
  /** The session (run) the suspension belongs to. */
  sessionId: string;
  kind: SuspensionKind;
  /** The question to show a human — already safe to display; the host redacts. */
  question: string;
  /**
   * Advisory JSON schema for the expected answer. The host validates; nothing
   * here enforces it, so a host that ignores this still works.
   */
  responseSchema?: Record<string, unknown>;
  /**
   * Opaque host state needed to continue the run — a step id, a cursor, a plan.
   * Never interpreted by this package, so the shape stays host-agnostic.
   */
  resumeState?: Record<string, unknown>;
  status: SuspensionStatus;
  /** The answer, once one was given. */
  answer?: unknown;
  /** Why it was not answered (a refusal, a timeout), when it was not. */
  reason?: string;
  createdAt: string;
  resolvedAt?: string;
}

/** How a suspension is resolved. */
export interface SuspensionResolution {
  status: Extract<SuspensionStatus, "answered" | "cancelled" | "expired">;
  /** Required for `answered`; ignored otherwise. */
  answer?: unknown;
  /** Free-form explanation (a refusal reason, a timeout). */
  reason?: string;
}
