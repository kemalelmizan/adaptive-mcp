---
"@adaptivemcp/mcp-binary": patch
---

Security: bump `@modelcontextprotocol/sdk` to `^1.32.2`, `zod` to `^4.6.6`, and update transitive overrides.

- `@adaptivemcp/mcp-binary`: bump `@modelcontextprotocol/sdk` (`^1.30.1` → `^1.32.2`) and `zod` (`^4.0.0` → `^4.6.6`).
- Workspace `overrides` in `pnpm-workspace.yaml` replace exact pins with patched semver floors (`hono`, `@hono/node-server`, `body-parser`, `qs`, `proxy-addr`, `express-rate-limit`, `ip-address`, `fast-uri`, `js-yaml`) so transitive advisories stay resolved without blocking future point releases.
