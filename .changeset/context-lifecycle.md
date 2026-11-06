---
"@adaptivemcp/spec": minor
"@adaptivemcp/memory": minor
---

Persist the retention lifecycle of context items.

`ContextLifecycle` / `ContextLifecycleState` and optional
`Store.setContextLifecycle` / `contextLifecycle` / `contextLifecycles`: a
`context_lifecycle` table (migration 8), one row per item, rewritten in place so a
sweep never grows the table.

Only two states, `active` and `archived`, because a state the system cannot decide is
decoration: `evicted` is the absence of a record, and `restore` is a write back to
`active`. `pinned` outranks `expiresAt` — a sweep may archive anything expired and
unpinned, but it must not archive a pin. _When_ to sweep is the host's policy, the same
split as edges and pause/resume.
