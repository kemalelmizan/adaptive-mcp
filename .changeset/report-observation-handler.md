---
"@adaptivemcp/extension": patch
---

Improve the `report_observation` server handler (SEP-2133 tools-metadata):

- `ExtensionController.reportObservationTool()` schema now includes an optional
  `client_id` field for per-client aggregation semantics.
- New `ExtensionController.reportObservation()` handler validates and folds a
  report into the store: `duration_ms`/`cost` must be finite and non-negative
  (else dropped), `timestamp` must be a parseable ISO-8601 date (else substituted
  with receipt time so `stats.last_observed_at` stays meaningful), and folding is
  opt-in via `foldReports` so a stateless server can register the tool as a
  no-op. `client_id` is preserved in event metadata.
- The example server (`examples/src/server.ts`) now `ensureTool`s before
  recording, stores the client-supplied `timestamp`, and gates folding with the
  `ADAPTIVE_FOLD_REPORTS` env flag (defaults to on).
