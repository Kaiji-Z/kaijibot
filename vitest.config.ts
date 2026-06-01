import { defineConfig } from "vitest/config";
import {
  resolveDefaultVitestPool,
  resolveLocalVitestMaxWorkers,
  resolveLocalVitestScheduling,
  sharedVitestConfig,
} from "./vitest/vitest.shared.config.ts";

export { resolveDefaultVitestPool, resolveLocalVitestMaxWorkers, resolveLocalVitestScheduling };

export const rootVitestProjects = [
  "vitest/vitest.unit.config.ts",
  "vitest/vitest.boundary.config.ts",
  "vitest/vitest.bundled.config.ts",
  "vitest/vitest.runtime-config.config.ts",
  "vitest/vitest.plugin-sdk.config.ts",
  "vitest/vitest.plugins.config.ts",
  "vitest/vitest.shared-core.config.ts",
  "vitest/vitest.extensions.config.ts",
  "vitest/vitest.gateway.config.ts",
  "vitest/vitest.infra.config.ts",
  "vitest/vitest.hooks.config.ts",
] as const;

export default defineConfig({
  ...sharedVitestConfig,
  test: {
    ...sharedVitestConfig.test,
    runner: "./test/non-isolated-runner.ts",
    projects: [...rootVitestProjects],
  },
});
