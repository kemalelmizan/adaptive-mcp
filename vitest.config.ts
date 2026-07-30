import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Vite 5.x does not recognize `node:sqlite` as a builtin and tries to resolve it
// as the bare package `sqlite`. Alias it to a runtime shim that loads the
// builtin via createRequire (resolved by Node, not Vite's bundler).
export default defineConfig({
  resolve: {
    alias: {
      "node:sqlite": fileURLToPath(new URL("./vitest.sqlite-shim.mjs", import.meta.url)),
    },
  },
  test: {
    include: ["packages/*/src/**/*.test.ts", "examples/src/**/*.test.ts"],
    environment: "node",
    reporters: ["dot"],
  },
});
