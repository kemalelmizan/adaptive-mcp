---
"@adaptivemcp/spec": minor
"@adaptivemcp/memory": minor
---

Add the **task list** and **typed memory steps** — the durable half of two more
components ADR-004 places in `spec` (the orchestrator's shared task list, and the
planning pass's steps).

`spec` gains three records and the optional `Store` methods that persist them,
following the same pattern as the suspension record:

- **`Task`** — `id`, `sessionId`, `title`, `description?`, `status`, `assignee?`,
  `dependencies[]`, `parentId?`, `result?`, `notes?`, `createdAt`, `updatedAt?`.
  `TaskStatus` is `agno`'s five states (`pending`, `in_progress`, `completed`,
  `failed`, `blocked`) plus `cancelled`, because a host that can suspend a run also
  needs a word for _given up on_ rather than _failed_.
- **`ActionStep`** — what was attempted and how it went (`summary`, `toolName?`,
  `error?`, `durationMs?`, `correlationId?`). It is the intent-and-outcome view a
  run replays from, **not** a second copy of telemetry: a host that also records the
  execution graph sets `correlationId` and the bodies stay where they already live.
- **`PlanStep`** — a plan as ordered intents plus the `reasoning?` that produced it.
  Keeping the plan as a record is what makes a planning interval meaningful.
- `StepRecord` is their union and `StepKind` its discriminator, so a reader can
  distinguish _intended_ / _planned_ / _done_ in one pass.

`@adaptivemcp/memory` persists them in a new migration (6) and implements the
methods:

- `recordTask`, `getTask`, `getTasks(sessionId, { status?, assignee?, parentId? })`,
  `updateTask(id, patch)` — an upsert plus the transition helper, which stamps
  `updatedAt` and **does not police transitions**: moving status from any state is
  the host's policy, not the store's;
- `readyTasks(sessionId)` — the dependency-ordering read, and the reason
  dependencies are their own table rather than a JSON column: _pending, with every
  dependency completed, oldest first_ is one SQL question that stays correct as
  statuses move. A dependency that matches no task **blocks** rather than
  unblocking, so a typo or a stale id fails closed;
- `recordStep`, `getStep`, `getSteps(sessionId, { kind? })` — action and plan steps
  share one table under a `kind` discriminator, so `getSteps` can return a session's
  **whole history in order** (tasks, plans and actions merged, ties broken on id),
  which is what "typed steps, replayable" means in practice.

Nothing here implies a coordinator, a scheduler or a mode enum: `orchestration`
still owns _execution composition_, and the planning pass needs the model, so it is
the host's. The shapes exist so two hosts record the same work the same way.
