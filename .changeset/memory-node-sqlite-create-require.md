---
"@adaptivemcp/memory": patch
---

Load `node:sqlite` via `createRequire` (with a type-only import) instead of a
bare `import "node:sqlite"`. Most bundlers' builtin lists predate the builtin, so
consuming `memory` as a dependency (e.g. the first-party agent under Vite/Vitest)
mis-resolved it as the package `sqlite` and failed. Behaviour is unchanged.
