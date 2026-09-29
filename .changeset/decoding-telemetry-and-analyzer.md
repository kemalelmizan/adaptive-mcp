---
"@adaptivemcp/spec": minor
"@adaptivemcp/routing": minor
"@adaptivemcp/runtime": minor
---

Record applied decoding in telemetry and add a decoding analyzer (ROADMAP 8d/8e).

- **spec:** `ToolExecutionEvent` gains optional `decoding` (`ToolDecoding`:
  `profile`, `resolverVersion`, `resolved`) and `usage` (`inputTokens`/
  `outputTokens`). Both additive.
- **routing:** new pure, computed-on-read `DecodingAnalyzer` — groups events by
  `(tool, profile, model, resolverVersion)` and reports failure rate, latency,
  and token averages, plus the profile it would pick next.
- **runtime:** `observeCompleted` forwards `decoding`/`usage` into the recorded
  event.
