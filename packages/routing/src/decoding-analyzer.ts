import type { ToolExecutionEvent } from "@adaptivemcp/spec";
import type { DecodingProfileId } from "./decoding-advisor.js";

/** One `(tool, profile, model, resolverVersion)` grouping of observed decoding. */
export interface DecodingGroup {
  toolName: string;
  serverName?: string;
  profile: DecodingProfileId;
  model?: string;
  resolverVersion: string;
  invocations: number;
  failures: number;
  failureRate: number;
  avgDurationMs: number;
  avgInputTokens: number;
  avgOutputTokens: number;
  /** The profile the analyzer would select next, given this group's failure rate. */
  suggestedProfile: DecodingProfileId;
}

export interface DecodingAnalyzerOptions {
  /** Minimum samples before a group is reported. Default 5. */
  minSamples?: number;
  /** `failureRate` at/above which the suggestion is `deterministic`. Default 0.2. */
  highFailureRate?: number;
}

interface Accumulator {
  toolName: string;
  serverName?: string;
  profile: DecodingProfileId;
  model?: string;
  resolverVersion: string;
  invocations: number;
  failures: number;
  durationSum: number;
  durationCount: number;
  inputSum: number;
  outputSum: number;
  tokenCount: number;
}

/**
 * Pure, computed-on-read report over accumulated `decoding` telemetry
 * (ROADMAP 8d/8e). Groups events by `(tool, profile, model, resolverVersion)` —
 * unlike `Evaluator`'s per-tool aggregate — and reports retry/failure rate,
 * latency, and token usage per grouping, plus the profile it would pick next.
 *
 * Deliberately not persisted as a `Recommendation`: it is a diagnostic a
 * developer reads, mirroring `GraphAnalyzer`'s computed-on-read style.
 */
export class DecodingAnalyzer {
  private readonly minSamples: number;
  private readonly highFailureRate: number;

  constructor(options: DecodingAnalyzerOptions = {}) {
    this.minSamples = options.minSamples ?? 5;
    this.highFailureRate = options.highFailureRate ?? 0.2;
  }

  analyze(events: ToolExecutionEvent[]): DecodingGroup[] {
    const groups = new Map<string, Accumulator>();

    for (const event of events) {
      if (!event.decoding) continue;
      if (event.status !== "completed" && event.status !== "failed") continue;

      const { decoding } = event;
      const key = [
        event.toolName,
        event.serverName ?? "",
        decoding.profile,
        event.model ?? "",
        decoding.resolverVersion,
      ].join("\u0000");

      let group = groups.get(key);
      if (!group) {
        group = {
          toolName: event.toolName,
          serverName: event.serverName,
          profile: decoding.profile,
          model: event.model,
          resolverVersion: decoding.resolverVersion,
          invocations: 0,
          failures: 0,
          durationSum: 0,
          durationCount: 0,
          inputSum: 0,
          outputSum: 0,
          tokenCount: 0,
        };
        groups.set(key, group);
      }

      group.invocations += 1;
      if (event.status === "failed") group.failures += 1;
      if (typeof event.durationMs === "number") {
        group.durationSum += event.durationMs;
        group.durationCount += 1;
      }
      const inputTokens = event.usage?.inputTokens;
      const outputTokens = event.usage?.outputTokens;
      if (inputTokens !== undefined || outputTokens !== undefined) {
        group.inputSum += inputTokens ?? 0;
        group.outputSum += outputTokens ?? 0;
        group.tokenCount += 1;
      }
    }

    return [...groups.values()]
      .filter((group) => group.invocations >= this.minSamples)
      .map((group) => {
        const failureRate = group.failures / group.invocations;
        return {
          toolName: group.toolName,
          serverName: group.serverName,
          profile: group.profile,
          model: group.model,
          resolverVersion: group.resolverVersion,
          invocations: group.invocations,
          failures: group.failures,
          failureRate: Number(failureRate.toFixed(4)),
          avgDurationMs: group.durationCount ? Math.round(group.durationSum / group.durationCount) : 0,
          avgInputTokens: group.tokenCount ? Math.round(group.inputSum / group.tokenCount) : 0,
          avgOutputTokens: group.tokenCount ? Math.round(group.outputSum / group.tokenCount) : 0,
          suggestedProfile: failureRate >= this.highFailureRate ? "deterministic" : group.profile,
        };
      })
      .sort((a, b) => b.failureRate - a.failureRate || b.invocations - a.invocations);
  }
}
