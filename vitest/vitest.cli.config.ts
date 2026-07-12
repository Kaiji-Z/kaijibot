import { defineConfig } from "vitest/config";
import { sharedVitestConfig } from "./vitest.shared.config.ts";

// Temporary config for running CLI tests while the canonical
// vitest/vitest.cli.config.ts is not present in the repo. See AGENTS.md
// "Known gaps" section — the canonical CLI project config is missing.
export default defineConfig({
  ...sharedVitestConfig,
  test: {
    ...sharedVitestConfig.test,
    include: ["src/cli/**/*.test.ts"],
    exclude: [
      "dist/**",
      "test/fixtures/**",
      "**/node_modules/**",
      "**/vendor/**",
      "**/*.live.test.ts",
      "**/*.e2e.test.ts",
    ],
    passWithNoTests: false,
  },
});
