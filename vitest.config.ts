// Standalone config, deliberately NOT extending vite.config.ts — that file
// is managed by @lovable.dev/vite-tanstack-config and explicitly warns
// against adding plugins manually. These are plain-function unit tests
// (no React rendering, no routing), so they don't need any of that.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
