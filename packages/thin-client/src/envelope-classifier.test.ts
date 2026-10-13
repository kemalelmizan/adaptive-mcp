import { describe, it, expect } from "vitest";
import { envelopeClassifier } from "./envelope-classifier.js";

const ctx = { toolName: "qc_profile", serverName: "qc" };

describe("envelopeClassifier", () => {
  it("flips an in-band error status to a failure and keeps the error code", () => {
    const classify = envelopeClassifier();
    expect(classify({ ok: true, output: { status: "error", error: "POLICY_DENIED" } }, ctx)).toEqual({
      ok: false,
      error: "POLICY_DENIED",
    });
  });

  it("leaves already-failed and successful outcomes alone", () => {
    const classify = envelopeClassifier();
    expect(classify({ ok: false, error: "boom" }, ctx)).toBeUndefined();
    expect(classify({ ok: true, output: { status: "ok", data: { rows: 1 } } }, ctx)).toBeUndefined();
  });

  it("ignores non-object outputs", () => {
    const classify = envelopeClassifier();
    expect(classify({ ok: true, output: "plain text" }, ctx)).toBeUndefined();
    expect(classify({ ok: true, output: ["a", "b"] }, ctx)).toBeUndefined();
    expect(classify({ ok: true, output: null }, ctx)).toBeUndefined();
    expect(classify({ ok: true }, ctx)).toBeUndefined();
  });

  it("matches failure values case-insensitively", () => {
    const classify = envelopeClassifier();
    expect(classify({ ok: true, output: { status: "FAILED" } }, ctx)?.ok).toBe(false);
  });

  it("supports custom field names and failure values", () => {
    const classify = envelopeClassifier({
      statusField: "result",
      failureValues: ["denied"],
      errorField: "reason",
    });
    expect(classify({ ok: true, output: { result: "denied", reason: "no grant" } }, ctx)).toEqual({
      ok: false,
      error: "no grant",
    });
    expect(classify({ ok: true, output: { result: "allowed" } }, ctx)).toBeUndefined();
  });

  it("honors an extra isFailure predicate", () => {
    const classify = envelopeClassifier({ isFailure: (out) => out.ok === false });
    expect(classify({ ok: true, output: { ok: false } }, ctx)?.ok).toBe(false);
  });

  it("falls back to a synthetic message when no error field is present", () => {
    const classify = envelopeClassifier();
    expect(classify({ ok: true, output: { status: "error" } }, ctx)).toEqual({
      ok: false,
      error: "in-band failure (status=error)",
    });
  });
});
