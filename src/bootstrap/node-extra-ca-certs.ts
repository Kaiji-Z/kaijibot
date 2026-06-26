import fs from "node:fs";
import { isAndroidTermux, isLinuxLikePlatform } from "../shared/platform.js";

export const LINUX_CA_BUNDLE_PATHS = [
  "/etc/ssl/certs/ca-certificates.crt",
  "/etc/pki/tls/certs/ca-bundle.crt",
  "/etc/ssl/ca-bundle.pem",
] as const;

export const TERMUX_CA_BUNDLE_PATHS = [
  "/data/data/com.termux/files/usr/etc/tls/ca-bundle.crt",
  "/data/data/com.termux/files/usr/etc/ssl/certs/ca-certificates.crt",
] as const;

export type EnvMap = Record<string, string | undefined>;
type AccessSyncFn = (path: string, mode?: number) => void;

export function resolveLinuxSystemCaBundle(
  params: {
    platform?: NodeJS.Platform;
    accessSync?: AccessSyncFn;
  } = {},
): string | undefined {
  const platform = params.platform ?? process.platform;
  if (!isLinuxLikePlatform(platform)) {
    return undefined;
  }

  const accessSync = params.accessSync ?? fs.accessSync.bind(fs);
  const candidates = isAndroidTermux(platform)
    ? [...TERMUX_CA_BUNDLE_PATHS, ...LINUX_CA_BUNDLE_PATHS]
    : LINUX_CA_BUNDLE_PATHS;
  for (const candidate of candidates) {
    try {
      accessSync(candidate, fs.constants.R_OK);
      return candidate;
    } catch {
      continue;
    }
  }
  return undefined;
}

export function isNodeVersionManagerRuntime(
  env: EnvMap = process.env as EnvMap,
  execPath: string = process.execPath,
): boolean {
  if (env.NVM_DIR?.trim()) {
    return true;
  }
  return execPath.includes("/.nvm/");
}

export function resolveAutoNodeExtraCaCerts(
  params: {
    env?: EnvMap;
    platform?: NodeJS.Platform;
    execPath?: string;
    accessSync?: AccessSyncFn;
  } = {},
): string | undefined {
  const env = params.env ?? (process.env as EnvMap);
  if (env.NODE_EXTRA_CA_CERTS?.trim()) {
    return undefined;
  }

  const platform = params.platform ?? process.platform;
  const execPath = params.execPath ?? process.execPath;
  if (!isLinuxLikePlatform(platform) || !isNodeVersionManagerRuntime(env, execPath)) {
    return undefined;
  }

  return resolveLinuxSystemCaBundle({
    platform,
    accessSync: params.accessSync,
  });
}
