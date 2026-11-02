import { describe, it, expect } from "vitest";
import { parseConfig } from "./config.js";
import { explicitPolicy } from "./policy.js";

const config = parseConfig({
  listen: { host: "127.0.0.1", port: 8083 },
  backends: {
    cloud: { baseURL: "http://127.0.0.1:8787/v1", model: "deepseek" },
    coder: { baseURL: "http://127.0.0.1:8080/v1", model: "qwen3-coder-30b" },
  },
  models: {
    coder: { backend: "coder" },
    auto: { policy: "auto" },
  },
  defaultBackend: "cloud",
});

describe("explicit policy", () => {
  it("sends an explicitly mapped virtual model to its backend", () => {
    expect(explicitPolicy({ model: "adaptive/coder", body: {} }, config)).toEqual({
      backend: "coder",
      reason: "virtual model adaptive/coder",
    });
  });

  it("sends `auto` to the default backend, and says there is no recommendation yet", () => {
    const decision = explicitPolicy({ model: "adaptive/auto", body: {} }, config);

    expect(decision.backend).toBe("cloud");
    expect(decision.reason).toContain("no learned recommendation");
  });

  it("resolves a virtual model with or without its provider prefix", () => {
    // A host sends the id it has configured; `adaptive/coder` and `coder` are the
    // same request as far as the router is concerned.
    expect(explicitPolicy({ model: "coder", body: {} }, config).backend).toBe("coder");
    expect(explicitPolicy({ model: "adaptive/coder", body: {} }, config).backend).toBe("coder");
  });

  it("sends an unknown model to the default backend, naming it in the reason", () => {
    const decision = explicitPolicy({ model: "something/else", body: {} }, config);

    expect(decision.backend).toBe("cloud");
    expect(decision.reason).toContain("something/else");
  });

  it("has a reason for an empty model, too", () => {
    expect(explicitPolicy({ model: "", body: {} }, config).reason).toContain("unknown model");
  });
});
