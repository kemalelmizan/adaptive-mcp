import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { parseConfig } from "./config.js";
import { createApp } from "./app.js";

interface Recorded {
  method?: string;
  url?: string;
  authorization?: string;
  body: Record<string, unknown>;
}

/** A stand-in backend that records what the proxy sent and replies however the test wants. */
async function startUpstream(
  reply: (res: ServerResponse, body: Record<string, unknown>) => void,
): Promise<{ baseURL: string; requests: Recorded[]; close: () => Promise<void> }> {
  const requests: Recorded[] = [];
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let text = "";
    req.on("data", (chunk: Buffer) => (text += chunk.toString()));
    req.on("end", () => {
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(text) as Record<string, unknown>;
      } catch {
        // a test may deliberately send junk; the recording still matters
      }
      requests.push({
        method: req.method,
        url: req.url,
        authorization: req.headers.authorization,
        body,
      });
      reply(res, body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    baseURL: `http://127.0.0.1:${port}/v1`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function startProxy(configPath: Parameters<typeof createApp>[0]): Promise<{
  url: string;
  close: () => Promise<void>;
}> {
  const server = createApp(configPath, { log: () => undefined });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function replyJson(res: ServerResponse, payload: unknown, status = 200): void {
  const text = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(text),
  });
  res.end(text);
}

const config = parseConfig({
  listen: { host: "127.0.0.1", port: 8083 },
  backends: {
    primary: {
      baseURL: "http://placeholder/v1",
      model: "qwen3-8b",
      chatTemplateKwargs: { enable_thinking: false },
      fallback: ["backup"],
    },
    backup: { baseURL: "http://placeholder/v1", model: "cloud-large" },
  },
  models: {
    "adaptive/fast": { backend: "primary" },
    "adaptive/auto": { policy: "auto" },
  },
  defaultBackend: "backup",
});

let upstreams: Array<{ close: () => Promise<void> }> = [];
let proxies: Array<{ close: () => Promise<void> }> = [];

beforeEach(() => {
  upstreams = [];
  proxies = [];
});

afterEach(async () => {
  await Promise.all(proxies.map((proxy) => proxy.close()));
  await Promise.all(upstreams.map((upstream) => upstream.close()));
});

describe("router proxy", () => {
  it("answers /health and lists the virtual models", async () => {
    const proxy = await startProxy(config);
    proxies.push(proxy);

    expect(await (await fetch(`${proxy.url}/health`)).json()).toEqual({ ok: true });
    const models = (await (await fetch(`${proxy.url}/v1/models`)).json()) as {
      data: Array<{ id: string }>;
    };
    expect(models.data.map((model) => model.id).sort()).toEqual(["adaptive/auto", "adaptive/fast"]);
  });

  it("routes a virtual model to its backend, rewriting the model and knobs", async () => {
    const primary = await startUpstream((res) =>
      replyJson(res, { choices: [{ message: { role: "assistant", content: "hi" } }] }),
    );
    upstreams.push(primary);
    const proxy = await startProxy({
      ...config,
      backends: {
        ...config.backends,
        primary: { ...config.backends.primary!, baseURL: primary.baseURL },
      },
    });
    proxies.push(proxy);

    const response = await fetch(`${proxy.url}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer host" },
      body: JSON.stringify({ model: "adaptive/fast", messages: [{ role: "user", content: "hi" }] }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("x-adaptive-route")).toBe("primary");
    expect(((await response.json()) as { choices: unknown[] }).choices).toHaveLength(1);

    expect(primary.requests[0]?.url).toBe("/v1/chat/completions");
    expect(primary.requests[0]?.body.model).toBe("qwen3-8b");
    expect(primary.requests[0]?.body.chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(primary.requests[0]?.authorization).toBe("Bearer host");
  });

  it("forwards a streamed response chunk for chunk, with the route header", async () => {
    const primary = await startUpstream((res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write('data: {"delta":"he"}\n\n');
      res.write('data: {"delta":"llo"}\n\n');
      res.end("data: [DONE]\n\n");
    });
    upstreams.push(primary);
    const proxy = await startProxy({
      ...config,
      backends: {
        ...config.backends,
        primary: { ...config.backends.primary!, baseURL: primary.baseURL },
      },
    });
    proxies.push(proxy);

    const response = await fetch(`${proxy.url}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "adaptive/fast", stream: true, messages: [] }),
    });

    expect(response.headers.get("x-adaptive-route")).toBe("primary");
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    const text = await response.text();
    expect(text).toContain('data: {"delta":"he"}');
    expect(text).toContain('data: {"delta":"llo"}');
    expect(text).toContain("data: [DONE]");
  });

  it("falls back when a backend fails before anything is streamed", async () => {
    const primary = await startUpstream((res) => replyJson(res, { error: "down" }, 503));
    const backup = await startUpstream((res) =>
      replyJson(res, { choices: [{ message: { content: "from backup" } }] }),
    );
    upstreams.push(primary, backup);
    const proxy = await startProxy({
      ...config,
      backends: {
        primary: { ...config.backends.primary!, baseURL: primary.baseURL },
        backup: { ...config.backends.backup!, baseURL: backup.baseURL },
      },
    });
    proxies.push(proxy);

    const response = await fetch(`${proxy.url}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "adaptive/fast", messages: [] }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("x-adaptive-route")).toBe("backup");
    expect(((await response.json()) as { choices: Array<{ message: { content: string } }> }).choices[0]
      ?.message.content).toBe("from backup");
    expect(primary.requests).toHaveLength(1);
    expect(backup.requests[0]?.body.model).toBe("cloud-large");
  });

  it("routes `auto` and unknown ids to the default backend", async () => {
    const backup = await startUpstream((res) => replyJson(res, { choices: [] }));
    upstreams.push(backup);
    const proxy = await startProxy({
      ...config,
      backends: {
        ...config.backends,
        backup: { ...config.backends.backup!, baseURL: backup.baseURL },
      },
    });
    proxies.push(proxy);

    for (const model of ["adaptive/auto", "not/configured"]) {
      const response = await fetch(`${proxy.url}/v1/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model, messages: [] }),
      });
      expect(response.headers.get("x-adaptive-route")).toBe("backup");
    }
    expect(backup.requests.map((request) => request.body.model)).toEqual([
      "cloud-large",
      "cloud-large",
    ]);
  });

  it("rejects a body that is not JSON, and an unknown path", async () => {
    const proxy = await startProxy(config);
    proxies.push(proxy);

    const bad = await fetch(`${proxy.url}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{ not json",
    });
    expect(bad.status).toBe(400);

    const missing = await fetch(`${proxy.url}/v1/nope`);
    expect(missing.status).toBe(404);
  });
});
