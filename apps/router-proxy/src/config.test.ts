import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, parseConfig } from "./config.js";

/** A minimal valid document, mutated per test. */
function valid(): Record<string, unknown> {
  return {
    listen: { host: "127.0.0.1", port: 8083 },
    backends: {
      cloud: { baseURL: "http://127.0.0.1:8787/v1", model: "deepseek" },
      coder: {
        baseURL: "http://127.0.0.1:8080/v1/",
        model: "qwen3-coder-30b",
        chatTemplateKwargs: { enable_thinking: false },
        fallback: ["cloud"],
      },
    },
    models: {
      "adaptive/coder": { backend: "coder" },
      "adaptive/auto": { policy: "auto" },
    },
    defaultBackend: "cloud",
  };
}

describe("router config", () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("reads backends, virtual models, and normalises a trailing slash", () => {
    const config = parseConfig(valid());

    expect(config.listen).toEqual({ host: "127.0.0.1", port: 8083 });
    expect(config.backends.coder?.baseURL).toBe("http://127.0.0.1:8080/v1");
    expect(config.backends.coder?.chatTemplateKwargs).toEqual({ enable_thinking: false });
    expect(config.models["adaptive/auto"]).toEqual({ policy: "auto" });
    expect(config.defaultBackend).toBe("cloud");
  });

  it("rejects a virtual model that names a backend that does not exist", () => {
    const document = valid() as { models: Record<string, unknown> };
    document.models["adaptive/typo"] = { backend: "codr" };

    expect(() => parseConfig(document)).toThrow(/models\.adaptive\/typo\.backend names unknown backend "codr"/);
  });

  it("rejects a fallback that names a backend that does not exist", () => {
    const document = valid() as { backends: Record<string, { fallback?: string[] }> };
    document.backends.coder!.fallback = ["clod"];

    expect(() => parseConfig(document)).toThrow(/fallback names unknown backend "clod"/);
  });

  it("rejects a port that is not a port, and a model with no target", () => {
    const badPort = valid() as { listen: { port: number } };
    badPort.listen.port = 70000;
    expect(() => parseConfig(badPort)).toThrow(/listen\.port/);

    const badModel = valid() as { models: Record<string, unknown> };
    badModel.models["adaptive/nothing"] = {};
    expect(() => parseConfig(badModel)).toThrow(/"backend" or \{"policy": "auto"\}/);

    const badDefault = valid() as { defaultBackend: string };
    badDefault.defaultBackend = "nowhere";
    expect(() => parseConfig(badDefault)).toThrow(/defaultBackend/);
  });

  it("names the file when it cannot be read or parsed", () => {
    dir = mkdtempSync(join(tmpdir(), "router-config-"));
    const missing = join(dir, "absent.json");
    expect(() => loadConfig(missing)).toThrow(/could not read router config/);

    const broken = join(dir, "broken.json");
    writeFileSync(broken, "{ not json");
    expect(() => loadConfig(broken)).toThrow(/could not parse router config/);
  });

  it("loads a file that passes validation", () => {
    dir = mkdtempSync(join(tmpdir(), "router-config-"));
    const path = join(dir, "ok.json");
    writeFileSync(path, JSON.stringify(valid()));

    expect(loadConfig(path).defaultBackend).toBe("cloud");
  });
});
