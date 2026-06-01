import { createScopedVitestConfig } from "./vitest.scoped-config.ts";

export function createToolingVitestConfig(env?: Record<string, string | undefined>) {
  return createScopedVitestConfig(
    [
      "src/scripts/**/*.test.ts",
      "src/config/doc-baseline.integration.test.ts",
      "src/config/schema.base.generated.test.ts",
      "src/config/schema.help.quality.test.ts",
      "test/**/*.test.ts",
    ],
    {
      dir: ".",
      env,
      name: "tooling",
      passWithNoTests: true,
    },
  );
}

export default createToolingVitestConfig();
