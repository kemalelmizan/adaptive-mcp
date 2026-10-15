// Local-directory entrypoint for OpenCode V2.
//
// For a *directory* plugin target, OpenCode (≥ 2.0) probes only a root-level
// `server.*` or `index.*` file — `package.json` `main`/`exports` are consulted
// only when the target is an npm package name. This shim makes the package
// directory itself config-loadable:
//
//   { "plugins": [{ "package": "<path>/packages/opencode-plugin", "options": {} }] }
//
// npm consumers are unaffected: they resolve through `exports["."]` → dist.
// Requires `pnpm build` (re-exports the compiled output).
export * from "./dist/index.js";
export { default } from "./dist/index.js";
