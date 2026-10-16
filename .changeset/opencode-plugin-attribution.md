---
"@adaptivemcp/opencode-plugin": minor
---

Attribute MCP tool calls to their server and classify non-zero exits as failures.

- **`server_name` is now derived** for MCP tools. OpenCode names them
  `<server>_<tool>` but omits the server from the hook payload; the adapter reads
  the host's server list (`ctx.mcp.list()`) and attributes the call, so
  `headroom_headroom_compress` records as server `headroom`, tool
  `headroom_compress`.
- **A `shell` call whose result exits non-zero is recorded as a failure.**
  OpenCode reports such calls as `status: "completed"`, so the learned failure
  rate previously stayed 0 for the most common failure class. Configurable via
  `treatNonZeroExitAsFailure` (`"non-zero"` default, `"gte2"` to treat `exit: 1`
  as a negative result, `"off"` to trust the host).
- **`dbPath` now defaults to `$XDG_DATA_HOME/adaptivemcp/adaptive.db`** (with
  `tools-metadata.yaml` beside it), so learned metadata persists out of the box;
  `":memory:"` is still available for an ephemeral store.
