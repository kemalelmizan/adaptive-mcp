/**
 * The task pack.
 *
 * Eight tasks are answerable from one document whose vocabulary overlaps the
 * question. Two are not: their answer lives in a document sharing **no terms** with
 * the question, reachable only by following a pointer from the document the question
 * does match. Those two are the ones that separate relationship-aware discovery from
 * semantic similarity.
 *
 * The `legacy` documents are distractors: they match the questions' words and hold
 * the wrong facts, so precision and pollution mean something.
 */

export interface BenchTask {
  id: string;
  question: string;
  /** The document that can answer it. */
  answerIn: string;
  /** The exact string that answers it — the task owns it, so one document can answer several. */
  answer: string;
  /** True when the answer is only reachable by following a pointer. */
  hiddenDependency?: boolean;
}

export const TASKS: BenchTask[] = [
  {
    id: "rollback-window",
    question: "How long does a rollback have to complete?",
    answerIn: "runbook-rollback",
    answer: "10 minutes",
  },
  {
    id: "token-lifetime",
    question: "How long do access tokens live?",
    answerIn: "auth-tokens",
    answer: "15 minutes",
  },
  {
    id: "refresh-lifetime",
    question: "How long do refresh tokens live?",
    answerIn: "auth-tokens",
    answer: "30 days",
  },
  {
    id: "vacuum-schedule",
    question: "When does the database vacuum run?",
    answerIn: "db-vacuum",
    answer: "03:00 UTC",
  },
  {
    id: "deploy-rule",
    question: "What is the rule about tagging a release?",
    answerIn: "runbook-deploy",
    answer: "Never tag by hand",
  },
  {
    id: "oncall-escalation",
    question: "After how long is the secondary paged?",
    answerIn: "oncall",
    answer: "5 minutes",
  },
  {
    id: "billing-destination",
    question: "Where are nightly billing exports written?",
    answerIn: "billing-export",
    answer: "s3://billing-nightly",
  },
  {
    id: "export-window",
    question: "At what time are billing exports produced?",
    answerIn: "billing-export",
    answer: "04:00 UTC",
  },
  {
    id: "payments-change",
    question:
      "I am changing the payments API default timeout. What else must I check before shipping?",
    answerIn: "constraint-eu",
    answer: "p99 under 2s",
    hiddenDependency: true,
  },
  {
    id: "billing-change",
    question: "I am changing the billing export file format. What should I check?",
    answerIn: "retention-policy",
    answer: "90 days",
    hiddenDependency: true,
  },
  {
    id: "catalog-change",
    question:
      "I am changing how the catalog API batches writes. What must I check before shipping?",
    answerIn: "catalog-approval",
    answer: "Two approvals",
    hiddenDependency: true,
  },
];
