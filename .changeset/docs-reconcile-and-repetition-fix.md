---
"@adaptivemcp/evaluation": patch
---

Wire `Evaluator.detectRepetition()` into `evaluateWorkflow()` so the
`repetition_detected` insight is actually emitted. The detection logic existed
but had no callers (dead code), so the insight never reached the store; it is now
produced for repeated 2–4 tool subsequences in a session's execution graph and
attributed to the workflow id (previously the constant string `"workflow"`).
