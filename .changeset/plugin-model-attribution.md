---
"@adaptivemcp/opencode-plugin": minor
---

Record which model served each tool call.

The plugin previously recorded every call with no model at all, so learned
statistics could not tell one model from another and a model recommendation had
nothing to compare. V1 reports this on `chat.params`; V2 has no such hook, so the
adapter subscribes to the `session.model.selected` event (present in v2.0.32) and
attributes calls to `provider/model`. The model is captured when the call starts,
so a mid-turn switch does not relabel earlier calls.
