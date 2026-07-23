import fs from "node:fs";
import { acquireLocalHeavyCheckLockSync } from "./lib/local-heavy-check-runtime.mjs";
import { spawnPnpmRunner } from "./pnpm-runner.mjs";
import { resolveVitestCliEntry, resolveVitestNodeArgs } from "./run-vitest.mjs";
import {
  buildFullSuiteVitestRunPlans,
  createVitestRunSpecs,
  parseTestProjectsArgs,
  resolveChangedTargetArgs,
  shouldUseLocalFullSuiteParallelByDefault,
  writeVitestIncludeFile,
} from "./test-projects.test-support.mjs";
import {
  installVitestProcessGroupCleanup,
  shouldUseDetachedVitestProcessGroup,
} from "./vitest-process-group.mjs";

// Keep this shim so `pnpm test -- src/foo.test.ts` still forwards filters
// cleanly instead of leaking pnpm's passthrough sentinel to Vitest.
const releaseLock = acquireLocalHeavyCheckLockSync({
  cwd: process.cwd(),
  env: process.env,
  toolName: "test",
});
let lockReleased = false;

const FULL_SUITE_CONFIG_WEIGHT = new Map([
  ["vitest/vitest.gateway.config.ts", 180],
  ["vitest/vitest.commands.config.ts", 175],
  ["vitest/vitest.agents.config.ts", 170],
  ["vitest/vitest.extensions.config.ts", 168],
  ["vitest/vitest.tasks.config.ts", 165],
  ["vitest/vitest.unit-fast.config.ts", 160],
  ["vitest/vitest.auto-reply-reply.config.ts", 155],
  ["vitest/vitest.infra.config.ts", 145],
  ["vitest/vitest.secrets.config.ts", 140],
  ["vitest/vitest.cron.config.ts", 135],
  ["vitest/vitest.wizard.config.ts", 130],
  ["vitest/vitest.unit-src.config.ts", 125],
  ["vitest/vitest.extension-channels.config.ts", 100],
  ["vitest/vitest.extension-providers.config.ts", 96],
  ["vitest/vitest.auto-reply-core.config.ts", 90],
  ["vitest/vitest.runtime-config.config.ts", 88],
  ["vitest/vitest.cli.config.ts", 86],
  ["vitest/vitest.channels.config.ts", 84],
  ["vitest/vitest.plugins.config.ts", 82],
  ["vitest/vitest.bundled.config.ts", 80],
  ["vitest/vitest.commands-light.config.ts", 48],
  ["vitest/vitest.plugin-sdk.config.ts", 46],
  ["vitest/vitest.auto-reply-top-level.config.ts", 45],
  ["vitest/vitest.unit-ui.config.ts", 40],
  ["vitest/vitest.plugin-sdk-light.config.ts", 38],
  ["vitest/vitest.daemon.config.ts", 36],
  ["vitest/vitest.boundary.config.ts", 34],
  ["vitest/vitest.tooling.config.ts", 32],
  ["vitest/vitest.unit-security.config.ts", 30],
  ["vitest/vitest.unit-support.config.ts", 28],
  ["vitest/vitest.contracts.config.ts", 26],
  ["vitest/vitest.extension-feishu.config.ts", 18],
  ["vitest/vitest.extension-messaging.config.ts", 14],
  ["vitest/vitest.extension-acpx.config.ts", 10],
  ["vitest/vitest.extension-diffs.config.ts", 8],
  ["vitest/vitest.extension-memory.config.ts", 6],
]);
const releaseLockOnce = () => {
  if (lockReleased) {
    return;
  }
  lockReleased = true;
  releaseLock();
};

function cleanupVitestRunSpec(spec) {
  if (!spec.includeFilePath) {
    return;
  }
  try {
    fs.rmSync(spec.includeFilePath, { force: true });
  } catch {
    // Best-effort cleanup for temp include lists.
  }
}

function runVitestSpec(spec) {
  if (spec.includeFilePath && spec.includePatterns) {
    writeVitestIncludeFile(spec.includeFilePath, spec.includePatterns);
  }
  return new Promise((resolve, reject) => {
    const child = spawnPnpmRunner({
      cwd: process.cwd(),
      detached: shouldUseDetachedVitestProcessGroup(),
      pnpmArgs: spec.pnpmArgs,
      env: spec.env,
    });
    const teardownChildCleanup = installVitestProcessGroupCleanup({ child });

    child.on("exit", (code, signal) => {
      teardownChildCleanup();
      cleanupVitestRunSpec(spec);
      resolve({ code: code ?? 1, signal });
    });

    child.on("error", (error) => {
      teardownChildCleanup();
      cleanupVitestRunSpec(spec);
      reject(error);
    });
  });
}

function parsePositiveInt(value) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function resolveParallelFullSuiteConcurrency(specCount, env) {
  const override = parsePositiveInt(env.KAIJIBOT_TEST_PROJECTS_PARALLEL);
  if (override !== null) {
    return Math.min(override, specCount);
  }
  if (env.KAIJIBOT_TEST_PROJECTS_SERIAL === "1") {
    return 1;
  }
  if (env.CI === "true" || env.GITHUB_ACTIONS === "true") {
    return 1;
  }
  if (
    env.KAIJIBOT_TEST_PROJECTS_LEAF_SHARDS !== "1" &&
    !shouldUseLocalFullSuiteParallelByDefault(env)
  ) {
    return 1;
  }
  return 1;
}

function orderFullSuiteSpecsForParallelRun(specs) {
  return specs.toSorted((a, b) => {
    const weightDelta =
      (FULL_SUITE_CONFIG_WEIGHT.get(b.config) ?? 0) - (FULL_SUITE_CONFIG_WEIGHT.get(a.config) ?? 0);
    if (weightDelta !== 0) {
      return weightDelta;
    }
    return a.config.localeCompare(b.config);
  });
}

async function runVitestSpecsParallel(specs, concurrency) {
  let nextIndex = 0;
  let exitCode = 0;

  const runWorker = async () => {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      const spec = specs[index];
      if (!spec) {
        return;
      }
      console.error(`[test] starting ${spec.config}`);
      const result = await runVitestSpec(spec);
      if (result.signal) {
        releaseLockOnce();
        process.kill(process.pid, result.signal);
        return;
      }
      if (result.code !== 0) {
        exitCode = exitCode || result.code;
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => runWorker()));
  return exitCode;
}

async function main() {
  const args = process.argv.slice(2);
  const { targetArgs } = parseTestProjectsArgs(args, process.cwd());
  const changedTargetArgs =
    targetArgs.length === 0 ? resolveChangedTargetArgs(args, process.cwd()) : null;
  const runSpecs =
    targetArgs.length === 0 && changedTargetArgs === null
      ? buildFullSuiteVitestRunPlans(args, process.cwd()).map((plan) => ({
          config: plan.config,
          continueOnFailure: true,
          env: process.env,
          includeFilePath: null,
          includePatterns: null,
          pnpmArgs: [
            "exec",
            "node",
            ...resolveVitestNodeArgs(process.env),
            resolveVitestCliEntry(),
            ...(plan.watchMode ? [] : ["run"]),
            "--config",
            plan.config,
            ...plan.forwardedArgs,
          ],
          watchMode: plan.watchMode,
        }))
      : createVitestRunSpecs(args, {
          baseEnv: process.env,
          cwd: process.cwd(),
        });

  const isFullSuiteRun =
    targetArgs.length === 0 &&
    changedTargetArgs === null &&
    !runSpecs.some((spec) => spec.watchMode);
  if (isFullSuiteRun) {
    const concurrency = resolveParallelFullSuiteConcurrency(runSpecs.length, process.env);
    if (concurrency > 1) {
      const parallelSpecs = orderFullSuiteSpecsForParallelRun(runSpecs);
      console.error(
        `[test] running ${parallelSpecs.length} Vitest shards with parallelism ${concurrency}`,
      );
      const parallelExitCode = await runVitestSpecsParallel(parallelSpecs, concurrency);
      releaseLockOnce();
      if (parallelExitCode !== 0) {
        process.exit(parallelExitCode);
      }
      return;
    }
  }

  let exitCode = 0;
  for (const spec of runSpecs) {
    const result = await runVitestSpec(spec);
    if (result.signal) {
      releaseLockOnce();
      process.kill(process.pid, result.signal);
      return;
    }
    if (result.code !== 0) {
      exitCode = exitCode || result.code;
      if (spec.continueOnFailure !== true) {
        releaseLockOnce();
        process.exit(result.code);
      }
    }
  }

  releaseLockOnce();
  if (exitCode !== 0) {
    process.exit(exitCode);
  }
}

main().catch((error) => {
  releaseLockOnce();
  console.error(error);
  process.exit(1);
});
