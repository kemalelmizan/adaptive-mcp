import type { Middleware, PlannedCall, CallResult } from "@adaptivemcp/middleware";

/**
 * OAuth token storage interface.
 * Implementations can store tokens in memory, encrypted files, keychain, etc.
 */
export interface OAuthTokenStore {
  getToken(serverName: string): Promise<OAuthToken | null>;
  setToken(serverName: string, token: OAuthToken): Promise<void>;
  deleteToken(serverName: string): Promise<void>;
}

/**
 * OAuth token with metadata.
 */
export interface OAuthToken {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number; // Unix timestamp in milliseconds
  scope?: string;
  tokenType?: string;
}

/**
 * OAuth client configuration.
 */
export interface OAuthClientConfig {
  clientId: string;
  clientSecret: string;
  authUrl: string;
  tokenUrl: string;
  redirectUri: string;
  scopes: string[];
}

/**
 * OAuth credential injection middleware.
 * 
 * This middleware injects OAuth credentials into tool calls by:
 * 1. Checking if the target server requires OAuth
 * 2. Retrieving a valid access token (refreshing if needed)
 * 3. Injecting the token into the call credentials
 * 
 * Usage:
 * ```typescript
 * const oauthMiddleware = new OAuthMiddleware(memory, {
 *   "github": { clientId: "...", clientSecret: "...", ... },
 *   "google": { clientId: "...", clientSecret: "...", ... },
 * });
 * 
 * const client = new ThinClient({
 *   memory,
 *   gate: approval,
 *   middleware: [oauthMiddleware],
 * });
 * ```
 */
export class OAuthMiddleware implements Middleware {
  name = "oauth";
  
  private tokenStore: OAuthTokenStore;
  private clientConfigs: Map<string, OAuthClientConfig>;
  private serverRequiresOAuth: Set<string>;

  constructor(
    tokenStore: OAuthTokenStore,
    clientConfigs: Record<string, OAuthClientConfig>,
    serverRequiresOAuth: string[] = []
  ) {
    this.tokenStore = tokenStore;
    this.clientConfigs = new Map(Object.entries(clientConfigs));
    this.serverRequiresOAuth = new Set(serverRequiresOAuth);
  }

  /** Register a server as requiring OAuth */
  requireOAuth(serverName: string): void {
    this.serverRequiresOAuth.add(serverName);
  }

  /** Remove OAuth requirement for a server */
  unrequireOAuth(serverName: string): void {
    this.serverRequiresOAuth.delete(serverName);
  }

  /** Check if a server requires OAuth */
  requiresOAuth(serverName?: string): boolean {
    return serverName ? this.serverRequiresOAuth.has(serverName) : false;
  }

  async init(): Promise<void> {
    // No initialization needed
  }

  async beforeCall(call: PlannedCall): Promise<void> {
    const serverName = call.serverName;
    if (!serverName || !this.requiresOAuth(serverName)) {
      return; // No OAuth required for this server
    }

    const config = this.clientConfigs.get(serverName);
    if (!config) {
      throw new Error(`No OAuth config found for server: ${serverName}`);
    }

    // Get or refresh token
    const token = await this.getValidToken(serverName, config);
    if (!token) {
      throw new Error(`No valid OAuth token for server: ${serverName}. Please authenticate first.`);
    }

    // Inject credentials into the call
    call.credentials = {
      ...(call.credentials ?? {}),
      authorization: `Bearer ${token.accessToken}`,
      oauth: {
        server: serverName,
        tokenType: token.tokenType ?? "Bearer",
        scope: token.scope,
      },
    };
  }

  async afterCall(result: CallResult, call: PlannedCall): Promise<void> {
    // Check for 401 responses and attempt token refresh
    if (!result.ok && result.error?.includes("401")) {
      const serverName = call.serverName;
      if (serverName && this.requiresOAuth(serverName)) {
        const config = this.clientConfigs.get(serverName);
        if (config) {
          // Try to refresh token
          const refreshed = await this.refreshToken(serverName, config);
          if (refreshed) {
            // The retry logic in ThinClient will re-run the call with new credentials
            throw new Error("OAUTH_TOKEN_REFRESHED"); // Special error to trigger retry
          }
        }
      }
    }
  }

  async onError(err: unknown, call: PlannedCall): Promise<void> {
    // Log OAuth errors for debugging
    if (err instanceof Error && err.message.includes("OAUTH")) {
      console.error(`[OAuth] Error for ${call.serverName}:`, err.message);
    }
  }

  contributeView(): unknown {
    return {
      configuredServers: Array.from(this.clientConfigs.keys()),
      requiredServers: Array.from(this.serverRequiresOAuth),
    };
  }

  /** Get a valid access token, refreshing if necessary */
  private async getValidToken(serverName: string, config: OAuthClientConfig): Promise<OAuthToken | null> {
    const token = await this.tokenStore.getToken(serverName);
    
    if (!token) {
      return null; // No token stored
    }

    // Check if token is expired (with 5-minute buffer)
    if (token.expiresAt && token.expiresAt < Date.now() + 5 * 60 * 1000) {
      // Try to refresh
      const refreshed = await this.refreshToken(serverName, config);
      if (refreshed) {
        return refreshed;
      }
      return null; // Refresh failed
    }

    return token;
  }

  /** Refresh an OAuth token using the refresh token */
  private async refreshToken(serverName: string, config: OAuthClientConfig): Promise<OAuthToken | null> {
    const token = await this.tokenStore.getToken(serverName);
    if (!token?.refreshToken) {
      return null; // No refresh token available
    }

    try {
      const response = await fetch(config.tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Authorization": `Basic ${btoa(`${config.clientId}:${config.clientSecret}`)}`,
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: token.refreshToken,
          scope: config.scopes.join(" "),
        }),
      });

      if (!response.ok) {
        throw new Error(`Token refresh failed: ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as Record<string, unknown>;

      const newToken: OAuthToken = {
        accessToken: data.access_token as string,
        refreshToken: (data.refresh_token as string) ?? token.refreshToken,
        expiresAt: data.expires_in ? Date.now() + (data.expires_in as number) * 1000 : undefined,
        scope: data.scope as string | undefined,
        tokenType: data.token_type as string | undefined,
      };

      await this.tokenStore.setToken(serverName, newToken);
      return newToken;
    } catch (error) {
      console.error(`[OAuth] Failed to refresh token for ${serverName}:`, error);
      return null;
    }
  }

  /** Initiate OAuth authorization flow (for initial token acquisition) */
  async authorize(serverName: string): Promise<string> {
    const config = this.clientConfigs.get(serverName);
    if (!config) {
      throw new Error(`No OAuth config for server: ${serverName}`);
    }

    const state = crypto.randomUUID();
    const params = new URLSearchParams({
      response_type: "code",
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      scope: config.scopes.join(" "),
      state,
      access_type: "offline",
      prompt: "consent",
    });

    return `${config.authUrl}?${params.toString()}`;
  }

  /** Handle OAuth callback and exchange code for tokens */
  async handleCallback(serverName: string, code: string, state: string): Promise<OAuthToken> {
    if (!state) {
      throw new Error("Missing OAuth state parameter");
    }

    const config = this.clientConfigs.get(serverName);
    if (!config) {
      throw new Error(`No OAuth config for server: ${serverName}`);
    }

    const response = await fetch(config.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": `Basic ${btoa(`${config.clientId}:${config.clientSecret}`)}`,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: config.redirectUri,
      }),
    });

    if (!response.ok) {
      throw new Error(`Token exchange failed: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as Record<string, unknown>;

    const token: OAuthToken = {
      accessToken: data.access_token as string,
      refreshToken: (data.refresh_token as string) ?? undefined,
      expiresAt: data.expires_in ? Date.now() + (data.expires_in as number) * 1000 : undefined,
      scope: data.scope as string | undefined,
      tokenType: data.token_type as string | undefined,
    };

    await this.tokenStore.setToken(serverName, token);
    return token;
  }
}

/**
 * In-memory OAuth token store (for testing/development).
 * Production implementations should use secure storage.
 */
export class InMemoryOAuthTokenStore implements OAuthTokenStore {
  private tokens = new Map<string, OAuthToken>();

  async getToken(serverName: string): Promise<OAuthToken | null> {
    return this.tokens.get(serverName) ?? null;
  }

  async setToken(serverName: string, token: OAuthToken): Promise<void> {
    this.tokens.set(serverName, token);
  }

  async deleteToken(serverName: string): Promise<void> {
    this.tokens.delete(serverName);
  }
}

/**
 * Create an OAuth middleware with in-memory token store (for testing).
 */
export function createOAuthMiddleware(
  clientConfigs: Record<string, OAuthClientConfig>,
  serverRequiresOAuth: string[] = []
): OAuthMiddleware {
  const tokenStore = new InMemoryOAuthTokenStore();
  return new OAuthMiddleware(tokenStore, clientConfigs, serverRequiresOAuth);
}