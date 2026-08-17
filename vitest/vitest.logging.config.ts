import { defineConfig } from "vitest/config";
import { sharedVitestConfig } from "./vitest.shared.config.ts";

// Referenced by scripts/test-projects.test-support.mjs (VITEST_CONFIG_BY_KIND.logging)
// but was missing from the repo — `pnpm test src/logging/...` failed to resolve a
// config entry. See AGENTS.md "Known gaps".
export default defineConfig({
  ...sharedVitestConfig,
  test: {
    ...sharedVitestConfig.test,
    include: ["src/logging/**/*.test.ts"],
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
