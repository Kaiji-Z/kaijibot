import { createScopedVitestConfig } from "./vitest.scoped-config.ts";

export function createAutoReplyVitestConfig(env?: Record<string, string | undefined>) {
  return createScopedVitestConfig(["src/auto-reply/**/*.test.ts"], {
    dir: "src",
    env,
    name: "auto-reply",
    passWithNoTests: true,
  });
}

export default createAutoReplyVitestConfig();
