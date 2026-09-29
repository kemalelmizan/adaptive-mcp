---
"@adaptivemcp/runtime": minor
---

`AdaptiveRuntimeOptions` gains `routerModels`, `routerBudget`, and
`routerMinInvocations`, forwarded to the internal `Router`. Hosts that own a
model catalog can now pass their selectable model ids so `model` recommendations
reference models they can actually run (previously the Router's two-model preset
was always used).
