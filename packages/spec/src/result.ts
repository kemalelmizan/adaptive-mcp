/**
 * Result classification.
 *
 * A client's transport may report a tool call as "ok" while the server has, in
 * fact, signalled a *logical* failure in-band — for example a JSON envelope with
 * `status: "error"` instead of the protocol-level `isError` flag. Left alone,
 * that outcome is recorded as a success, which poisons every derived signal:
 * failure rate, insights, routing, drift.
 *
 * A `ToolResultClassifier` is the seam that corrects this. It runs on each
 * execution *attempt*, before the outcome is recorded (and therefore before the
 * retry decision), so a reclassified failure can also trigger a retry. It is
 * advisory in the same sense as the rest of Adaptive MCP: the host opts in by
 * supplying a classifier; returning `undefined` leaves the outcome untouched.
 */

/** A raw tool outcome, as produced by the transport before classification. */
export interface ToolCallOutcome {
  ok: boolean;
  error?: string;
  output?: unknown;
}

/** Fields a classifier may override; omitted fields keep their raw value. */
export interface ToolResultClassification {
  ok?: boolean;
  error?: string;
}

/** Context identifying the call an outcome belongs to. */
export interface ToolResultContext {
  toolName: string;
  serverName?: string;
}

/**
 * Inspect a raw outcome and optionally re-classify it. Return `undefined` (or
 * nothing) to leave it unchanged.
 */
export type ToolResultClassifier = (
  outcome: ToolCallOutcome,
  context: ToolResultContext,
) => ToolResultClassification | void | undefined;
