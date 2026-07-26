import type { Annotation, Store, ToolRecord } from "@adaptivemcp/spec";

export type ApprovalDecision = "allow" | "deny" | "require_confirmation";

export interface ApprovalPolicy {
  /**
   * Tools annotated with these risk levels always require confirmation before
   * execution. Defaults to ["high"].
   */
  confirmRiskLevels?: Array<Annotation["risk"]>;
  /**
   * Tools whose observed failure rate meets/exceeds this threshold require
   * confirmation. Defaults to 0.2.
   */
  flakyFailureRate?: number;
  /** Tools explicitly denied (by name or glob pattern, e.g. "flaky-server/*"). */
  denyTools?: string[];
}

export interface ApprovalOptions {
  memory: Store;
  policy?: ApprovalPolicy;
  /** Minimum invocations before flaky-based gating trusts stats. */
  minInvocations?: number;
}

/**
 * Intent -> plan -> tool approval boundaries.
 *
 * The gate is the *enforcement* hook: before a tool runs, call `gate()` with the
 * planned tool. It returns `allow`, `deny`, or `require_confirmation` based on
 * the human annotation (static risk) and the learned insight (observed failure
 * rate). When `require_confirmation` is returned, the caller must obtain human
 * approval before proceeding.
 *
 * The package also writes an `approval` recommendation into the store so the YAML
 * view reflects the current approval boundary for each tool.
 */
export class ApprovalGate {
  private memory: Store;
  private policy: Required<ApprovalPolicy>;
  private minInvocations: number;

  constructor(options: ApprovalOptions) {
    this.memory = options.memory;
    const p = options.policy ?? {};
    this.policy = {
      confirmRiskLevels: p.confirmRiskLevels ?? ["high"],
      flakyFailureRate: p.flakyFailureRate ?? 0.2,
      denyTools: p.denyTools ?? [],
    };
    this.minInvocations = options.minInvocations ?? 10;
  }

  /**
   * Decide whether a planned tool call may proceed. Pass `serverName` when
   * known so the gate reads the record for the right server — otherwise, a
   * tool name shared across servers may resolve to the wrong record.
   */
  gate(toolName: string, serverName?: string): ApprovalDecision {
    const record = this.memory.getTool(toolName, serverName);

    // Check deny list with glob pattern support
    if (this.policy.denyTools.some(pattern => this.matchGlob(pattern, toolName))) {
      this.recordBoundary(toolName, "deny", serverName);
      return "deny";
    }

    const risk = record?.annotation.risk;
    if (risk && this.policy.confirmRiskLevels.includes(risk)) {
      this.recordBoundary(toolName, "require_confirmation", serverName);
      return "require_confirmation";
    }

    if (record && record.stats.invocations >= this.minInvocations) {
      if (record.stats.failureRate >= this.policy.flakyFailureRate) {
        this.recordBoundary(toolName, "require_confirmation", serverName);
        return "require_confirmation";
      }
    }

    this.recordBoundary(toolName, "allow", serverName);
    return "allow";
  }

  /**
   * Simple glob matching: * matches any characters, ? matches single character.
   * Patterns like "flaky-server/*" or "dangerous-*" are supported.
   */
  private matchGlob(pattern: string, toolName: string): boolean {
    // Escape special regex characters except * and ?
    const regexPattern = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    return new RegExp(`^${regexPattern}$`).test(toolName);
  }

  private recordBoundary(toolName: string, decision: ApprovalDecision, serverName?: string): void {
    this.memory.clearRecommendations(toolName, "approval", serverName);
    const rationale =
      decision === "deny"
        ? "Tool is explicitly denied by policy."
        : decision === "require_confirmation"
          ? "High-risk or flaky tool; human confirmation required before execution."
          : "Tool is safe to run autonomously.";
    this.memory.addRecommendation({
      toolName,
      serverName,
      type: "approval",
      payload: { decision },
      rationale,
      confidence: 1,
      generatedAt: new Date().toISOString(),
    });
  }
}

/** Helper: did the store record cross the flaky threshold? */
export function isFlaky(record: ToolRecord | undefined, threshold: number): boolean {
  return !!record && record.stats.invocations > 0 && record.stats.failureRate >= threshold;
}
