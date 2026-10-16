---
"@adaptivemcp/thin-client": minor
---

Fail closed on an unconfigured approver.

`requestApproval` defaulted to **approve**, so a host that never wired an
approver silently ran every tool the gate marked `require_confirmation` — a tool
a policy had flagged for a human, in a mode where nobody is asked. The default is
now **deny**: auto-approval is an explicit opt-in (`requestApproval: () => true`).
The denial is recorded as `"approval denied"` rather than `"approval denied by
user"`, since in this path no user was involved.
