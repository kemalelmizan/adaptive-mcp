---
"@adaptivemcp/spec": minor
"@adaptivemcp/memory": minor
---

Keep the order a host declared for context edges.

`ContextEdge.ordinal` and migration 9: `context_edges` gains an `ordinal` column, and
`contextEdges()` orders by `(from_item, relation, ordinal, to_item)` instead of by the
target's name.

Pointer order is meaningful — a document lists what to read first — and without it a host
following the recorded edges follows them alphabetically. That is how the second-hop
benchmark caught it: `catalog-constraints` declares the answer first and a distractor
second, and the adaptive strategy read the distractor, spent its budget, and never reached
the answer.

Recording with no ordinal appends (`max + 1` for that document), so a host that records in
declaration order needs to think about nothing; re-recording the same edge keeps its place
and replaces its reason. Existing rows get `0` and fall back to the previous ordering.
