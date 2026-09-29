import { describe, it, expect, vi, afterEach } from "vitest";
import type { PlannedCall } from "@adaptivemcp/middleware";
import {
  OAuthMiddleware,
  InMemoryOAuthTokenStore,
  createOAuthMiddleware,
  type OAuthClientConfig,
} from "./oauth-middleware.js";

const config: OAuthClientConfig = {
  clientId: "id",
  clientSecret: "secret",
  authUrl: "https://auth.example/authorize",
  tokenUrl: "https://auth.example/token",
  redirectUri: "http://localhost/cb",
  scopes: ["read", "write"],
};

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    statusText: ok ? "OK" : "Unauthorized",
    json: async () => body,
  } as Response;
}

function call(serverName: string): PlannedCall {
  return { toolName: "do_thing", serverName, input: {} };
}

describe("OAuthMiddleware", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("authorize returns an authorization URL with client/scope/state", async () => {
    const middleware = createOAuthMiddleware({ github: config });
    const url = new URL(await middleware.authorize("github"));
    expect(url.origin + url.pathname).toBe("https://auth.example/authorize");
    expect(url.searchParams.get("client_id")).toBe("id");
    expect(url.searchParams.get("scope")).toBe("read write");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("state")).toMatch(/[0-9a-f-]{36}/);
  });

  it("handleCallback exchanges a code when the state matches", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ access_token: "at", refresh_token: "rt", expires_in: 3600, token_type: "Bearer" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const store = new InMemoryOAuthTokenStore();
    const middleware = new OAuthMiddleware(store, { github: config });

    const url = new URL(await middleware.authorize("github"));
    const token = await middleware.handleCallback("github", "code123", url.searchParams.get("state")!);

    expect(token.accessToken).toBe("at");
    expect(await store.getToken("github")).toMatchObject({ accessToken: "at", refreshToken: "rt" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("handleCallback rejects an unknown/forged state (CSRF)", async () => {
    const middleware = new OAuthMiddleware(new InMemoryOAuthTokenStore(), { github: config });
    await expect(middleware.handleCallback("github", "code", "not-issued")).rejects.toThrow(/state/);
  });

  it("handleCallback rejects a state issued for another server", async () => {
    const middleware = new OAuthMiddleware(new InMemoryOAuthTokenStore(), {
      github: config,
      gitlab: config,
    });
    const url = new URL(await middleware.authorize("github"));
    await expect(
      middleware.handleCallback("gitlab", "code", url.searchParams.get("state")!),
    ).rejects.toThrow(/match/);
  });

  it("beforeCall injects a Bearer token for an OAuth server", async () => {
    const store = new InMemoryOAuthTokenStore();
    await store.setToken("github", { accessToken: "tok", expiresAt: Date.now() + 3_600_000 });
    const middleware = new OAuthMiddleware(store, { github: config }, ["github"]);

    const planned = call("github");
    await middleware.beforeCall(planned);
    expect(planned.credentials?.authorization).toBe("Bearer tok");
  });

  it("beforeCall is a no-op for servers that don't require OAuth", async () => {
    const middleware = new OAuthMiddleware(new InMemoryOAuthTokenStore(), { github: config }, ["github"]);
    const planned = call("other");
    await middleware.beforeCall(planned);
    expect(planned.credentials).toBeUndefined();
  });

  it("beforeCall throws when no token is available", async () => {
    const middleware = new OAuthMiddleware(new InMemoryOAuthTokenStore(), { github: config }, ["github"]);
    await expect(middleware.beforeCall(call("github"))).rejects.toThrow(/No valid OAuth token/);
  });

  it("refreshes an expiring token before use", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ access_token: "new", expires_in: 3600 }));
    vi.stubGlobal("fetch", fetchMock);
    const store = new InMemoryOAuthTokenStore();
    await store.setToken("github", { accessToken: "old", refreshToken: "rt", expiresAt: Date.now() + 1000 });
    const middleware = new OAuthMiddleware(store, { github: config }, ["github"]);

    const planned = call("github");
    await middleware.beforeCall(planned);
    expect(planned.credentials?.authorization).toBe("Bearer new");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("refreshes on a 401 without throwing", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ access_token: "after401", expires_in: 3600 }));
    vi.stubGlobal("fetch", fetchMock);
    const store = new InMemoryOAuthTokenStore();
    await store.setToken("github", {
      accessToken: "old",
      refreshToken: "rt",
      expiresAt: Date.now() + 3_600_000,
    });
    const middleware = new OAuthMiddleware(store, { github: config }, ["github"]);

    await expect(
      middleware.afterCall({ ok: false, error: "HTTP 401 Unauthorized" }, call("github")),
    ).resolves.toBeUndefined();
    expect(await store.getToken("github")).toMatchObject({ accessToken: "after401" });
  });

  it("contributeView lists configured and required servers", () => {
    const middleware = new OAuthMiddleware(new InMemoryOAuthTokenStore(), { github: config }, ["github"]);
    expect(middleware.contributeView()).toEqual({
      configuredServers: ["github"],
      requiredServers: ["github"],
    });
  });
});
