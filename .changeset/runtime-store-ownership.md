---
"@adaptivemcp/runtime": patch
---

Close only a store the runtime created.

`AdaptiveRuntime.close()` called `memory.close()` unconditionally, so a runtime built
on an **injected** `store` closed the caller's store — the documented "swap in a
file-backed or remote store" path, and exactly the case where sharing happens (a
parent runtime and its child sessions over one store). Nothing threw at the close;
the failure surfaced later, in the _other_ runtime, as `database is not open`
(ERR_INVALID_STATE).

An injected store now belongs to the caller, who closes it. The self-created path
is unchanged, so no leak is introduced.
