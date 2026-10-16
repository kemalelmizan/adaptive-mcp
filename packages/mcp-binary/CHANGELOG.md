# @adaptivemcp/mcp-binary

## 0.2.0

### Minor Changes

- ecc9b70: Add `BinaryMcpServer.connect(transport)`, so the wrapper can be hosted over any
  transport instead of only stdio (`start()` is now `connect(new
StdioServerTransport())`).

  Found by turning type checking on for the test suite: the only way a test could
  drive the server over an in-memory linked pair was to reach through its private
  `server` field. The right fix was to expose the seam that was already needed —
  rather than to widen a type until the reach-around compiled.

### Patch Changes

- 580d8c2: Internal dependencies now use caret ranges (`workspace:^`) instead of exact pins.

  pnpm rewrote `workspace:*` to an exact version on publish, so a consumer mixing
  `@adaptivemcp/*` packages from different releases could end up with two copies of
  the same package (duplicate state, `instanceof` mismatches, no dedupe). The
  ranges are now compatible (`^x.y.z`), so a resolver picks one copy.

- 06c094a: Drop dependencies that were declared but never imported.

  `@adaptivemcp/evaluation` declared six internal dependencies
  (approval, extension, orchestration, routing, telemetry, thin-client) that only
  its cross-package conformance _test_ imports, so installing it pulled ten
  transitive `@adaptivemcp/*` packages instead of three. They move to
  `devDependencies`. Five packages declared `@adaptivemcp/memory` but only import it from
  tests (their source takes the `Store` interface from `spec`) — it moves to
  `devDependencies`. `@adaptivemcp/opencode-plugin` drops three and
  `@adaptivemcp/mcp-binary` one. Fewer packages installed, and a declared
  graph that matches the real one.

## 0.1.2

### Patch Changes

- Updated dependencies [175358c]
- Updated dependencies [46edecd]
- Updated dependencies [d28b0fb]
  - @adaptivemcp/spec@0.4.0

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
