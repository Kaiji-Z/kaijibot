import { createScopedVitestConfig } from "./vitest.scoped-config.ts";
import { jsdomOptimizedDeps } from "./vitest.shared.config.ts";

// Referenced by scripts/test-projects.test-support.mjs (VITEST_CONFIG_BY_KIND.ui)
// but was missing from the repo — `pnpm test ui/...` failed to resolve a config
// entry. Runs the jsdom/node control-ui test lane from the repo root; the
// browser lane (*.browser.test.ts) needs Playwright browser binaries and stays
// in ui/'s own `pnpm test` (see AGENTS.md "Testing Guidelines").
export default createScopedVitestConfig(["ui/src/**/*.test.ts"], {
  deps: jsdomOptimizedDeps,
  dir: "ui",
  environment: "jsdom",
  exclude: ["ui/src/**/*.browser.test.ts"],
  includeKaijiBotRuntimeSetup: false,
  isolate: true,
  name: "ui",
  passWithNoTests: true,
  setupFiles: ["ui/src/test-helpers/lit-warnings.setup.ts"],
});
