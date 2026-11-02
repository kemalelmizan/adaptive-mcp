/**
 * Talking to a backend.
 *
 * The proxy is a faithful pipe: it rewrites `model`, applies the backend's
 * chat-template knobs, picks an Authorization header, and hands the response
 * body back untouched. Streaming therefore needs no special case — an
 * SSE body is just a `ReadableStream` to forward.
 */
import type { BackendConfig } from "./config.js";

export interface UpstreamResponse {
  status: number;
  headers: Headers;
  body: ReadableStream<Uint8Array> | null;
}

export interface ForwardOptions {
  /** Injected in tests; defaults to the global fetch. */
  fetch?: typeof fetch;
  /** The host's `Authorization` header, used when the backend names no `apiKeyEnv`. */
  authorization?: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * The body to send upstream: the host's request with the backend's model and
 * template knobs applied. Backend knobs win — they describe how that server is
 * started, so a host cannot accidentally re-enable a Qwen3 server's thinking.
 */
export function upstreamBody(
  body: Record<string, unknown>,
  backend: BackendConfig,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...body, model: backend.model };
  if (backend.chatTemplateKwargs) {
    const fromHost =
      typeof body.chat_template_kwargs === "object" && body.chat_template_kwargs !== null
        ? (body.chat_template_kwargs as Record<string, unknown>)
        : {};
    next.chat_template_kwargs = { ...fromHost, ...backend.chatTemplateKwargs };
  }
  return next;
}

/** Headers for the upstream call: JSON in, the host's auth or the backend's own. */
export function upstreamHeaders(
  backend: BackendConfig,
  { authorization, env = process.env, stream = false }: ForwardOptions & { stream?: boolean } = {},
): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: stream ? "text/event-stream" : "application/json",
  };
  const key = backend.apiKeyEnv ? env[backend.apiKeyEnv] : undefined;
  if (key) headers.authorization = `Bearer ${key}`;
  else if (authorization) headers.authorization = authorization;
  return headers;
}

/** POST one chat request to a backend and return its response, untouched. */
export async function forwardChat(
  backend: BackendConfig,
  body: Record<string, unknown>,
  options: ForwardOptions = {},
): Promise<UpstreamResponse> {
  const doFetch = options.fetch ?? fetch;
  const url = `${backend.baseURL}/chat/completions`;
  const response = await doFetch(url, {
    method: "POST",
    headers: upstreamHeaders(backend, { ...options, stream: body.stream === true }),
    body: JSON.stringify(upstreamBody(body, backend)),
  });
  return { status: response.status, headers: response.headers, body: response.body };
}
