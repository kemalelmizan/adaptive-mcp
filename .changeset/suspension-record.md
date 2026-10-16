---
"@adaptivemcp/spec": minor
"@adaptivemcp/memory": minor
---

Add the **suspension** record — the durable half of pause/resume (ADR-004).

`Suspension` (`id`, `sessionId`, `kind`, `question`, `responseSchema?`,
`resumeState?`, `status`, `answer?`, `reason?`, `createdAt`, `resolvedAt?`) joins
the shared types, with **optional** `Store` methods — the same pattern the graph
methods use — so a backend that cannot persist a paused run simply omits them:

- `recordSuspension`, `getSuspension`, `getSuspensions(sessionId, status?)`,
- `resolveSuspension(id, { status, answer?, reason? })`.

`@adaptivemcp/memory` implements them in a new `suspensions` table (migration 5).
Resolving is **idempotent**: an already-resolved record is returned unchanged, so
a replayed resume cannot overwrite the first answer — the same hazard
`langgraph` documents, since its resume re-executes the node it resumed into.

Nothing about graphs, threads or schedulers is implied: the _shape_ is shared so
every host records a pause the same way, and the **host** (which may suspend, who
may answer, how a resume is applied) owns the policy.
