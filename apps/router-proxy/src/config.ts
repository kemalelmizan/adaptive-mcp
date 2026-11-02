/**
 * Router-proxy configuration.
 *
 * One JSON file describes the backends, the **virtual models** a host may ask
 * for, and the backend to use when a model is unknown or the policy declines.
 * A virtual model is what you put in OpenCode's provider config; the backend is
 * where the request actually goes.
 */
import { readFileSync } from "node:fs";

/** How to run a backend the proxy may start and stop on its own. */
export interface ManageSpec {
  command: string;
  args?: string[];
  /**
   * Extra environment for the process. A `null` **removes** an inherited variable —
   * a stray `LLAMA_API_KEY` in the proxy's environment otherwise makes the server
   * demand auth the host never sends.
   */
  env?: Record<string, string | null>;
  /** Where to probe readiness; defaults to the origin of the backend's `baseURL`. */
  baseURL?: string;
  readyPath?: string;
  /** How long a cold start may take before it is abandoned (default 180s). */
  startTimeoutMs?: number;
  /** Stop after this long without a request; `0` keeps it running (default 600s). */
  idleTimeoutMs?: number;
}

export interface BackendConfig {
  /** OpenAI-compatible base URL, including `/v1`. */
  baseURL: string;
  /** The model id sent upstream. The router's names and the server's need not agree. */
  model: string;
  /**
   * Env var holding the upstream bearer token. When absent, the incoming
   * `Authorization` header is passed through — so a cloud backend keeps whatever
   * the host authenticated with.
   */
  apiKeyEnv?: string;
  /**
   * Chat-template knobs injected into every request for this backend. Backends
   * win over the request here, because these describe how the server is started
   * (a Qwen3 server needs `enable_thinking: false` to answer instead of thinking
   * until it runs out of tokens).
   */
  chatTemplateKwargs?: Record<string, unknown>;
  /** Backends to try, in order, if this one fails before anything is streamed. */
  fallback?: string[];
  /** Present when this proxy may start and stop the backend itself. */
  manage?: ManageSpec;
}

/** What a host-facing model id resolves to. */
export type VirtualModel = { backend: string } | { policy: "auto" };

export interface RouteConfig {
  listen: { host: string; port: number };
  backends: Record<string, BackendConfig>;
  models: Record<string, VirtualModel>;
  /** The backend for an unknown model, or when the policy declines. */
  defaultBackend: string;
}

function fail(source: string, message: string): never {
  throw new Error(`${source}: ${message}`);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Validate a parsed config document. Errors name the source and the field. */
export function parseConfig(raw: unknown, source = "config"): RouteConfig {
  if (!isObject(raw)) fail(source, "must be a JSON object");

  const listen = raw.listen;
  if (!isObject(listen)) fail(source, '"listen" must be an object');
  const host = listen.host;
  const port = listen.port;
  if (typeof host !== "string" || !host) fail(source, '"listen.host" must be a non-empty string');
  if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) {
    fail(source, '"listen.port" must be an integer between 1 and 65535');
  }

  const backends: Record<string, BackendConfig> = {};
  if (!isObject(raw.backends) || Object.keys(raw.backends).length === 0) {
    fail(source, '"backends" must be a non-empty object');
  }
  for (const [name, value] of Object.entries(raw.backends)) {
    if (!isObject(value)) fail(source, `backends.${name} must be an object`);
    if (typeof value.baseURL !== "string" || !/^https?:\/\//.test(value.baseURL)) {
      fail(source, `backends.${name}.baseURL must be an http(s) URL`);
    }
    if (typeof value.model !== "string" || !value.model) {
      fail(source, `backends.${name}.model must be a non-empty string`);
    }
    if (value.apiKeyEnv !== undefined && typeof value.apiKeyEnv !== "string") {
      fail(source, `backends.${name}.apiKeyEnv must be a string`);
    }
    if (value.chatTemplateKwargs !== undefined && !isObject(value.chatTemplateKwargs)) {
      fail(source, `backends.${name}.chatTemplateKwargs must be an object`);
    }
    const fallback = value.fallback;
    if (
      fallback !== undefined &&
      (!Array.isArray(fallback) || !fallback.every((entry) => typeof entry === "string"))
    ) {
      fail(source, `backends.${name}.fallback must be a list of backend names`);
    }
    let manage: ManageSpec | undefined;
    if (value.manage !== undefined) {
      if (!isObject(value.manage)) fail(source, `backends.${name}.manage must be an object`);
      const spec = value.manage;
      if (typeof spec.command !== "string" || !spec.command) {
        fail(source, `backends.${name}.manage.command must be a non-empty string`);
      }
      if (spec.args !== undefined && (!Array.isArray(spec.args) || !spec.args.every((a) => typeof a === "string"))) {
        fail(source, `backends.${name}.manage.args must be a list of strings`);
      }
      if (spec.env !== undefined) {
        if (
          !isObject(spec.env) ||
          !Object.values(spec.env).every((entry) => typeof entry === "string" || entry === null)
        ) {
          fail(source, `backends.${name}.manage.env must map names to strings (or null to unset)`);
        }
      }
      if (spec.baseURL !== undefined && (typeof spec.baseURL !== "string" || !/^https?:\/\//.test(spec.baseURL))) {
        fail(source, `backends.${name}.manage.baseURL must be an http(s) URL`);
      }
      if (spec.readyPath !== undefined && typeof spec.readyPath !== "string") {
        fail(source, `backends.${name}.manage.readyPath must be a string`);
      }
      for (const key of ["startTimeoutMs", "idleTimeoutMs"] as const) {
        const timeout = spec[key];
        if (timeout !== undefined && (typeof timeout !== "number" || !Number.isFinite(timeout) || timeout < 0)) {
          fail(source, `backends.${name}.manage.${key} must be a non-negative number`);
        }
      }
      manage = {
        command: spec.command,
        args: spec.args as string[] | undefined,
        env: spec.env as Record<string, string | null> | undefined,
        baseURL: spec.baseURL as string | undefined,
        readyPath: spec.readyPath as string | undefined,
        startTimeoutMs: spec.startTimeoutMs as number | undefined,
        idleTimeoutMs: spec.idleTimeoutMs as number | undefined,
      };
    }
    backends[name] = {
      baseURL: value.baseURL.replace(/\/+$/, ""),
      model: value.model,
      apiKeyEnv: value.apiKeyEnv as string | undefined,
      chatTemplateKwargs: value.chatTemplateKwargs as Record<string, unknown> | undefined,
      fallback: fallback as string[] | undefined,
      manage,
    };
  }

  for (const [name, backend] of Object.entries(backends)) {
    for (const target of backend.fallback ?? []) {
      if (!(target in backends)) fail(source, `backends.${name}.fallback names unknown backend "${target}"`);
    }
  }

  const models: Record<string, VirtualModel> = {};
  if (!isObject(raw.models) || Object.keys(raw.models).length === 0) {
    fail(source, '"models" must be a non-empty object');
  }
  for (const [id, value] of Object.entries(raw.models)) {
    if (!isObject(value)) fail(source, `models.${id} must be an object`);
    if (value.policy === "auto") {
      models[id] = { policy: "auto" };
    } else if (typeof value.backend === "string") {
      if (!(value.backend in backends)) {
        fail(source, `models.${id}.backend names unknown backend "${value.backend}"`);
      }
      models[id] = { backend: value.backend };
    } else {
      fail(source, `models.${id} needs "backend" or {"policy": "auto"}`);
    }
  }

  const defaultBackend = raw.defaultBackend;
  if (typeof defaultBackend !== "string" || !(defaultBackend in backends)) {
    fail(source, `"defaultBackend" must name one of: ${Object.keys(backends).join(", ")}`);
  }

  return { listen: { host, port }, backends, models, defaultBackend };
}

/** Read and validate a config file. */
export function loadConfig(path: string): RouteConfig {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    throw new Error(
      `could not read router config "${path}": ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `could not parse router config "${path}": ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return parseConfig(parsed, `router config "${path}"`);
}
