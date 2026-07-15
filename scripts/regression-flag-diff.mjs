#!/usr/bin/env node
/**
 * Flag-based regression comparison (VERIFICATION.md §4).
 *
 * Runs the SAME test suite twice — once with the cognitive layer ENABLED
 * (flag=on) and once with it DISABLED (flag=off) — then diffs the per-test
 * results to surface "what silently broke" when the feature is active.
 *
 * Mechanism: toggles `cognitive.enabled` via two temp configs pointed at by
 * `KAIJIBOT_CONFIG_PATH`, leaving the operator's real config untouched. Vitest
 * is invoked with `--reporter=json` so results are parsed deterministically
 * (no fragile stdout scraping).
 *
 * Classification (the §4 signal):
 *   REGRESSION      — PASS(off) + FAIL(on): the feature broke a test that
 *                     passed in baseline. This is the critical output.
 *   FEATURE-ONLY    — PASS(on) + FAIL(off): test only passes WITH the feature
 *                     (expected for cognitive-specific tests).
 *   STABLE          — same status both runs.
 *   ALWAYS-BROKEN   — FAIL both runs (pre-existing, independent of the flag).
 *
 * Usage:
 *   node scripts/regression-flag-diff.mjs [target]   # target defaults to src/cognitive
 *   node scripts/regression-flag-diff.mjs src/cognitive/insight
 *
 * Exit code: 1 if any REGRESSION found, else 0.
 */
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const require = createRequire(import.meta.url);

// ---------------------------------------------------------------------------
// Config resolution (mirrors src/config: KAIJIBOT_CONFIG_PATH > KAIJIBOT_HOME).
// ---------------------------------------------------------------------------
function resolveRealConfigPath(env = process.env) {
  if (env.KAIJIBOT_CONFIG_PATH?.trim()) {
    return env.KAIJIBOT_CONFIG_PATH.trim();
  }
  const home = env.KAIJIBOT_HOME?.trim() || env.HOME || "";
  return path.join(home, ".kaijibot", "kaijibot.json");
}

async function readJsonMaybe(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return {};
  }
}

/** Deep-merge a partial override into a config object (shallow-per-key is enough here). */
function withCognitiveToggle(config, enabled) {
  const clone = structuredClone(config);
  clone.cognitive = { ...(clone.cognitive ?? {}), enabled };
  return clone;
}

// ---------------------------------------------------------------------------
// Vitest invocation.
// ---------------------------------------------------------------------------
function resolveVitestCliEntry() {
  const vitestPackageJson = require.resolve("vitest/package.json");
  return path.join(path.dirname(vitestPackageJson), "vitest.mjs");
}

function resolveVitestNodeArgs(env = process.env) {
  const enableMaglev = ["1", "true", "yes", "on"].includes(
    env.KAIJIBOT_VITEST_ENABLE_MAGLEV?.trim().toLowerCase() ?? "",
  );
  return enableMaglev ? [] : ["--no-maglev"];
}

/**
 * Run vitest once with the given config-path env override, writing JSON
 * results to `outputFile`. Returns the parsed vitest JSON report.
 */
function runVitestWithConfig({ configPath, target, outputFile, env }) {
  return new Promise((resolve, reject) => {
    const vitestEntry = resolveVitestCliEntry();
    const args = [
      ...resolveVitestNodeArgs(env),
      vitestEntry,
      "run",
      "--config",
      "vitest/vitest.cognitive.config.ts",
      "--reporter=json",
      "--outputFile",
      outputFile,
      target,
    ];
    const child = spawn("pnpm", ["exec", "node", ...args], {
      env: { ...env, KAIJIBOT_CONFIG_PATH: configPath },
      stdio: ["inherit", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    // Swallow stdout (JSON reporter writes to file; noisy progress goes to stdout).
    child.stdout.on("data", () => {});
    child.on("error", reject);
    child.on("exit", () => resolve({ stderr }));
  });
}

// ---------------------------------------------------------------------------
// Result parsing + diffing.
// ---------------------------------------------------------------------------
/** Map of `file :: fullName` → status ("passed"|"failed"|"skipped"|"..."). */
function flattenResults(report) {
  const out = new Map();
  for (const file of report?.testResults ?? []) {
    for (const assertion of file.assertionResults ?? []) {
      out.set(`${file.name} :: ${assertion.fullName}`, assertion.status ?? "unknown");
    }
  }
  return out;
}

function classifyDiff(onResults, offResults) {
  const regression = [];
  const featureOnly = [];
  const alwaysBroken = [];
  let stablePassed = 0;
  let stableFailed = 0;

  const allKeys = new Set([...onResults.keys(), ...offResults.keys()]);
  for (const key of allKeys) {
    const on = onResults.get(key);
    const off = offResults.get(key);
    const onPass = on === "passed";
    const offPass = off === "passed";
    if (offPass && !onPass) {
      regression.push({ key, off, on });
    } else if (onPass && !offPass) {
      featureOnly.push({ key, off, on });
    } else if (!onPass && !offPass) {
      alwaysBroken.push({ key, off, on });
    } else if (onPass && offPass) {
      stablePassed += 1;
    } else {
      stableFailed += 1;
    }
  }
  return { regression, featureOnly, alwaysBroken, stablePassed, stableFailed };
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------
async function main() {
  const target = process.argv[2] ?? "src/cognitive";
  const realConfigPath = resolveRealConfigPath();
  const baseConfig = await readJsonMaybe(realConfigPath);

  if (baseConfig.cognitive?.enabled === false) {
    console.warn(
      `⚠️  Real config has cognitive.enabled=false; the "off" run will match baseline.`,
    );
  }

  const workDir = await mkdtemp(path.join(tmpdir(), "kaiji-flagdiff-"));
  const onConfigPath = path.join(workDir, "on.json");
  const offConfigPath = path.join(workDir, "off.json");
  const onOutput = path.join(workDir, "on-results.json");
  const offOutput = path.join(workDir, "off-results.json");

  await writeFile(onConfigPath, JSON.stringify(withCognitiveToggle(baseConfig, true), null, 2));
  await writeFile(offConfigPath, JSON.stringify(withCognitiveToggle(baseConfig, false), null, 2));

  console.log(`Flag-regression diff — target: ${target}`);
  console.log(`Real config: ${realConfigPath}`);
  console.log(`Temp configs: ${workDir}\n`);

  try {
    console.log("▶ Run 1/2: cognitive ENABLED (flag=on)…");
    await runVitestWithConfig({
      configPath: onConfigPath,
      target,
      outputFile: onOutput,
      env: process.env,
    });
    console.log("▶ Run 2/2: cognitive DISABLED (flag=off)…\n");
    await runVitestWithConfig({
      configPath: offConfigPath,
      target,
      outputFile: offOutput,
      env: process.env,
    });

    const onReport = JSON.parse(await readFile(onOutput, "utf8"));
    const offReport = JSON.parse(await readFile(offOutput, "utf8"));
    const diff = classifyDiff(flattenResults(onReport), flattenResults(offReport));

    const totalOn = onReport.numTotalTests ?? 0;
    const totalOff = offReport.numTotalTests ?? 0;
    console.log("━".repeat(60));
    console.log(`Tests run: ${totalOn} (on) / ${totalOff} (off)`);
    console.log(
      `Stable: ${diff.stablePassed} pass, ${diff.stableFailed} same-status-non-pass`,
    );
    console.log(`Feature-only (pass-on / fail-off): ${diff.featureOnly.length}  ← expected for cognitive suites`);
    console.log(`Always-broken (fail both): ${diff.alwaysBroken.length}`);
    console.log(`🔴 REGRESSIONS (pass-off / fail-on): ${diff.regression.length}`);

    if (diff.regression.length > 0) {
      console.log("\n## REGRESSIONS — tests the feature broke:");
      for (const r of diff.regression) {
        console.log(`  • ${r.key}  [${r.off} → ${r.on}]`);
      }
    }
    if (diff.featureOnly.length > 0 && process.env.FLAGDIFF_VERBOSE === "1") {
      console.log("\n## Feature-only (verbose):");
      for (const f of diff.featureOnly) {
        console.log(`  • ${f.key}  [${f.off} → ${f.on}]`);
      }
    }
    console.log("━".repeat(60));
    console.log(
      diff.regression.length === 0
        ? "✅ No regressions introduced by cognitive=on."
        : `❌ ${diff.regression.length} regression(s) — see above.`,
    );

    await rm(workDir, { recursive: true, force: true });
    process.exit(diff.regression.length === 0 ? 0 : 1);
  } catch (err) {
    console.error("Flag-regression diff failed:", err);
    await rm(workDir, { recursive: true, force: true });
    process.exit(2);
  }
}

main();
