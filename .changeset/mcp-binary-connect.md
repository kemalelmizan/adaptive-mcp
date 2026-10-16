---
"@adaptivemcp/mcp-binary": minor
---

Add `BinaryMcpServer.connect(transport)`, so the wrapper can be hosted over any
transport instead of only stdio (`start()` is now `connect(new
StdioServerTransport())`).

Found by turning type checking on for the test suite: the only way a test could
drive the server over an in-memory linked pair was to reach through its private
`server` field. The right fix was to expose the seam that was already needed —
rather than to widen a type until the reach-around compiled.
