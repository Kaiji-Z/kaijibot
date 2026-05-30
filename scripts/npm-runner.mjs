import fs from "node:fs";
import path from "node:path";
import { buildCmdExeCommandLine, resolvePathEnvKey } from "./windows-cmd-helpers.mjs";

function resolveToolchainNpmRunner(params) {
  const npmCliCandidates = [
    params.pathImpl.resolve(params.nodeDir, "../lib/node_modules/npm/bin/npm-cli.js"),
    params.pathImpl.resolve(params.nodeDir, "node_modules/npm/bin/npm-cli.js"),
  ];
  const npmCliPath = npmCliCandidates.find((candidate) => params.existsSync(candidate));
  if (npmCliPath) {
    return {
      command:
        params.platform === "win32"
          ? params.pathImpl.join(params.nodeDir, "node.exe")
          : params.pathImpl.join(params.nodeDir, "node"),
      args: [npmCliPath, ...params.npmArgs],
      shell: false,
    };
  }
  if (params.platform !== "win32") {
    return null;
  }
  const npmExePath = params.pathImpl.resolve(params.nodeDir, "npm.exe");
  if (params.existsSync(npmExePath)) {
    return {
      command: npmExePath,
      args: params.npmArgs,
      shell: false,
    };
  }
  const npmCmdPath = params.pathImpl.resolve(params.nodeDir, "npm.cmd");
  if (params.existsSync(npmCmdPath)) {
    return {
      command: params.comSpec,
      args: ["/d", "/s", "/c", buildCmdExeCommandLine(npmCmdPath, params.npmArgs)],
      shell: false,
      windowsVerbatimArguments: true,
    };
  }
  return null;
}

function resolveToolchainNpxRunner(params) {
  const npxCliCandidates = [
    params.pathImpl.resolve(params.nodeDir, "../lib/node_modules/npm/bin/npx-cli.js"),
    params.pathImpl.resolve(params.nodeDir, "node_modules/npm/bin/npx-cli.js"),
  ];
  const npxCliPath = npxCliCandidates.find((candidate) => params.existsSync(candidate));
  if (npxCliPath) {
    return {
      command:
        params.platform === "win32"
          ? params.pathImpl.join(params.nodeDir, "node.exe")
          : params.pathImpl.join(params.nodeDir, "node"),
      args: [npxCliPath, ...params.npxArgs],
      shell: false,
    };
  }
  if (params.platform !== "win32") {
    return null;
  }
  const npxExePath = params.pathImpl.resolve(params.nodeDir, "npx.exe");
  if (params.existsSync(npxExePath)) {
    return { command: npxExePath, args: params.npxArgs, shell: false };
  }
  const npxCmdPath = params.pathImpl.resolve(params.nodeDir, "npx.cmd");
  if (params.existsSync(npxCmdPath)) {
    return {
      command: params.comSpec,
      args: ["/d", "/s", "/c", buildCmdExeCommandLine(npxCmdPath, params.npxArgs)],
      shell: false,
      windowsVerbatimArguments: true,
    };
  }
  return null;
}

export function resolveNpxRunner(params = {}) {
  const execPath = params.execPath ?? process.execPath;
  const npxArgs = params.npxArgs ?? [];
  const existsSync = params.existsSync ?? fs.existsSync;
  const env = params.env ?? process.env;
  const platform = params.platform ?? process.platform;
  const comSpec = params.comSpec ?? env.ComSpec ?? "cmd.exe";
  const pathImpl = platform === "win32" ? path.win32 : path.posix;
  const nodeDir = pathImpl.dirname(execPath);
  const npxToolchain = resolveToolchainNpxRunner({
    comSpec,
    existsSync,
    nodeDir,
    npxArgs,
    pathImpl,
    platform,
  });
  if (npxToolchain) {
    return npxToolchain;
  }
  if (platform === "win32") {
    throw new Error(
      `failed to resolve toolchain-local npx next to ${execPath}. ` +
        "Install a Node.js toolchain that bundles npm/npx.",
    );
  }
  const pathKey = resolvePathEnvKey(env);
  const currentPath = env[pathKey];
  return {
    command: "npx",
    args: npxArgs,
    shell: false,
    env: {
      ...env,
      [pathKey]:
        typeof currentPath === "string" && currentPath.length > 0
          ? `${nodeDir}${path.delimiter}${currentPath}`
          : nodeDir,
    },
  };
}

export function resolveNpmRunner(params = {}) {
  const execPath = params.execPath ?? process.execPath;
  const npmArgs = params.npmArgs ?? [];
  const existsSync = params.existsSync ?? fs.existsSync;
  const env = params.env ?? process.env;
  const platform = params.platform ?? process.platform;
  const comSpec = params.comSpec ?? env.ComSpec ?? "cmd.exe";
  const pathImpl = platform === "win32" ? path.win32 : path.posix;
  const nodeDir = pathImpl.dirname(execPath);
  const npmToolchain = resolveToolchainNpmRunner({
    comSpec,
    existsSync,
    nodeDir,
    npmArgs,
    pathImpl,
    platform,
  });
  if (npmToolchain) {
    return npmToolchain;
  }
  if (platform === "win32") {
    const expectedPaths = [
      pathImpl.resolve(nodeDir, "../lib/node_modules/npm/bin/npm-cli.js"),
      pathImpl.resolve(nodeDir, "node_modules/npm/bin/npm-cli.js"),
      pathImpl.resolve(nodeDir, "npm.exe"),
      pathImpl.resolve(nodeDir, "npm.cmd"),
    ];
    throw new Error(
      `failed to resolve a toolchain-local npm next to ${execPath}. ` +
        `Checked: ${expectedPaths.join(", ")}. ` +
        "KaijiBot refuses to shell out to bare npm on Windows; install a Node.js toolchain that bundles npm or run with a matching Node installation.",
    );
  }
  const pathKey = resolvePathEnvKey(env);
  const currentPath = env[pathKey];
  return {
    command: "npm",
    args: npmArgs,
    shell: false,
    env: {
      ...env,
      [pathKey]:
        typeof currentPath === "string" && currentPath.length > 0
          ? `${nodeDir}${path.delimiter}${currentPath}`
          : nodeDir,
    },
  };
}
