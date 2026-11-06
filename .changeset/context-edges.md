---
"@adaptivemcp/spec": minor
"@adaptivemcp/memory": minor
---

Persist dependency edges between context items.

`ContextEdge` / `ContextRelation` and optional `Store.recordContextEdge` /
`contextEdges`: a `context_edges` table (migration 7), idempotent per
`(from, to, relation)` so a host can re-derive its edges on every startup without
growing the table, with `requires` and `see-also` kept apart because they mean
different things to a host deciding what to follow.

The shape and the record are shared; traversal — how many hops, what to do on a cycle,
whether to follow at all — stays host policy, the same split as pause/resume. This is
what the benchmark's hidden-dependency task needs: an answer that is reachable only
through a pointer.
