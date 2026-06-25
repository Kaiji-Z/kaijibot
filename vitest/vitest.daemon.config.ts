import { createScopedVitestConfig } from "./vitest.scoped-config.ts";

export function createDaemonVitestConfig(env?: Record<string, string | undefined>) {
  return createScopedVitestConfig(["src/daemon/**/*.test.ts", "src/cli/daemon-cli/**/*.test.ts"], {
    dir: "src",
    env,
    name: "daemon",
  });
}

export default createDaemonVitestConfig();
