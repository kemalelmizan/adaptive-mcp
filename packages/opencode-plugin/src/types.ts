export interface OpencodePluginOptions {
  /** SQLite path for the SSOT. Defaults to in-memory. */
  dbPath?: string;
  /** Where to write the derived YAML view. */
  yamlPath?: string;
  /** Enable execution graph tracking. */
  enableGraph?: boolean;
  /** Custom approval policy. */
  approvalPolicy?: {
    confirmRiskLevels?: Array<"low" | "medium" | "high">;
    flakyFailureRate?: number;
    denyTools?: string[];
  };
  /** OAuth client configurations for credential injection. */
  oauthConfigs?: Record<string, {
    clientId: string;
    clientSecret: string;
    authUrl: string;
    tokenUrl: string;
    redirectUri: string;
    scopes: string[];
  }>;
  /** Servers that require OAuth. */
  oauthRequiredServers?: string[];
}