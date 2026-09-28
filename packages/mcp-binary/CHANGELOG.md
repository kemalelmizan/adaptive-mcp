# @adaptivemcp/mcp-binary

## 0.1.1

### Patch Changes

- 2391b13: Security: bump runtime dependency versions.

  - `@adaptivemcp/extension`: `js-yaml` `^4.1.0` → `^4.3.2` (patched release).
  - `@adaptivemcp/mcp-binary`: `@modelcontextprotocol/sdk` `^1.29.0` → `^1.30.1`.
  - Workspace `overrides` (in `pnpm-workspace.yaml`) pin patched transitives the
    MCP SDK pulls (hono, `@hono/node-server`, express → qs, ajv → fast-uri) plus
    `ip-address`, and the dev-only `js-yaml@3` tree. `pnpm audit --prod` now
    reports 0 runtime advisories.

- Updated dependencies [9df0b31]
  - @adaptivemcp/spec@0.3.0
