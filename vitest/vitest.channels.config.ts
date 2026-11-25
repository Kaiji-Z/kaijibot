import { createScopedVitestConfig } from "./vitest.scoped-config.ts";

export function createChannelsVitestConfig(env?: Record<string, string | undefined>) {
  return createScopedVitestConfig(["src/channels/**/*.test.ts"], {
    dir: "src",
    env,
    name: "channels",
    passWithNoTests: true,
  });
}

export default createChannelsVitestConfig();
