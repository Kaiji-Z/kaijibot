import { createScopedVitestConfig } from "./vitest.scoped-config.ts";

export function createGatewayVitestConfig(env?: Record<string, string | undefined>) {
  return createScopedVitestConfig(["src/gateway/**/*.test.ts"], {
    dir: "src",
    env,
    name: "gateway",
    // Heavy socket/handshake suites on shared CI runners have a long flake
    // tail (preauth timing, auth-rotation, node-invoke connect budgets — a
    // different test each run). The chronic offenders were rewritten to
    // deterministic waits; retry absorbs the remaining tail. A genuine
    // regression fails BOTH attempts, so this cannot mask real breakage.
    retry: 1,
  });
}

export default createGatewayVitestConfig();
