import { describe, it, expect } from "vitest";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { answersCorrectly, askModel, modelFromEnv } from "./model.js";

describe("model answers", () => {
  it("accepts the fact in any case", () => {
    expect(answersCorrectly("10 Minutes.", "10 minutes")).toBe(true);
    expect(answersCorrectly("never tag by hand", "Never tag by hand")).toBe(true);
  });

  it("treats a number word as its digits", () => {
    // "ten minutes" is the same answer as "10 minutes" — the fact is the meaning.
    expect(answersCorrectly("ten minutes", "10 minutes")).toBe(true);
    expect(answersCorrectly("It takes fifteen minutes.", "15 minutes")).toBe(true);
  });

  it("does not accept a paraphrase that misses the fact", () => {
    expect(answersCorrectly("about an hour", "10 minutes")).toBe(false);
    expect(answersCorrectly("unknown", "10 minutes")).toBe(false);
  });

  it("reads the endpoint from flags, then env, and stays off otherwise", () => {
    expect(modelFromEnv([], {})).toBeUndefined();
    expect(modelFromEnv([], { CONTEXT_BENCH_MODEL: "http://x/v1" })).toEqual({
      baseURL: "http://x/v1",
      model: "local",
    });
    expect(modelFromEnv(["--model", "http://y/v1", "--model-name", "qwen"], {})).toEqual({
      baseURL: "http://y/v1",
      model: "qwen",
    });
  });

  it("reads an API key from the flag, then env, and never logs it", () => {
    expect(modelFromEnv(["--model", "http://y/v1", "--api-key", "flag-key"], {})).toMatchObject({
      apiKey: "flag-key",
    });
    expect(
      modelFromEnv(["--model", "http://y/v1"], { CONTEXT_BENCH_API_KEY: "env-key" }),
    ).toMatchObject({ apiKey: "env-key" });
    // A key in the flag wins over the environment.
    expect(
      modelFromEnv(["--model", "http://y/v1", "--api-key", "flag-key"], {
        CONTEXT_BENCH_API_KEY: "env-key",
      }),
    ).toMatchObject({ apiKey: "flag-key" });
    expect(modelFromEnv(["--model", "http://y/v1"], {})).not.toHaveProperty("apiKey");
  });

  it("sends the API key as a bearer token, and nothing when absent", async () => {
    const seen: Array<string | undefined> = [];
    const server = createServer((request, response) => {
      seen.push(request.headers.authorization);
      request.resume();
      request.on("end", () => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            choices: [{ message: { content: "10 minutes" } }],
          }),
        );
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    try {
      await askModel(
        { baseURL: `http://127.0.0.1:${port}/v1`, model: "m", apiKey: "secret-key" },
        "context",
        "question",
      );
      await askModel({ baseURL: `http://127.0.0.1:${port}/v1`, model: "m" }, "context", "question");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    expect(seen[0]).toBe("Bearer secret-key");
    expect(seen[1]).toBeUndefined();
  });

  it("turns on the strict answer constraint only when asked", () => {
    expect(modelFromEnv(["--model", "http://y/v1"], {})).toEqual({
      baseURL: "http://y/v1",
      model: "local",
    });
    expect(modelFromEnv(["--model", "http://y/v1", "--strict"], {})).toMatchObject({
      strict: true,
    });
  });
});
