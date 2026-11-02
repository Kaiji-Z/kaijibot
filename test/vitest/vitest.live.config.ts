import { defineConfig } from "vitest/config";
import { sharedVitestConfig } from "../../vitest/vitest.shared.config.ts";

// Live suites (**/*.live.test.ts) call real LLM / web-search APIs and are
// excluded from every normal vitest project. This config is the dedicated
// entrypoint used by `pnpm test:live` (scripts/test-live.mjs, which sets
// KAIJIBOT_LIVE_TEST=1). Suites self-skip (describe.skip) when the flag or
// their API keys are absent — local-only by operator decision 2026.8.22.
export default defineConfig({
  ...sharedVitestConfig,
  test: {
    ...sharedVitestConfig.test,
    include: ["**/*.live.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/vendor/**"],
    passWithNoTests: false,
    testTimeout: 180_000,
    fileParallelism: false,
  },
});
