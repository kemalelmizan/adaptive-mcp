import type { ToolResultClassifier } from "@adaptivemcp/spec";

export interface EnvelopeClassifierOptions {
  /** Object key holding the overall status. Default `"status"`. */
  statusField?: string;
  /**
   * Status values (case-insensitive) that mean the call failed. Default
   * `["error", "failed", "failure"]`.
   */
  failureValues?: string[];
  /** Object key holding the error code/message. Default `"error"`. */
  errorField?: string;
  /**
   * Parse a JSON-string output before inspecting it. Most MCP servers serialize
   * their envelope as text content (there is no `structuredContent` for a plain
   * `dict`), so the payload arrives as a string. The parse is guarded and only
   * attempted for strings that start with `{`. Default `true`.
   */
  parseJsonString?: boolean;
  /**
   * Optional extra predicate. Return `true` to force a failure even when the
   * status field did not match (e.g. a domain-specific `ok: false` field).
   */
  isFailure?: (output: Record<string, unknown>) => boolean;
}

/** Coerce an output to the envelope object, parsing a JSON string when allowed. */
function asRecord(output: unknown, parseJsonString: boolean): Record<string, unknown> | undefined {
  if (typeof output === "string") {
    if (!parseJsonString) return undefined;
    const trimmed = output.trim();
    if (!trimmed.startsWith("{")) return undefined;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return undefined;
    }
    return undefined;
  }
  if (output === null || typeof output !== "object" || Array.isArray(output)) return undefined;
  return output as Record<string, unknown>;
}

/**
 * A `ToolResultClassifier` for the common "in-band error envelope" shape: a tool
 * returns a *successful* transport result whose JSON payload carries a status
 * that actually signals failure, for example:
 *
 * ```json
 * { "status": "error", "error": "POLICY_DENIED", "message": "…" }
 * ```
 *
 * Pass it to `ThinClient` as `classifyResult` so such payloads are recorded as
 * failures (and can trigger the retry policy) instead of false successes.
 *
 * Only object outputs are inspected; strings, arrays, and `null` pass through.
 */
export function envelopeClassifier(
  options: EnvelopeClassifierOptions = {},
): ToolResultClassifier {
  const statusField = options.statusField ?? "status";
  const errorField = options.errorField ?? "error";
  const failureValues = new Set(
    (options.failureValues ?? ["error", "failed", "failure"]).map((value) => value.toLowerCase()),
  );

  const parseJsonString = options.parseJsonString ?? true;

  return (outcome) => {
    if (!outcome.ok) return undefined;
    const record = asRecord(outcome.output, parseJsonString);
    if (!record) return undefined;

    const status = record[statusField];
    const failedByStatus = typeof status === "string" && failureValues.has(status.toLowerCase());
    const failedByPredicate = options.isFailure?.(record) === true;
    if (!failedByStatus && !failedByPredicate) return undefined;

    const raw = record[errorField];
    const error =
      typeof raw === "string" && raw.length > 0
        ? raw
        : `in-band failure (${statusField}=${String(status)})`;
    return { ok: false, error };
  };
}
