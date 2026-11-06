/**
 * The corpus: a small, plausible ops knowledge base.
 *
 * Each document carries the three levels a context orchestrator cares about — a
 * one-line summary (the index), a body (the load), and an optional pointer to
 * another document (the dependency). The bodies are short on purpose: the benchmark
 * measures *availability and cost*, not comprehension of a long text.
 */

export interface Document {
  id: string;
  title: string;
  /** One line, like a skill description: the only thing an index carries. */
  summary: string;
  body: string;
  /** The exact string that answers a task, when one asks for it. */
  fact?: string;
  /** Documents a reader of this one is told to read next. */
  seeAlso?: string[];
}

export const CORPUS: Document[] = [
  {
    id: "api-payments",
    title: "Payments API reference",
    summary: "Payments API reference: timeouts, retries, idempotency keys.",
    body:
      "The default request timeout is 900ms and retries are capped at two. " +
      "Every write needs an idempotency key. " +
      "There is one further constraint on this API before a change ships; see the pointer below.",
    seeAlso: ["constraint-eu"],
  },
  {
    id: "constraint-eu",
    title: "EU traffic constraints",
    summary: "EU data residency and latency constraints.",
    body:
      "EU traffic must keep p99 under 2s, and its data must stay in eu-west-1. " +
      "This applies to any change that affects request latency or routing.",
    fact: "p99 under 2s",
  },
  {
    id: "runbook-deploy",
    title: "Release runbook",
    summary: "Release runbook: build, tag, publish.",
    body: "1. Build. 2. Tag. 3. Publish. Never tag by hand — the release script does it.",
    fact: "Never tag by hand",
  },
  {
    id: "runbook-rollback",
    title: "Rollback runbook",
    summary: "Rollback runbook: how to undo a release.",
    body: "Rollback must complete within 10 minutes of the decision.",
    fact: "10 minutes",
  },
  {
    id: "oncall",
    title: "On-call policy",
    summary: "On-call escalation policy and paging.",
    body: "Page the secondary if the primary has not acknowledged after 5 minutes.",
    fact: "5 minutes",
  },
  {
    id: "db-vacuum",
    title: "Database maintenance",
    summary: "Database maintenance: vacuum and analyze schedule.",
    body: "Vacuum runs at 03:00 UTC, after the billing export.",
    fact: "03:00 UTC",
  },
  {
    id: "auth-tokens",
    title: "Authentication tokens",
    summary: "Authentication: token lifetimes and refresh.",
    body: "Access tokens live for 15 minutes; refresh tokens for 30 days.",
    fact: "15 minutes",
  },
  {
    id: "billing-export",
    title: "Billing export",
    summary: "Billing export: nightly window and destination.",
    body: "Exports are written to s3://billing-nightly at 04:00 UTC.",
    fact: "s3://billing-nightly",
  },
];
