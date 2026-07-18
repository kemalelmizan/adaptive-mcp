/**
 * @adaptivemcp/orchestration
 *
 * Execution composition and strategies driven by observed behavior. Currently
 * derives retry policies from observed failure rates and writes them into the
 * SSOT as `workflow` recommendations. The actual retry execution is the
 * caller's responsibility (e.g. the thin client or an agent loop).
 */
export { Orchestrator } from "./retry.js";
export type { RetryPolicy, OrchestrationOptions } from "./retry.js";
