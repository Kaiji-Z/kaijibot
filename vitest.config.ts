import { defineConfig } from "vitest/config";
import {
  resolveDefaultVitestPool,
  resolveLocalVitestMaxWorkers,
  resolveLocalVitestScheduling,
  sharedVitestConfig,
} from "./vitest.shared.config.ts";

export { resolveDefaultVitestPool, resolveLocalVitestMaxWorkers, resolveLocalVitestScheduling };

export const rootVitestProjects = [
  "vitest.unit.config.ts",
  "vitest.boundary.config.ts",
  "vitest.bundled.config.ts",
  "vitest.runtime-config.config.ts",
  "vitest.plugin-sdk.config.ts",
  "vitest.plugins.config.ts",
  "vitest.shared-core.config.ts",
  "vitest.extensions.config.ts",
  "vitest.gateway.config.ts",
  "vitest.infra.config.ts",
] as const;

export default defineConfig({
  ...sharedVitestConfig,
  test: {
    ...sharedVitestConfig.test,
    runner: "./test/non-isolated-runner.ts",
    projects: [...rootVitestProjects],
  },
});
