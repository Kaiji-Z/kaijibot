import { createScopedVitestConfig } from "./vitest.scoped-config.ts";

export function createCommandsVitestConfig(env?: Record<string, string | undefined>) {
  return createScopedVitestConfig(["src/commands/**/*.test.ts"], {
    dir: "src",
    env,
    name: "commands",
    // These tests heavily mutate shared process state (plugin registries, env
    // vars, HOME overrides); without isolation the local full run produces
    // cross-file false failures (verified: 136 tests fail non-isolated, pass
    // isolated). CI already isolates; keep local runs deterministic too.
    isolate: true,
  });
}

export default createCommandsVitestConfig();
