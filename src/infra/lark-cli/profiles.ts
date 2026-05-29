import { execFile } from "node:child_process";
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

  const registered: string[] = [];
  const failed: Array<{ name: string; error: string }> = [];

  // Register profiles sequentially to avoid stdin race conditions
  for (const account of accounts) {
    const result = await registerOneProfile(binPath, account);
    if (result.ok) {
      registered.push(result.name);
    } else {
      failed.push({ name: result.name, error: result.error ?? "unknown error" });
    }
  }

  return { registered, failed };
}

/**
 * Build account credentials list from gateway config.
 * The top-level feishu config becomes the "default" profile.
 * Each entry in `accounts` becomes its own profile keyed by accountId.
 */
export function buildAccountCredentialsList(params: {
  defaultAppId?: string;
  defaultAppSecret?: string;
  defaultDomain?: string;
  accounts?: Record<string, { appId?: string; appSecret?: string; domain?: string }>;
}): AccountCredentials[] {
  const result: AccountCredentials[] = [];

  // Default (top-level) bot
  if (params.defaultAppId && params.defaultAppSecret) {
    result.push({
      name: "default",
      appId: params.defaultAppId,
      appSecret: params.defaultAppSecret,
      brand: inferBrand(params.defaultDomain),
    });
  }

  // Additional accounts
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
