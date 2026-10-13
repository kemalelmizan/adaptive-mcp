import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const packagesDir = fileURLToPath(new URL("./packages", import.meta.url));

// Resolve every workspace package to its TypeScript source. Tests otherwise reach
// the built `dist/` through the package name, which makes v8 coverage report
// those packages as 0% even when they are exercised. Same-package relative
// imports already resolve to source, so this just makes cross-package imports
// consistent (and keeps tests running against the code under test).
const workspaceAliases = Object.fromEntries(
  readdirSync(packagesDir)
    .filter((name) => existsSync(join(packagesDir, name, "src", "index.ts")))
    .map((name) => [`@adaptivemcp/${name}`, join(packagesDir, name, "src", "index.ts")]),
);

// Vite 5.x does not recognize `node:sqlite` as a builtin and tries to resolve it
// as the bare package `sqlite`. Alias it to a runtime shim that loads the
// builtin via createRequire (resolved by Node, not Vite's bundler).
export default defineConfig({
  resolve: {
    alias: {
      "node:sqlite": fileURLToPath(new URL("./vitest.sqlite-shim.mjs", import.meta.url)),
      ...workspaceAliases,
    },
  },
  test: {
    include: ["packages/*/src/**/*.test.ts", "examples/src/**/*.test.ts"],
    environment: "node",
    reporters: ["dot"],
    coverage: {
      provider: "v8",
      reporter: ["text-summary"],
      include: ["packages/*/src/**/*.ts"],
      exclude: ["**/*.test.ts", "**/index.ts", "**/dist/**"],
      // Ratcheted just below the current aggregate (2026-10-13): a regression
      // gate, not an aspiration. Raise as coverage improves.
      thresholds: { statements: 89, branches: 82, functions: 86, lines: 89 },
    },
  },
});
