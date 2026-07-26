import type { Middleware, MiddlewareContext, PlannedCall, CallResult } from "./middleware.js";
import type { CompressOptions, Compressor } from "./compressor.js";

export interface HeadroomMiddlewareOptions {
  /** The compressor to use (typically `McpHeadroomCompressor`). */
  compressor: Compressor;
  /**
   * Predicate deciding whether a tool's output should be compressed. Defaults to
   * compressing every tool whose output is a string. Shell-like tools (e.g.
   * `run_shell_command`) are good candidates; skip tools that return structured
   * binary payloads.
   */
  shouldCompress?: (call: PlannedCall, ctx: MiddlewareContext) => boolean;
  /** Compression options forwarded to the compressor. */
  compressOptions?: CompressOptions;
}

function defaultShouldCompress(call: PlannedCall): boolean {
  return typeof call.output === "string";
}

/**
 * `afterCall` Transform I/O middleware that compresses a tool's textual output
 * via a `Compressor` (doubts.md §12d, headroom integration).
 *
 * Behavior (D9): if compression throws or the compressor is unavailable, the
 * middleware passes the **original** output through unchanged and records a
 * `contributeView` note — the execution loop is never broken by compression.
 *
 * The compressed `hash` + `savings_percent` are surfaced via `contributeView`
 * so the agent can later call `headroom_retrieve(hash)` for the original.
 */
export class HeadroomMiddleware implements Middleware {
  readonly name = "headroom";
  private compressor: Compressor;
  private shouldCompress: (call: PlannedCall, ctx: MiddlewareContext) => boolean;
  private compressOptions?: CompressOptions;
  private lastResult?: { hash?: string; savingsPercent?: number; skipped?: boolean; error?: string };

  constructor(options: HeadroomMiddlewareOptions) {
    this.compressor = options.compressor;
    this.shouldCompress = options.shouldCompress ?? defaultShouldCompress;
    this.compressOptions = options.compressOptions;
  }

  async afterCall(
    _result: CallResult,
    call: PlannedCall,
    ctx: MiddlewareContext,
  ): Promise<void> {
    this.lastResult = undefined;
    if (!this.shouldCompress(call, ctx)) {
      this.lastResult = { skipped: true };
      return;
    }
    const original = call.output as string;
    try {
      const compressed = await this.compressor.compress(original, this.compressOptions);
      call.output = compressed.compressed;
      this.lastResult = {
        hash: compressed.hash,
        savingsPercent: compressed.savingsPercent,
      };
    } catch (err) {
      // Passthrough on failure (D9): keep the original output, note the error.
      this.lastResult = { error: err instanceof Error ? err.message : String(err) };
    }
  }

  contributeView(): unknown {
    if (!this.lastResult) return undefined;
    return this.lastResult;
  }
}
