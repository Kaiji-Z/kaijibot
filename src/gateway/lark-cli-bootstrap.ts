import type { KaijiBotConfig } from "../config/config.js";
import { setRuntimeConfigSnapshot } from "../config/config.js";
import {
  shouldDisableNativeTools,
  buildDisabledToolsConfig,
  buildDisabledSkillEntries,
} from "../infra/lark-cli/auto-disable.ts";
import {
  buildLarkCliEnv,
  isLarkCliAvailable,
  healthCheck,
  registerLarkCliProfiles,
  buildAccountCredentialsList,
  resolveLarkCliBinDir,
} from "../infra/lark-cli/index.js";
import { applyPathPrepend } from "../infra/path-prepend.js";

type BootstrapLog = Pick<Console, "info" | "warn">;

/**
 * Gateway-time lark-cli integration bootstrap.
 *
 * BOUNDARY CARVE-OUT (deliberate, documented in AGENTS.md): this module is
 * channel-specific (feishu) code living in core because it must mutate the
 * runtime config snapshot (setRuntimeConfigSnapshot) and process env BEFORE
 * channel plugins load — plugin-sdk exposes no seam for either. When the SDK
 * grows a startup seam with config-mutation rights, this should migrate into
 * the feishu extension's startup maintenance handler.
 *
 * When the lark-cli binary is available:
 * 1. Propagates feishu credentials/domain as lark-cli env vars and PATH.
 * 2. Registers every feishu account as a lark-cli profile (multi-bot).
 * 3. Auto-disables native feishu tools/skills in favor of CLI operations
 *    (only after a lark-cli health check passes).
 *
 * Mutates `cfg` in place (channels.feishu.tools, skills.entries) and publishes
 * the snapshot via setRuntimeConfigSnapshot when tools were disabled.
 */
export async function bootstrapLarkCliIntegration(
  cfg: KaijiBotConfig,
  log: BootstrapLog,
): Promise<void> {
  const feishuChannelCfg = cfg.channels?.feishu as Record<string, unknown> | undefined;
  if (!feishuChannelCfg || !isLarkCliAvailable()) {
    return;
  }
  const appId = feishuChannelCfg.appId as string | undefined;
  const appSecret = feishuChannelCfg.appSecret as string | undefined;
  const domain = feishuChannelCfg.domain as string | undefined;

  // Do not set LARKSUITE_CLI_APP_ID/SECRET — they override --profile credentials.
  const larkEnv = buildLarkCliEnv({ domain });
  for (const [key, value] of Object.entries(larkEnv)) {
    if (value) {
      process.env[key] = value;
    }
  }

  const larkBinDir = resolveLarkCliBinDir();
  if (larkBinDir) {
    applyPathPrepend(process.env as Record<string, string>, [larkBinDir]);
    log.info(`lark-cli: added ${larkBinDir} to PATH`);
  }

  // Register all feishu accounts as lark-cli profiles (multi-bot support).
  // The default (top-level) bot becomes profile "default", additional accounts
  // become profiles keyed by their accountId.
  const accounts = feishuChannelCfg.accounts as
    | Record<string, { appId?: string; appSecret?: string; domain?: string }>
    | undefined;
  const profileAccounts = buildAccountCredentialsList({
    defaultAppId: appId,
    defaultAppSecret: appSecret,
    defaultDomain: domain,
    accounts,
  });
  if (profileAccounts.length > 0) {
    const regResult = await registerLarkCliProfiles(profileAccounts);
    if (regResult.registered.length > 0) {
      log.info(`lark-cli: registered profiles: ${regResult.registered.join(", ")}`);
    }
    for (const fail of regResult.failed) {
      log.warn(`lark-cli: failed to register profile "${fail.name}": ${fail.error}`);
    }
  }

  // Auto-disable native feishu tools if user hasn't explicitly configured them.
  // Guard: verify the binary actually runs before disabling native tools.
  // Prevents "path resolves but binary crashes" edge case (platform mismatch, corruption).
  const userToolsCfg = feishuChannelCfg.tools as Record<string, unknown> | undefined;
  if (!shouldDisableNativeTools(userToolsCfg)) {
    return;
  }
  const hc = await healthCheck();
  if (!hc.ok) {
    log.warn(
      `lark-cli: binary found but health check failed (${hc.error}), keeping native feishu tools`,
    );
    return;
  }

  if (!feishuChannelCfg.tools) {
    feishuChannelCfg.tools = {};
  }
  const disabledTools = buildDisabledToolsConfig();
  const toolsMap = feishuChannelCfg.tools as Record<string, unknown>;
  for (const [key, value] of Object.entries(disabledTools)) {
    toolsMap[key] = value;
  }
  // Also inject disabled tools into each account's config so
  // resolveToolsConfig() doesn't re-enable them via DEFAULT_TOOLS_CONFIG.
  const accountsMap = feishuChannelCfg.accounts as
    | Record<string, Record<string, unknown>>
    | undefined;
  if (accountsMap) {
    for (const [, acctCfg] of Object.entries(accountsMap)) {
      if (!acctCfg.tools) {
        acctCfg.tools = {};
      }
      const acctTools = acctCfg.tools as Record<string, unknown>;
      for (const [key, value] of Object.entries(disabledTools)) {
        acctTools[key] = value;
      }
    }
    log.info(`lark-cli: injected disabled tools into ${Object.keys(accountsMap).length} accounts`);
  }
  log.info(`lark-cli: native feishu tools auto-disabled (lark-cli v${hc.version} healthy)`);

  // Auto-disable feishu skills
  const disabledSkills = buildDisabledSkillEntries();
  if (!cfg.skills) {
    cfg.skills = {};
  }
  if (!cfg.skills.entries) {
    cfg.skills.entries = {};
  }
  for (const [id, skillCfg] of Object.entries(disabledSkills)) {
    if (!cfg.skills.entries[id]) {
      cfg.skills.entries[id] = skillCfg;
    }
  }
  log.info("lark-cli: feishu skills auto-disabled (lark-cli available)");

  setRuntimeConfigSnapshot(cfg);
}
