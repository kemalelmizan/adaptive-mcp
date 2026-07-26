/**
 * @adaptivemcp/routing
 *
 * Model selection and cost optimization driven by learned insights. Consumes
 * the store stats/insights and writes `model` + `routing` recommendations back
 * into the store, where the YAML view surfaces them.
 */
export { Router } from "./router.js";
export type { ModelOption, BudgetPolicy, RoutingOptions } from "./router.js";
