---
"@adaptivemcp/spec": patch
"@adaptivemcp/memory": patch
"@adaptivemcp/telemetry": patch
"@adaptivemcp/evaluation": patch
"@adaptivemcp/extension": patch
---

Add per-package README files and include them in the published npm tarballs
(previously the `files` allowlist shipped only `dist`, so package pages on npm
showed "This package does not have a README"). Each published package now ships
usage examples, API tables, and its relationship to the MCP extension surface.
