# @adaptivemcp/middleware

Pluggable middleware chain for Adaptive MCP: transform I/O, gate calls,
inject credentials, or observe — without forking `@adaptivemcp/runtime` or
`@adaptivemcp/thin-client`.

## Install

```bash
npm i @adaptivemcp/middleware
```

Requires **Node 22+** (Node 26 recommended).

## The `Middleware` contract

Every hook is optional. `beforeCall` runs in registration order; `afterCall`
and `onError` run in reverse registration order, so the last-registered
middleware sees the final output first. `contributeView` fragments are
collected into a `{ [name]: fragment }` map, keyed by each middleware's
`name`.

```ts
import type { Middleware } from "@adaptivemcp/middleware";

const logger: Middleware = {
  name: "logger",
  async beforeCall(call) {
    console.log("calling", call.toolName, call.input);
  },
  async afterCall(result, call) {
    console.log("result", call.toolName, result.ok);
  },
};
```

Middleware must not shell out or depend on processes — that is the job of
`@adaptivemcp/mcp-binary`, the only sanctioned shell-out layer. Middleware may
call an injected MCP client (e.g. a compressor server) instead.

## `MiddlewareChain`

Holds an ordered list of middleware and runs their hooks around a single tool
execution. `AdaptiveRuntime` and `ThinClient` each own one; you can also drive
it directly:

```ts
import { MiddlewareChain } from "@adaptivemcp/middleware";
import { MemoryStore } from "@adaptivemcp/memory";

const store = new MemoryStore({ path: ":memory:" });
const chain = new MiddlewareChain({ store, toolName: "search_docs" });
chain.use(logger);

const call = { toolName: "search_docs", input: { query: "hi" } };
await chain.runBefore(call);
// ... execute the tool, set call.output ...
await chain.runAfter({ ok: true }, call);
```

## `HeadroomMiddleware`: compressing tool output

`HeadroomMiddleware` is an `afterCall` transform that compresses a tool's
textual output via a `Compressor`. If compression throws or the compressor is
unavailable, the **original** output passes through unchanged — the execution
loop is never broken by a compression failure — and the middleware records an
error note via `contributeView` instead.

```ts
import { HeadroomMiddleware, McpHeadroomCompressor } from "@adaptivemcp/middleware";

const compressor = new McpHeadroomCompressor(headroomMcpClient); // any McpCallClient
const headroom = new HeadroomMiddleware({ compressor });

chain.use(headroom);
```

`McpHeadroomCompressor` calls `headroom_compress` over an injected MCP client
(any object implementing the minimal `McpCallClient.callTool` shape — this
package never imports the MCP SDK directly) and surfaces `hash` +
`savings_percent` so the agent can later retrieve the original via
`headroom_retrieve(hash)`.

## API

| Export | Purpose |
| --- | --- |
| `Middleware` | The plugin interface: `init` / `beforeCall` / `afterCall` / `onError` / `contributeView`. |
| `MiddlewareChain` | Runs registered middleware hooks in fixed order around a tool call. |
| `PlannedCall` / `CallResult` / `MiddlewareContext` | Shapes passed to each hook. |
| `Compressor` | Transport-agnostic `compress(content, opts) -> { compressed, hash, savingsPercent }` seam. |
| `McpHeadroomCompressor` | `Compressor` implementation backed by an injected MCP client's `headroom_compress` tool. |
| `HeadroomMiddleware` | `afterCall` middleware that compresses textual output via a `Compressor`. |

## License

Released under the [MIT License](../../LICENSE). Copyright (c) 2026 Kemal Elmizan.
