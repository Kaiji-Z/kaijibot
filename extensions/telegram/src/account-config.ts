import {
  normalizeAccountId,
  resolveAccountEntry,
  type KaijiBotConfig,
} from "kaijibot/plugin-sdk/account-core";
import type { TelegramAccountConfig } from "kaijibot/plugin-sdk/config-runtime";

export function resolveTelegramAccountConfig(
  cfg: KaijiBotConfig,
  accountId: string,
): TelegramAccountConfig | undefined {
  const normalized = normalizeAccountId(accountId);
  return resolveAccountEntry(cfg.channels?.telegram?.accounts, normalized);
}

export function mergeTelegramAccountConfig(
  cfg: KaijiBotConfig,
  accountId: string,
): TelegramAccountConfig {
  const {
    accounts: _ignored,
    defaultAccount: _ignoredDefaultAccount,
    groups: channelGroups,
    ...base
  } = (cfg.channels?.telegram ?? {}) as TelegramAccountConfig & {
    accounts?: unknown;
    defaultAccount?: unknown;
  };
  const account = resolveTelegramAccountConfig(cfg, accountId) ?? {};

  // Multi-account bots must not inherit channel-level groups unless explicitly set.
  const configuredAccountIds = Object.keys(cfg.channels?.telegram?.accounts ?? {});
  const isMultiAccount = configuredAccountIds.length > 1;
  const groups = account.groups ?? (isMultiAccount ? undefined : channelGroups);

  return { ...base, ...account, groups };
}
