import { describe, it, expect } from "vitest";
import { answersCorrectly, modelFromEnv } from "./model.js";

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
    expect(
      modelFromEnv(["--model", "http://y/v1", "--model-name", "qwen"], {}),
    ).toEqual({ baseURL: "http://y/v1", model: "qwen" });
  });
});
