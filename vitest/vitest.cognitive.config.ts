import { defineConfig } from "vitest/config";
import { sharedVitestConfig } from "./vitest.shared.config.ts";

// Temporary config for cognitive tests while the canonical CLI/i18n/cognitive
// project configs are not present in the repo. See AGENTS.md "Known gaps".
export default defineConfig({
  ...sharedVitestConfig,
  test: {
    ...sharedVitestConfig.test,
    include: ["src/cognitive/**/*.test.ts"],
    setupFiles: ["src/cognitive/test-setup.ts"],
    fileParallelism: false,
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
