import { defineConfig } from "vitest/config";
import { sharedVitestConfig } from "./vitest.shared.config.ts";

// Temporary config for wizard tests while the canonical
// vitest/vitest.wizard.config.ts is not present in the repo. See AGENTS.md
// "Known gaps" section — the canonical wizard project config is referenced by
// scripts/test-projects.mjs but missing on disk.
export default defineConfig({
  ...sharedVitestConfig,
  test: {
    ...sharedVitestConfig.test,
    include: ["src/wizard/**/*.test.ts"],
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
