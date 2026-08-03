import type { KaijiBotConfig } from "kaijibot/plugin-sdk/config-runtime";
import {
  resolveReactionLevel,
  type ReactionLevel,
  type ResolvedReactionLevel as BaseResolvedReactionLevel,
} from "kaijibot/plugin-sdk/text-runtime";
import { resolveTelegramAccount } from "./accounts.js";

export type TelegramReactionLevel = ReactionLevel;
export type ResolvedReactionLevel = BaseResolvedReactionLevel;

/**
 * Resolve the effective reaction level and its implications.
 */
export function resolveTelegramReactionLevel(params: {
  cfg: KaijiBotConfig;
  accountId?: string;
}): ResolvedReactionLevel {
  const account = resolveTelegramAccount({
    cfg: params.cfg,
    accountId: params.accountId,
  });
  return resolveReactionLevel({
    value: account.config.reactionLevel,
    defaultLevel: "minimal",
    invalidFallback: "ack",
  });
}
