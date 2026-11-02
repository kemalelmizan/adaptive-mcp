import { describe, it, expect } from "vitest";
import { forwardChat, upstreamBody, upstreamHeaders } from "./forward.js";

const backend = {
  baseURL: "http://127.0.0.1:8082/v1",
  model: "qwen3-8b",
  chatTemplateKwargs: { enable_thinking: false },
};

describe("upstream body", () => {
  it("rewrites the model and applies the backend's template knobs", () => {
    const body = upstreamBody({ model: "adaptive/fast", messages: [] }, backend);

    expect(body.model).toBe("qwen3-8b");
    expect(body.chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(body.messages).toEqual([]);
  });

  it("lets the backend's knobs win over the host's", () => {
    // A host must not be able to re-enable thinking on a server that is configured
    // to answer directly — the knobs describe how that server is started.
    const body = upstreamBody(
      { model: "adaptive/fast", chat_template_kwargs: { enable_thinking: true, other: 1 } },
      backend,
    );

    expect(body.chat_template_kwargs).toEqual({ enable_thinking: false, other: 1 });
  });

  it("leaves the body alone when the backend has no knobs", () => {
    const body = upstreamBody({ model: "x" }, { baseURL: "http://h/v1", model: "m" });

    expect(body.chat_template_kwargs).toBeUndefined();
  });
});

describe("upstream headers", () => {
  it("uses the backend's own key when it names one", () => {
    const headers = upstreamHeaders(
      { ...backend, apiKeyEnv: "LOCAL_KEY" },
      { authorization: "Bearer host-token", env: { LOCAL_KEY: "server-key" } },
    );

    expect(headers.authorization).toBe("Bearer server-key");
  });

  it("passes the host's authorization through when the backend names no key", () => {
    expect(upstreamHeaders(backend, { authorization: "Bearer host-token" }).authorization).toBe(
      "Bearer host-token",
    );
    expect(upstreamHeaders(backend, {}).authorization).toBeUndefined();
  });

  it("asks for an event stream only when the request streams", () => {
    expect(upstreamHeaders(backend, { stream: true }).accept).toBe("text/event-stream");
    expect(upstreamHeaders(backend, { stream: false }).accept).toBe("application/json");
  });
});

describe("forwardChat", () => {
  it("posts to <baseURL>/chat/completions with the rewritten body", async () => {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;

    const result = await forwardChat(backend, { model: "adaptive/fast", stream: false }, {
      fetch: fakeFetch,
    });

    expect(seen[0]?.url).toBe("http://127.0.0.1:8082/v1/chat/completions");
    expect(JSON.parse(String(seen[0]?.init.body))).toMatchObject({ model: "qwen3-8b" });
    expect(result.status).toBe(200);
    expect(result.headers.get("content-type")).toBe("application/json");
  });

  it("hands back a failing status rather than throwing, so the caller can fall back", async () => {
    const fakeFetch = (async () => new Response("boom", { status: 503 })) as unknown as typeof fetch;

    const result = await forwardChat(backend, { model: "x" }, { fetch: fakeFetch });

    expect(result.status).toBe(503);
  });
});
