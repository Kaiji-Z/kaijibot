#!/usr/bin/env node
// Runs after install to restore bundled extension runtime deps.
// Installed builds can lazy-load bundled plugin code through root dist chunks,
// so runtime dependencies declared in dist/extensions/*/package.json must also
// resolve from the package root node_modules. Source checkouts resolve bundled
// plugin deps from the workspace root, so stale plugin-local node_modules must
// not linger under extensions/* and shadow the root graph.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveNpmRunner } from "./npm-runner.mjs";

export const BUNDLED_PLUGIN_INSTALL_TARGETS = [];

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_EXTENSIONS_DIR = join(__dirname, "..", "dist", "extensions");
const DEFAULT_PACKAGE_ROOT = join(__dirname, "..");
const DISABLE_POSTINSTALL_ENV = "KAIJIBOT_DISABLE_BUNDLED_PLUGIN_POSTINSTALL";

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function dependencySentinelPath(depName) {
  return join("node_modules", ...depName.split("/"), "package.json");
}

function collectRuntimeDeps(packageJson) {
  return {
    ...packageJson.dependencies,
    ...packageJson.optionalDependencies,
  };
}

export function discoverBundledPluginRuntimeDeps(params = {}) {
  const extensionsDir = params.extensionsDir ?? DEFAULT_EXTENSIONS_DIR;
  const pathExists = params.existsSync ?? existsSync;
  const readDir = params.readdirSync ?? readdirSync;
  const readJsonFile = params.readJson ?? readJson;
  const deps = new Map(
    BUNDLED_PLUGIN_INSTALL_TARGETS.map((target) => [
      target.name,
      {
        name: target.name,
        version: target.version,
        sentinelPath: dependencySentinelPath(target.name),
        pluginIds: [...(target.pluginIds ?? [])],
      },
    ]),
  );

  if (!pathExists(extensionsDir)) {
    return [...deps.values()].toSorted((a, b) => a.name.localeCompare(b.name));
  }

  for (const entry of readDir(extensionsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const pluginId = entry.name;
    const packageJsonPath = join(extensionsDir, pluginId, "package.json");
    if (!pathExists(packageJsonPath)) {
      continue;
    }
    try {
      const packageJson = readJsonFile(packageJsonPath);
      for (const [name, version] of Object.entries(collectRuntimeDeps(packageJson))) {
        const existing = deps.get(name);
        if (existing) {
          if (existing.version !== version) {
            continue;
          }
          if (!existing.pluginIds.includes(pluginId)) {
            existing.pluginIds.push(pluginId);
          }
          continue;
        }
        deps.set(name, {
          name,
          version,
          sentinelPath: dependencySentinelPath(name),
          pluginIds: [pluginId],
        });
      }
    } catch {
      // Ignore malformed plugin manifests; runtime will surface those separately.
    }
  }

  return [...deps.values()]
    .map((dep) => ({
      ...dep,
      pluginIds: [...dep.pluginIds].toSorted((a, b) => a.localeCompare(b)),
    }))
    .toSorted((a, b) => a.name.localeCompare(b.name));
}

export function createNestedNpmInstallEnv(env = process.env) {
  const nextEnv = { ...env };
  delete nextEnv.npm_config_global;
  delete nextEnv.npm_config_location;
  delete nextEnv.npm_config_prefix;
  return nextEnv;
}

export function isSourceCheckoutRoot(params) {
  const pathExists = params.existsSync ?? existsSync;
  return (
    pathExists(join(params.packageRoot, ".git")) &&
    pathExists(join(params.packageRoot, "src")) &&
    pathExists(join(params.packageRoot, "extensions"))
  );
}

export function pruneBundledPluginSourceNodeModules(params = {}) {
  const extensionsDir = params.extensionsDir ?? join(DEFAULT_PACKAGE_ROOT, "extensions");
  const pathExists = params.existsSync ?? existsSync;
  const readDir = params.readdirSync ?? readdirSync;
  const removePath = params.rmSync ?? rmSync;

  if (!pathExists(extensionsDir)) {
    return;
  }

  for (const entry of readDir(extensionsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      continue;
    }

    const pluginDir = join(extensionsDir, entry.name);
    if (!pathExists(join(pluginDir, "package.json"))) {
      continue;
    }

    removePath(join(pluginDir, "node_modules"), { recursive: true, force: true });
  }
}

function shouldRunBundledPluginPostinstall(params) {
  if (params.env?.[DISABLE_POSTINSTALL_ENV]?.trim()) {
    return false;
  }
  if (!params.existsSync(params.extensionsDir)) {
    return false;
  }
  return true;
}

export function runBundledPluginPostinstall(params = {}) {
  const env = params.env ?? process.env;
  const extensionsDir = params.extensionsDir ?? DEFAULT_EXTENSIONS_DIR;
  const packageRoot = params.packageRoot ?? DEFAULT_PACKAGE_ROOT;
  const spawn = params.spawnSync ?? spawnSync;
  const pathExists = params.existsSync ?? existsSync;
  const log = params.log ?? console;
  if (env?.[DISABLE_POSTINSTALL_ENV]?.trim()) {
    return;
  }
  if (isSourceCheckoutRoot({ packageRoot, existsSync: pathExists })) {
    try {
      pruneBundledPluginSourceNodeModules({
        extensionsDir: join(packageRoot, "extensions"),
        existsSync: pathExists,
        readdirSync: params.readdirSync,
        rmSync: params.rmSync,
      });
    } catch (e) {
      log.warn(`[postinstall] could not prune bundled plugin source node_modules: ${String(e)}`);
    }
    return;
  }
  if (
    !shouldRunBundledPluginPostinstall({
      env,
      extensionsDir,
      packageRoot,
      existsSync: pathExists,
    })
  ) {
    return;
  }
  const runtimeDeps =
    params.runtimeDeps ??
    discoverBundledPluginRuntimeDeps({ extensionsDir, existsSync: pathExists });
  const missingSpecs = runtimeDeps
    .filter((dep) => !pathExists(join(packageRoot, dep.sentinelPath)))
    .map((dep) => `${dep.name}@${dep.version}`);

  if (missingSpecs.length === 0) {
    return;
  }

  try {
    const nestedEnv = createNestedNpmInstallEnv(env);
    const npmRunner =
      params.npmRunner ??
      resolveNpmRunner({
        env: nestedEnv,
        execPath: params.execPath,
        existsSync: pathExists,
        platform: params.platform,
        comSpec: params.comSpec,
        npmArgs: ["install", "--omit=dev", "--no-save", "--package-lock=false", ...missingSpecs],
      });
    const result = spawn(npmRunner.command, npmRunner.args, {
      cwd: packageRoot,
      encoding: "utf8",
      env: npmRunner.env ?? nestedEnv,
      stdio: "pipe",
      shell: npmRunner.shell,
      windowsVerbatimArguments: npmRunner.windowsVerbatimArguments,
    });
    if (result.status !== 0) {
      const output = [result.stderr, result.stdout].filter(Boolean).join("\n").trim();
      throw new Error(output || "npm install failed");
    }
    log.log(`[postinstall] installed bundled plugin deps: ${missingSpecs.join(", ")}`);
  } catch (e) {
    // Non-fatal: gateway will surface the missing dep via doctor.
    log.warn(`[postinstall] could not install bundled plugin deps: ${String(e)}`);
  }
}

const DISABLE_LARK_SKILLS_ENV = "KAIJIBOT_DISABLE_LARK_SKILLS_INSTALL";
const SKILLS_INSTALL_TIMEOUT_MS = 120_000;
const SKILLS_CLI_ENTRY = ["node_modules", "skills", "bin", "cli.mjs"];

function areLarkSkillsInstalledInDir(skillsDir, pathExists, readDir) {
  if (!pathExists(skillsDir)) return false;
  try {
    return readDir(skillsDir, { withFileTypes: true }).some(
      (e) => e.isDirectory() && e.name.startsWith("lark-") && pathExists(join(skillsDir, e.name, "SKILL.md")),
    );
  } catch {
    return false;
  }
}

/**
 * Install lark-* SKILL.md files by running the `skills` CLI directly.
 *
 * Instead of using npx (which has a known bug on Windows + Node 24 where the
 * `_npx/` staging directory's lock mechanism can abort mid-reify, leaving
 * `package.json` missing — see npm/cli#8710), we install the `skills` npm
 * package to a temporary directory and execute its CLI with `node` directly.
 *
 * This completely bypasses the `_npx/` staging mechanism and is reliable
 * across all platforms.
 */
export function installLarkCliSkills(params = {}) {
  const env = params.env ?? process.env;
  const packageRoot = params.packageRoot ?? DEFAULT_PACKAGE_ROOT;
  const spawn = params.spawnSync ?? spawnSync;
  const pathExists = params.existsSync ?? existsSync;
  const readDir = params.readdirSync ?? readdirSync;
  const log = params.log ?? console;
  const skillsDir = params.skillsDir ?? join(homedir(), ".agents", "skills");
  const mktmp = params.mkdtempSync ?? mkdtempSync;
  const tmpDirFn = params.tmpdir ?? tmpdir;
  const removeDir = params.rmSync ?? rmSync;
  const execPath = params.execPath ?? process.execPath;

  if (env?.[DISABLE_LARK_SKILLS_ENV]?.trim()) return;
  if (isSourceCheckoutRoot({ packageRoot, existsSync: pathExists })) return;
  if (areLarkSkillsInstalledInDir(skillsDir, pathExists, readDir)) return;

  let tmpDir;
  try {
    // Create a temporary directory for npm install
    tmpDir = mktmp(join(tmpDirFn(), "kaijibot-skills-"));

    // Step 1: Install the `skills` npm package into the temp directory.
    // This uses `npm install` (not npx), which does not use the _npx/
    // staging mechanism and avoids npm/cli#8710.
    const nestedEnv = createNestedNpmInstallEnv(env);
    const npmRunner =
      params.npmRunner ??
      resolveNpmRunner({
        env: nestedEnv,
        execPath,
        existsSync: pathExists,
        platform: params.platform,
        comSpec: params.comSpec,
        npmArgs: ["install", "skills@latest", "--no-save", "--no-package-lock"],
      });

    const installResult = spawn(npmRunner.command, npmRunner.args, {
      cwd: tmpDir,
      encoding: "utf8",
      env: npmRunner.env ?? nestedEnv,
      stdio: "pipe",
      shell: npmRunner.shell,
      windowsVerbatimArguments: npmRunner.windowsVerbatimArguments,
      timeout: SKILLS_INSTALL_TIMEOUT_MS,
    });

    if (installResult.status !== 0) {
      const output = [installResult.stderr, installResult.stdout].filter(Boolean).join("\n").trim();
      throw new Error(`npm install skills failed: ${output || "unknown error"}`);
    }

    // Step 2: Run the skills CLI directly with node.
    // process.execPath ensures we use the same node binary that runs kaijibot.
    const cliPath = join(tmpDir, ...SKILLS_CLI_ENTRY);
    if (!pathExists(cliPath)) {
      throw new Error(`skills CLI not found at ${cliPath}`);
    }

    const skillsResult = spawn(execPath, [cliPath, "add", "larksuite/cli", "-g", "--all"], {
      cwd: packageRoot,
      encoding: "utf8",
      env,
      stdio: "pipe",
      timeout: SKILLS_INSTALL_TIMEOUT_MS,
    });

    if (skillsResult.status !== 0) {
      const output = [skillsResult.stderr, skillsResult.stdout].filter(Boolean).join("\n").trim();
      throw new Error(`skills add failed: ${output || "unknown error"}`);
    }

    log.log("[postinstall] installed lark-cli skills to ~/.agents/skills/");
  } catch (e) {
    log.warn(`[postinstall] could not install lark-cli skills: ${String(e)}`);
    log.warn("[postinstall] install manually: npx -y skills add larksuite/cli -g --all");
  } finally {
    if (tmpDir) {
      try {
        removeDir(tmpDir, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup; temp dir will be cleaned by OS eventually.
      }
    }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runBundledPluginPostinstall();
  installLarkCliSkills();
}
