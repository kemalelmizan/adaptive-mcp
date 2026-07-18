// Runtime shim so Vitest/Vite (which predates the node:sqlite builtin) can load
// it without static analysis. Uses createRequire so the import is resolved by
// Node at runtime, not by Vite's bundler.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const sqlite = require("node:sqlite");

export const DatabaseSync = sqlite.DatabaseSync;
export default sqlite;
