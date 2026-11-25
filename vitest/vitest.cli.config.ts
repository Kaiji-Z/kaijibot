import { createScopedVitestConfig } from "./vitest.scoped-config.ts";

export function createCliVitestConfig(env?: Record<string, string | undefined>) {
  return createScopedVitestConfig(["src/cli/**/*.test.ts"], {
    dir: "src",
    env,
    // Force isolation locally too, so a scoped `pnpm test src/cli/<file>` run
    // stays deterministic (CI already isolates via resolveVitestIsolation).
    isolate: true,
    name: "cli",
  });
}

export default createCliVitestConfig();
