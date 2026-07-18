import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  test: {
    include: [root + "packages/*/src/**/*.test.ts"],
    environment: "node",
    reporters: ["dot"],
  },
});
