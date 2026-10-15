---
"@adaptivemcp/thin-client": minor
---

`ToolHandler` now receives a `ToolHandlerCallContext` as its second argument
(`toolName`, `serverName`, `credentials`). Middleware that resolves auth in
`beforeCall` (e.g. `OAuthMiddleware`, which writes `PlannedCall.credentials`)
can now have those credentials reach the transport — previously they were
written and never read by anything but the middleware itself. Existing
single-argument handlers remain valid.
