/**
 * The HTTP surface: `GET /health`, `GET /v1/models`, `POST /v1/chat/completions`.
 *
 * It exists so a host can be pointed at a **virtual model** and stop caring where
 * the request goes. The routing decision is delegated to a `RoutePolicy`, and the
 * chosen backend is reported in `x-adaptive-route` — a route you cannot see is a
 * route you cannot debug.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import type { RouteConfig } from "./config.js";
import { forwardChat, type UpstreamResponse } from "./forward.js";
import { explicitPolicy, type ChatRequestBody, type RoutePolicy } from "./policy.js";

/** Requests are conversations; a megabyte of JSON is already enormous. */
const MAX_BODY_BYTES = 32 * 1024 * 1024;

export interface AppOptions {
  /** Injected in tests; defaults to a plain backend-per-model policy. */
  policy?: RoutePolicy;
  /** Injected in tests. */
  fetch?: typeof fetch;
  /** Where one line per request goes. Defaults to stderr. */
  log?: (line: string) => void;
}

export function createApp(config: RouteConfig, options: AppOptions = {}): Server {
  const policy = options.policy ?? explicitPolicy;
  const log = options.log ?? ((line: string) => console.error(line));
  const doFetch = options.fetch;

  function json(res: ServerResponse, status: number, payload: unknown): void {
    const text = JSON.stringify(payload);
    res.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "content-length": Buffer.byteLength(text),
    });
    res.end(text);
  }

  function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          reject(new Error("request body too large"));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      req.on("error", reject);
    });
  }

  async function chat(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let body: ChatRequestBody;
    try {
      body = JSON.parse(await readBody(req)) as ChatRequestBody;
    } catch (error) {
      json(res, 400, {
        error: {
          message: error instanceof Error ? error.message : String(error),
          type: "invalid_request_error",
        },
      });
      return;
    }

    const requested = typeof body.model === "string" ? body.model : "";
    const decision = policy({ model: requested, body }, config);
    // A backend may name fallbacks; they are only tried while nothing has been
    // streamed, so a host never sees half a response from one model and half
    // from another.
    const chain = [decision.backend, ...(config.backends[decision.backend]?.fallback ?? [])];

    let response: UpstreamResponse | undefined;
    let used = decision.backend;
    for (const [index, name] of chain.entries()) {
      const backend = config.backends[name];
      if (!backend) continue;
      const attempt = await forwardChat(backend, body as Record<string, unknown>, {
        fetch: doFetch,
        authorization: req.headers.authorization,
      });
      const last = index === chain.length - 1;
      if (attempt.status >= 500 && !last) {
        await attempt.body?.cancel().catch(() => undefined);
        log(`[router-proxy] ${name} answered ${attempt.status}; trying ${chain[index + 1]}`);
        continue;
      }
      response = attempt;
      used = name;
      break;
    }

    if (!response) {
      json(res, 502, {
        error: { message: "no backend answered", type: "router_error" },
      });
      return;
    }

    const headers: Record<string, string> = { "x-adaptive-route": used };
    const contentType = response.headers.get("content-type");
    if (contentType) headers["content-type"] = contentType;
    const contentLength = response.headers.get("content-length");
    if (contentLength && body.stream !== true) headers["content-length"] = contentLength;
    if (body.stream === true) {
      headers["cache-control"] = "no-cache";
      headers.connection = "keep-alive";
    }
    res.writeHead(response.status, headers);

    log(
      `[router-proxy] ${requested || "(no model)"} → ${used} ` +
        `(${config.backends[used]?.model ?? "?"}) stream=${body.stream === true} ` +
        `reason=${decision.reason}`,
    );

    if (!response.body) {
      res.end();
      return;
    }
    const stream = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
    stream.on("error", () => res.destroy());
    stream.pipe(res);
  }

  return createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    const handle = async (): Promise<void> => {
      if (req.method === "GET" && url.pathname === "/health") {
        json(res, 200, { ok: true });
        return;
      }
      if (req.method === "GET" && url.pathname === "/v1/models") {
        json(res, 200, {
          object: "list",
          data: Object.keys(config.models).map((id) => ({
            id,
            object: "model",
            owned_by: "adaptivemcp",
          })),
        });
        return;
      }
      if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
        await chat(req, res);
        return;
      }
      json(res, 404, {
        error: { message: `no route for ${req.method} ${url.pathname}`, type: "not_found" },
      });
    };

    handle().catch((error: unknown) => {
      log(`[router-proxy] ${req.method} ${req.url} failed: ${
        error instanceof Error ? error.message : String(error)
      }`);
      if (!res.headersSent) {
        json(res, 500, { error: { message: "router proxy failure", type: "router_error" } });
      } else {
        res.destroy();
      }
    });
  });
}
