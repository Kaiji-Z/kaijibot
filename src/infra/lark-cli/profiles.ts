import { execFile } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveLarkCliPath } from "./resolve.ts";

export interface AccountCredentials {
  /** Profile name — typically the appId or "default" for the top-level bot */
  name: string;
  appId: string;
  appSecret: string;
  /** "feishu" or "lark" */
  brand: string;
}

export interface ProfileRegistrationResult {
  registered: string[];
  failed: Array<{ name: string; error: string }>;
}

const PROFILE_ADD_TIMEOUT_MS = 10_000;

/** Path to lark-cli config.json */
function resolveConfigPath(): string {
  return join(homedir(), ".lark-cli", "config.json");
}

interface LarkCliApp {
  name?: string;
  appId: string;
  appSecret?: { source: string; id: string };
  brand: string;
  users?: Array<{ userOpenId: string; userName?: string }>;
}

interface LarkCliConfig {
  apps: LarkCliApp[];
}

/**
 * Snapshot existing profiles from config.json.
 * Returns a Map keyed by profile name (or appId if unnamed).
 */
function snapshotExistingProfiles(): Map<string, LarkCliApp> {
  const configPath = resolveConfigPath();
  if (!existsSync(configPath)) {
    return new Map();
  }
  try {
    const raw = readFileSync(configPath, "utf-8");
    const config: LarkCliConfig = JSON.parse(raw);
    const map = new Map<string, LarkCliApp>();
    for (const app of config.apps ?? []) {
      const key = app.name || app.appId;
      map.set(key, structuredClone(app));
    }
    return map;
  } catch {
    return new Map();
  }
}

/**
 * Restore profiles that were lost during `profile add`.
 * Compares snapshot (pre-registration) with current config and re-adds
 * any profiles that disappeared (user-configured apps not managed by KaijiBot).
 *
 * @param snapshot Pre-registration profile map
 * @param managedNames Profile names that KaijiBot manages (should be preserved)
 */
function restoreLostProfiles(
  snapshot: Map<string, LarkCliApp>,
  managedNames: Set<string>,
): { restored: string[] } {
  const configPath = resolveConfigPath();
  if (!existsSync(configPath)) {
    return { restored: [] };
  }

  let raw: string;
  try {
    raw = readFileSync(configPath, "utf-8");
  } catch {
    return { restored: [] };
  }

  let config: LarkCliConfig;
  try {
    config = JSON.parse(raw);
  } catch {
    return { restored: [] };
  }

  const currentKeys = new Set<string>();
  for (const app of config.apps ?? []) {
    currentKeys.add(app.name || app.appId);
  }

  const restored: string[] = [];
  for (const [key, app] of snapshot) {
    if (currentKeys.has(key)) {
      continue; // Still present, no action needed
    }
    // Profile from snapshot is missing — restore it
    // Skip KaijiBot-managed profiles (those are intentionally updated)
    if (managedNames.has(key)) {
      continue;
    }
    config.apps.push(app);
    restored.push(key);
  }

  if (restored.length > 0) {
    try {
      writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
    } catch {
      // Best-effort restore — don't fail gateway startup
    }
  }

  return { restored };
}

/**
 * Register a single lark-cli profile.
 * Runs `lark-cli profile add --name <name> --app-id <id> --app-secret-stdin --brand <brand>`.
 * The app secret is piped via stdin.
 */
function registerOneProfile(
  binPath: string,
  account: AccountCredentials,
): Promise<{ name: string; ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    const args = [
      binPath,
      "profile",
      "add",
      "--name",
      account.name,
      "--app-id",
      account.appId,
      "--app-secret-stdin",
      "--brand",
      account.brand,
    ];

    const child = execFile(
      "node",
      args,
      { timeout: PROFILE_ADD_TIMEOUT_MS },
      (error, _stdout, stderr) => {
        if (error) {
          const msg = stderr?.trim() || error.message;
          if (msg.toLowerCase().includes("already exists")) {
            resolve({ name: account.name, ok: true });
            return;
          }
          resolve({ name: account.name, ok: false, error: msg });
          return;
        }
        resolve({ name: account.name, ok: true });
      },
    );

    // Pipe app secret via stdin
    child.stdin?.write(account.appSecret);
    child.stdin?.end();
  });
}

/**
 * Register all feishu accounts as lark-cli profiles.
 *
 * For each account, runs `lark-cli profile add` with the credentials.
 * The top-level bot is registered as "default" (matching DEFAULT_ACCOUNT_ID).
 * Additional accounts are registered by their accountId (appId).
 *
 * Protects user-configured profiles: snapshots config.json before registration
 * and restores any profiles that `lark-cli profile add` may have dropped
 * (e.g., unnamed profiles from manual `lark-cli config bind`).
 *
 * Skips registration if lark-cli is not available.
 */
export async function registerLarkCliProfiles(
  accounts: AccountCredentials[],
): Promise<ProfileRegistrationResult> {
  const binPath = resolveLarkCliPath();
  if (!binPath) {
    return { registered: [], failed: [] };
  }

  if (accounts.length === 0) {
    return { registered: [], failed: [] };
  }

  // Snapshot existing profiles before any modifications
  const snapshot = snapshotExistingProfiles();
  const managedNames = new Set(accounts.map((a) => a.name));

  const registered: string[] = [];
  const failed: Array<{ name: string; error: string }> = [];

  // Register profiles sequentially to avoid stdin race conditions
  for (const account of accounts) {
    const result = await registerOneProfile(binPath, account);
    if (result.ok) {
      registered.push(result.name);
    } else {
      failed.push({ name: account.name, error: result.error ?? "unknown error" });
    }
  }

  // Restore any user-configured profiles that were lost during registration
  const { restored } = restoreLostProfiles(snapshot, managedNames);
  if (restored.length > 0) {
    // Attach restore info to the result for logging
    failed.push({
      name: "__restore__",
      error: `restored lost profiles: ${restored.join(", ")}`,
    });
  }

  return { registered, failed };
}

export function buildAccountCredentialsList(params: {
  defaultAppId?: string;
  defaultAppSecret?: string;
  defaultDomain?: string;
  accounts?: Record<string, { appId?: string; appSecret?: string; domain?: string }>;
}): AccountCredentials[] {
  const result: AccountCredentials[] = [];

  if (params.defaultAppId && params.defaultAppSecret) {
    result.push({
      name: "default",
      appId: params.defaultAppId,
      appSecret: params.defaultAppSecret,
      brand: inferBrand(params.defaultDomain),
    });
  }

  if (params.accounts) {
    for (const [accountId, cfg] of Object.entries(params.accounts)) {
      if (cfg.appId && cfg.appSecret) {
        result.push({
          name: accountId,
          appId: cfg.appId,
          appSecret: cfg.appSecret,
          brand: inferBrand(cfg.domain),
        });
      }
    }
  }

  return result;
}

function inferBrand(domain?: string): string {
  if (!domain) {
    return "feishu";
  }
  return domain.includes("larksuite") ? "lark" : "feishu";
}
