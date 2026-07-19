# @adaptivemcp/extension

Adaptive MCP extension: derives the YAML `tools-metadata` view from the SQLite
SSOT and serves it to MCP clients.

This is the **one** package that touches the MCP protocol surface. It exposes a
single resource, `dev.adaptivemcp/tools-metadata` (mime type `application/yaml`),
as proposed in our extension draft. A server publishes it to **govern** tool adaptation
(annotations, budgets, required approvals); clients read it, learn, and report
observations back.

## Install

```bash
npm i @adaptivemcp/extension
```

Requires **Node 26**.

## Usage

```ts
import { MemoryStore } from "@adaptivemcp/memory";
import { ExtensionController } from "@adaptivemcp/extension";
import { TOOLS_METADATA_EXTENSION } from "@adaptivemcp/spec";

const store = new MemoryStore({ path: ":memory:" });
const controller = new ExtensionController({
  memory: store,
  yamlPath: "tools-metadata.yaml", // optional: persist the derived view
});

// After telemetry/evaluation have populated the SSOT:
const doc = controller.sync();        // recompute + write yamlPath (if set)
const yaml = controller.resourceText(); // the YAML string for the MCP resource
const uri = controller.resourceUri();   // "dev.adaptivemcp/tools-metadata"

console.log(uri === TOOLS_METADATA_EXTENSION); // true
```

## API

| Method | Purpose |
| --- | --- |
| `sync()` | Recompute the YAML view from the SSOT; write to `yamlPath` if configured. Returns the document. |
| `view()` | Read the current view without writing to disk. |
| `resourceUri()` | The stable `dev.adaptivemcp/tools-metadata` URI. |
| `resourceText()` | The YAML string served by the MCP resource. |
| `annotate(toolName, annotation)` | Write a static annotation into the SSOT. |

## Advertising in `initialize`

The `@modelcontextprotocol/sdk` (v1.29) includes `extensions` in its
`ServerCapabilities` schema, so a server can advertise the extension via
`capabilities.extensions`. The example server instead registers the resource
directly via `server.registerResource(...)`, the standard MCP approach
that degrades gracefully on any host that ignores unknown resources.

## License

Part of the Adaptive MCP monorepo. See the root [`README.md`](../../README.md).
