import { createScopedVitestConfig } from "./vitest.scoped-config.ts";
import { unitFastTestFiles } from "./vitest.unit-fast-paths.mjs";

export function createHooksVitestConfig(env?: Record<string, string | undefined>) {
  return createScopedVitestConfig(["src/hooks/**/*.test.ts"], {
    dir: "src",
    env,
    exclude: unitFastTestFiles,
    name: "hooks",
    passWithNoTests: true,
  });
}

export default createHooksVitestConfig();
