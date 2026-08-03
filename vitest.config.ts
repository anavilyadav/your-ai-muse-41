// Standalone config, deliberately NOT extending vite.config.ts — that file
// is managed by @lovable.dev/vite-tanstack-config and explicitly warns
// against adding plugins manually.
//
// Two projects:
//   node  — pure logic (IST boundaries, money math, db.ts with a mocked
//           Supabase client). No DOM, fastest, where the money-critical
//           suites live.
//   dom   — component smoke tests that need a real DOM.
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/lib/**/*.ts"],
      exclude: ["src/lib/**/*.test.ts", "src/lib/lovable-error-reporting.ts"],
      // Floor, not a target. Raise it as suites land; never lower it.
      thresholds: { statements: 12, branches: 45, functions: 20, lines: 12 },
    },
    projects: [
      {
        plugins: [tsconfigPaths()],
        test: {
          name: "node",
          environment: "node",
          include: ["src/**/*.test.ts"],
        },
      },
      {
        plugins: [tsconfigPaths(), react()],
        test: {
          name: "dom",
          environment: "jsdom",
          include: ["src/**/*.test.tsx"],
          setupFiles: ["./src/test/setup-dom.ts"],
        },
      },
    ],
  },
});
