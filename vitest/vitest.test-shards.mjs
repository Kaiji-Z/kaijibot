// Full-suite shard routing for `pnpm test` (no args).
//
// Mirrors `rootVitestProjects` in vitest.config.ts — the project's authoritative
// full-suite definition. Each shard runs one vitest config as a separate process
// (isolation + parallelism), which is what scripts/test-projects.mjs expects.
//
// Keep this list in sync with `rootVitestProjects` in ../vitest.config.ts.

export const fullSuiteVitestShards = [
  "vitest/vitest.unit.config.ts",
  "vitest/vitest.boundary.config.ts",
  "vitest/vitest.bundled.config.ts",
  "vitest/vitest.runtime-config.config.ts",
  "vitest/vitest.plugin-sdk.config.ts",
  "vitest/vitest.plugins.config.ts",
  "vitest/vitest.shared-core.config.ts",
  "vitest/vitest.extensions.config.ts",
  "vitest/vitest.gateway.config.ts",
  "vitest/vitest.commands.config.ts",
  "vitest/vitest.infra.config.ts",
  "vitest/vitest.hooks.config.ts",
].map((config) => ({ config, projects: [config] }));
