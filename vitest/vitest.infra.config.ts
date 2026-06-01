import { createScopedVitestConfig } from "./vitest.scoped-config.ts";
import { unitFastTestFiles } from "./vitest.unit-fast-paths.mjs";

export function createInfraVitestConfig(env?: Record<string, string | undefined>) {
  return createScopedVitestConfig(["src/infra/**/*.test.ts"], {
    dir: "src",
    env,
    exclude: unitFastTestFiles,
    name: "infra",
  });
}

export default createInfraVitestConfig();
