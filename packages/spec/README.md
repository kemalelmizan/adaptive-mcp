# @adaptivemcp/spec

Extension identifiers, event schemas, and shared types for Adaptive MCP.

This package is the dependency-light foundation every other `@adaptivemcp/*`
package builds on. It owns the canonical identifiers (the SEP-2133
`dev.adaptivemcp/` namespace), the `ToolExecutionEvent` observation schema, and
the shared `ToolRecord` / `Insight` / `Recommendation` / `Annotation` types.

> MCP sets the contract; Adaptive MCP learns the behavior. `spec` defines the
> vocabulary both sides speak.

## Install

```bash
npm i @adaptivemcp/spec
```

Requires **Node 26** (native TypeScript type stripping; no build step needed to
consume the published types).

## What's inside

| Export | Purpose |
| --- | --- |
| `EXTENSION_NAMESPACE` | `"dev.adaptivemcp/"` — the reversed-domain namespace. |
| `TOOLS_METADATA_EXTENSION` | `"dev.adaptivemcp/tools-metadata"` — the single proposed MCP extension (SEP-2133) resource identifier. |
| `PACKAGE_IDENTIFIERS` | Internal reversed-domain identifiers for client-side packages (namespacing only, not advertised as extensions). |
| `isExtensionIdentifier(value)` | Predicate: does a string start with `dev.adaptivemcp/`? |
| `packageIdentifier(name)` | Resolve an internal package identifier by name. |
| `ToolExecutionEvent` | The atomic observation of a tool execution (feeds telemetry, evaluation, memory). |
| `ToolRecord`, `ToolStats` | The persisted shape of a tool's metadata and observed stats. |
| `Insight`, `Recommendation`, `Annotation` | Learned / advised / static metadata about a tool. |
| `createToolEvent(ctx, status, extra?)` | Ergonomic constructor for `ToolExecutionEvent`. |
| `SPEC_VERSION` | The spec version this package implements. |

## Example

```ts
import {
  TOOLS_METADATA_EXTENSION,
  EXTENSION_NAMESPACE,
  isExtensionIdentifier,
  createToolEvent,
} from "@adaptivemcp/spec";

console.log(TOOLS_METADATA_EXTENSION); // "dev.adaptivemcp/tools-metadata"
console.log(isExtensionIdentifier("dev.adaptivemcp/tools-metadata")); // true

const event = createToolEvent(
  { toolName: "deploy_service", serverName: "ci" },
  "completed",
  { durationMs: 1200, model: "gpt-5-mini" },
);
```

## Relationship to MCP

`spec` does **not** introduce new MCP primitives. It defines the identifiers and
types used by `@adaptivemcp/extension`, which exposes a single
`dev.adaptivemcp/tools-metadata` **resource** (SEP-2133 compliant — a server
governs static policy, clients learn and report back). See
[`docs/sep-2133-tools-metadata.md`](../../docs/sep-2133-tools-metadata.md).

## License

Part of the Adaptive MCP monorepo. See the root [`README.md`](../../README.md).
