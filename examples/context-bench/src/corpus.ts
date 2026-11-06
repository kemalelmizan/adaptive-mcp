/**
 * The corpus: a small, plausible ops knowledge base with deliberate distractors.
 *
 * Each document carries the levels a context orchestrator cares about — a one-line
 * summary (the index), a body (the load), and optional pointers to other documents
 * (the dependencies). The `legacy` documents exist to be *plausible*: they share
 * vocabulary with the questions but not the answer, so a retriever that ranks by
 * similarity will happily pick them.
 */

export interface Document {
  id: string;
  title: string;
  /** One line, like a skill description: the only thing an index carries. */
  summary: string;
  body: string;
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
  },
  {
    id: "runbook-deploy",
    title: "Release runbook",
    summary: "Release runbook: build, tag, publish.",
    body: "1. Build. 2. Tag. 3. Publish. Never tag by hand — the release script does it.",
  },
  {
    id: "runbook-deploy-legacy",
    title: "Legacy release notes",
    summary: "Legacy release notes: how tags used to be created.",
    body: "Before the release script existed, tags were made by hand on the release branch.",
  },
  {
    id: "runbook-rollback",
    title: "Rollback runbook",
    summary: "Rollback runbook: how to undo a release.",
    body: "Rollback must complete within 10 minutes of the decision.",
  },
  {
    id: "oncall",
    title: "On-call policy",
    summary: "On-call escalation: primary and secondary paging.",
    body: "Page the secondary if the primary has not acknowledged after 5 minutes.",
  },
  {
    id: "oncall-secondary",
    title: "Secondary on-call notes",
    summary: "Escalation: the secondary is paged directly.",
    body: "The secondary is paged directly when the primary is offline.",
  },
  {
    id: "db-vacuum",
    title: "Database maintenance",
    summary: "Database maintenance: vacuum and analyze schedule.",
    body: "Vacuum runs at 03:00 UTC, after the billing export.",
  },
  {
    id: "auth-tokens",
    title: "Authentication tokens",
    summary: "Authentication: token lifetimes and refresh.",
    body: "Access tokens live for 15 minutes; refresh tokens for 30 days.",
  },
  {
    id: "auth-tokens-legacy",
    title: "Legacy token notes",
    summary: "Legacy authentication: tokens issued before the rotation.",
    body: "Legacy tokens never expire, which is why they were retired.",
  },
  {
    id: "billing-export",
    title: "Billing export",
    summary: "Billing export: nightly window, destination and file format.",
    body:
      "Exports are written to s3://billing-nightly at 04:00 UTC. " +
      "Read the retention policy before changing the export format.",
    seeAlso: ["retention-policy"],
  },
  {
    id: "billing-export-legacy",
    title: "Legacy billing export",
    summary: "Legacy billing export: destination and format.",
    body: "Legacy exports were written to s3://billing-legacy in the old format.",
  },
  {
    id: "retention-policy",
    title: "Data retention policy",
    summary: "Retention: how long exported data is kept.",
    body: "Export files older than 90 days are purged automatically.",
  },
  {
    id: "catalog-api",
    title: "Catalog API reference",
    summary: "Catalog API reference: batching, writes, versions.",
    body:
      "The catalog API accepts at most 500 entries per request. " +
      "Before changing a catalog write path, the constraints document applies; it is linked below.",
    seeAlso: ["catalog-constraints"],
  },
  {
    id: "catalog-constraints",
    title: "Catalog constraints",
    summary: "Catalog constraints for writes and versioning.",
    body:
      "Entry ordering must be preserved and the schema version bumped. " +
      "An approval gate also applies; the rules are linked below.",
    seeAlso: ["catalog-approval", "approval-rules-legacy"],
  },
  {
    // Two hops from the question: reachable only through catalog-api, then
    // catalog-constraints. Shares no term with the question on purpose.
    id: "catalog-approval",
    title: "Approval rules",
    summary: "Sign-off requirements for structural work.",
    body: "Two approvals are required before such a change ships.",
  },
  {
    // Vocabulary-overlap distractor: plausible, adjacent, and wrong.
    id: "approval-rules-legacy",
    title: "Approval rules (legacy)",
    summary: "Sign-off requirements: the retired workflow.",
    body: "A single sign-off was enough under the retired workflow.",
  },
  {
    // Vocabulary-overlap distractor: same words as the EU question, retired target.
    id: "constraint-eu-legacy",
    title: "EU traffic constraints (legacy)",
    summary: "EU traffic constraints: the earlier latency target.",
    body: "EU traffic was once capped at p99 5s; that target was retired.",
  },
  {
    // Vocabulary-overlap distractor: same words as the retention question, old value.
    id: "retention-policy-legacy",
    title: "Data retention policy (legacy)",
    summary: "Retention: how long exported data was kept.",
    body: "Export files were once purged after 30 days; superseded.",
  },
];
