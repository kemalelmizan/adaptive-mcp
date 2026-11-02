/**
 * The routing decision, kept separate from the transport.
 *
 * The policy is a pure function so the *learned* one can replace it without
 * touching HTTP: everything a policy needs is the requested model and the body,
 * and everything it returns is a backend name plus a reason (the reason is logged
 * and returned as a header, so a surprising route is explainable).
 */
import type { RouteConfig, VirtualModel } from "./config.js";

/** The parts of an OpenAI chat request the policy may look at. */
export interface ChatRequestBody {
  model?: string;
  messages?: Array<{ role?: string; content?: unknown; tool_calls?: unknown }>;
  stream?: boolean;
  tools?: unknown;
  [key: string]: unknown;
}

export interface RouteRequest {
  /** The model id the host asked for (a virtual model). */
  model: string;
  body: ChatRequestBody;
}

export interface RouteDecision {
  backend: string;
  reason: string;
}

export type RoutePolicy = (request: RouteRequest, config: RouteConfig) => RouteDecision;

/**
 * v1: an explicit virtual model wins; `auto` and unknown ids fall to the default.
 *
 * A host sends the model id it has configured, which need not be the router's
 * spelling: `adaptive/fast` and `fast` both resolve, so pointing a provider at the
 * proxy does not depend on guessing which part of `provider/model` it sends.
 *
 * `auto` is deliberately a seam rather than a guess. A model-blind heuristic
 * (route by size, or by tool name) would look adaptive while being arbitrary —
 * the learned policy needs per-model evidence, which the telemetry pipeline only
 * gets once the host records which model made each call.
 */
export const explicitPolicy: RoutePolicy = (request, config) => {
  const model = resolveModel(request.model, config);
  if (model && "backend" in model) {
    return { backend: model.backend, reason: `virtual model ${request.model}` };
  }
  if (model && model.policy === "auto") {
    return { backend: config.defaultBackend, reason: "auto: no learned recommendation yet" };
  }
  return { backend: config.defaultBackend, reason: `unknown model ${JSON.stringify(request.model)}` };
};

/** The configured virtual model for an id, with or without its `provider/` prefix. */
function resolveModel(id: string, config: RouteConfig): VirtualModel | undefined {
  return config.models[id] ?? config.models[id.split("/").pop() ?? id];
}
