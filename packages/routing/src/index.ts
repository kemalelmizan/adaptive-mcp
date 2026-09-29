/**
 * @adaptivemcp/routing
 *
 * Model selection and cost optimization driven by learned insights. Consumes
 * the store stats/insights and writes `model` + `routing` recommendations back
 * into the store, where the YAML view surfaces them.
 */
export { Router } from "./router.js";
export type { ModelOption, BudgetPolicy, RoutingOptions, WorkflowPosition, NodeRouting } from "./router.js";
export { SamplingAdvisor } from "./sampling-advisor.js";
export type { SamplingAdvisorOptions, SamplingThresholds } from "./sampling-advisor.js";
export { DecodingAdvisor } from "./decoding-advisor.js";
export type { DecodingAdvisorOptions, DecodingThresholds, DecodingProfileId } from "./decoding-advisor.js";
export { DecodingAnalyzer } from "./decoding-analyzer.js";
export type { DecodingGroup, DecodingAnalyzerOptions } from "./decoding-analyzer.js";
export { DecodingResolver, toDecodingRecommendation, DECODING_RESOLVER_VERSION, OPENAI_CAPABILITIES, LLAMA_CPP_CAPABILITIES, VLLM_CAPABILITIES } from "./decoding-resolver.js";
