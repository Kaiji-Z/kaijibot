import { createScopedVitestConfig } from "./vitest.scoped-config.ts";

export function createCronVitestConfig(env?: Record<string, string | undefined>) {
  const config = createScopedVitestConfig(["src/cron/**/*.test.ts"], {
    dir: "src",
    env,
    name: "cron",
    passWithNoTests: true,
  });
  // Cron tests share timer registries and state dirs. Keep files serialized so
  // they do not fight each other under the non-isolated runner.
  config.test = {
    ...config.test,
    maxWorkers: 1,
    fileParallelism: false,
  };
  return config;
}

export default createCronVitestConfig();
