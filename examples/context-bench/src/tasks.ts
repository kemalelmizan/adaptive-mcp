/**
 * The task pack.
 *
 * Four tasks are answerable from one document whose vocabulary overlaps the
 * question. The fifth is the interesting one: the answer lives in a document that
 * shares **no terms** with the question, and is reachable only by following a
 * pointer from the document the question does match. That is the case that separates
 * relationship-aware discovery from semantic similarity.
 */

export interface BenchTask {
  id: string;
  question: string;
  /** The document that can answer it. */
  answerIn: string;
  /** True when the answer is only reachable by following a pointer. */
  hiddenDependency?: boolean;
}

export const TASKS: BenchTask[] = [
  {
    id: "rollback-window",
    question: "How long does a rollback have to complete?",
    answerIn: "runbook-rollback",
  },
  {
    id: "token-lifetime",
    question: "How long do access tokens live?",
    answerIn: "auth-tokens",
  },
  {
    id: "vacuum-schedule",
    question: "When does the database vacuum run?",
    answerIn: "db-vacuum",
  },
  {
    id: "deploy-rule",
    question: "What is the rule about tagging a release?",
    answerIn: "runbook-deploy",
  },
  {
    id: "payments-change",
    question: "I am changing the payments API default timeout. What else must I check before shipping?",
    answerIn: "constraint-eu",
    hiddenDependency: true,
  },
];
