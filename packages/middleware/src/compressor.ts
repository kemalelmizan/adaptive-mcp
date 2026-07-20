/**
 * Transport-agnostic compression seam (doubts.md §12c / D7).
 *
 * A `Compressor` turns a tool's textual output into a smaller form and (optionally)
 * returns a `hash` the agent can later use to retrieve the original. The default
 * implementation is **MCP-client backed** — it calls `headroom_compress` on an
 * injected MCP client — but any implementation (e.g. the headroom-ai TS SDK
 * `compress()`) satisfies the same interface, so middleware depends on the
 * abstraction, never on a binary.
 */
export interface Compressor {
  compress(
    content: string,
    opts?: CompressOptions,
  ): Promise<CompressResult>;
}

export interface CompressOptions {
  /** Target model for token budgeting, if the backend supports it. */
  model?: string;
  /** Soft token budget; backends may use it to size the compression. */
  tokenBudget?: number;
}

export interface CompressResult {
  compressed: string;
  /** Opaque handle (e.g. a CCR hash) the agent can use to retrieve the original. */
  hash?: string;
  /** Percentage of tokens/bytes saved, if the backend reports it. */
  savingsPercent?: number;
}

/**
 * Minimal shape of the headroom MCP server's `headroom_compress` tool result
 * (doubts.md §12d). We depend only on this structural subset, not on the full
 * SDK client type, so `@adaptivemcp/middleware` stays free of the MCP SDK dep.
 */
export interface HeadroomCompressResult {
  compressed: string;
  hash?: string;
  original_tokens?: number;
  compressed_tokens?: number;
  savings_percent?: number;
}

/**
 * An MCP client that can call `headroom_compress`. Mirrors the tiny slice of the
 * SDK `Client.callTool` we need, so this package does not import the SDK.
 */
export interface McpCallClient {
  callTool(args: {
    name: string;
    arguments: Record<string, unknown>;
  }): Promise<{ content: Array<{ type: string; text?: string }> }>;
}

/**
 * `Compressor` implementation backed by the headroom MCP server (D7, option A).
 *
 * It calls `headroom_compress` over an injected MCP client and parses the
 * JSON-encoded text content. If the call throws or the result is malformed, the
 * compressor rethrows so the calling middleware can decide on passthrough (D9).
 */
export class McpHeadroomCompressor implements Compressor {
  private client: McpCallClient;

  constructor(client: McpCallClient) {
    this.client = client;
  }

  async compress(content: string, opts?: CompressOptions): Promise<CompressResult> {
    const res = await this.client.callTool({
      name: "headroom_compress",
      arguments: {
        content,
        ...(opts?.model ? { model: opts.model } : {}),
        ...(opts?.tokenBudget ? { token_budget: opts.tokenBudget } : {}),
      },
    });
    const text = res.content.find((c) => c.type === "text")?.text;
    if (!text) {
      throw new Error("headroom_compress returned no text content");
    }
    const parsed = JSON.parse(text) as HeadroomCompressResult;
    return {
      compressed: parsed.compressed,
      hash: parsed.hash,
      savingsPercent:
        parsed.savings_percent ??
        (parsed.original_tokens && parsed.compressed_tokens
          ? Math.round((1 - parsed.compressed_tokens / parsed.original_tokens) * 100)
          : undefined),
    };
  }
}
