/**
 * @adaptivemcp/approval
 *
 * Intent -> plan -> tool approval boundaries. The `ApprovalGate` is the
 * enforcement hook: before a tool runs, `gate()` returns `allow`,
 * `require_confirmation`, or `deny` based on the human annotation (static risk)
 * and the learned insight (observed failure rate). It also records the current
 * approval boundary as an `approval` recommendation in the store.
 */
export { ApprovalGate, isFlaky } from "./gate.js";
export type { ApprovalDecision, ApprovalPolicy, ApprovalOptions } from "./gate.js";
