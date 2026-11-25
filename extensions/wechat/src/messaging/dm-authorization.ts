import {
  resolveDirectDmAuthorizationOutcome,
  resolveSenderCommandAuthorizationWithRuntime,
  type CommandAuthorizationRuntime,
} from "kaijibot/plugin-sdk/command-auth";
import type { KaijiBotConfig } from "kaijibot/plugin-sdk/core";
import { loadWeixinAccount } from "../auth/accounts.js";
import { readFrameworkAllowFromList } from "../auth/pairing.js";
import { logger } from "../util/logger.js";

/**
 * Where the trusted sender ids of an account come from.
 * Injectable so the DM gate can be tested without mocking modules.
 */
export type WeixinDmAccessSources = {
  /** User ids authorized through the framework pairing store. */
  readStoreAllowFrom: (accountId: string) => string[];
  /** The user id recorded at QR login. */
  loadOwnerUserId: (accountId: string) => string | undefined;
};

export const defaultWeixinDmAccessSources: WeixinDmAccessSources = {
  readStoreAllowFrom: readFrameworkAllowFromList,
  loadOwnerUserId: (accountId) => {
    const owner = loadWeixinAccount(accountId)?.userId?.trim();
    return owner || undefined;
  },
};

/** Why a direct message was refused. */
export type WeixinDmRefusalReason =
  /** Nobody is on record for the account, so the gate cannot trust anyone. */
  | "no-trusted-sender"
  /** Trusted senders exist; this sender is not one of them. */
  | "sender-not-trusted";

export type WeixinDmAccess =
  | { outcome: "allowed"; commandAuthorized: boolean | undefined }
  | { outcome: "unauthorized"; reason: WeixinDmRefusalReason };

/**
 * Decide whether a direct-message sender may talk to the bot on an account.
 *
 * Weixin has no pairing flow of its own. Trusted senders come from the framework
 * pairing store (`*-allowFrom.json`), the account `userId` recorded at QR login as the
 * fallback, and `channels.wechat.allowFrom`. The gate fails closed: when nobody is on
 * record, nobody is admitted. Extracted from processOneMessage so the decision is testable
 * on its own.
 */
export async function resolveWeixinDmAccess(params: {
  cfg: KaijiBotConfig;
  rawBody: string;
  senderId: string;
  /** Extra senders from channels.wechat.allowFrom. */
  configuredAllowFrom: string[];
  accountId: string;
  runtime: CommandAuthorizationRuntime;
  sources?: WeixinDmAccessSources;
}): Promise<WeixinDmAccess> {
  const sources = params.sources ?? defaultWeixinDmAccessSources;
  const { senderAllowedForCommands, commandAuthorized, effectiveAllowFrom } =
    await resolveSenderCommandAuthorizationWithRuntime({
      cfg: params.cfg,
      rawBody: params.rawBody,
      isGroup: false,
      dmPolicy: "pairing",
      configuredAllowFrom: params.configuredAllowFrom,
      configuredGroupAllowFrom: [],
      senderId: params.senderId,
      // Fail closed: an empty allow list admits nobody.
      isSenderAllowed: (id: string, list: string[]) => list.includes(id),
      readAllowFromStore: async () => {
        const fromStore = sources.readStoreAllowFrom(params.accountId);
        if (fromStore.length > 0) {
          return fromStore;
        }
        const owner = sources.loadOwnerUserId(params.accountId);
        return owner ? [owner] : [];
      },
      runtime: params.runtime,
    });

  const outcome = resolveDirectDmAuthorizationOutcome({
    isGroup: false,
    dmPolicy: "pairing",
    senderAllowedForCommands,
  });
  if (outcome === "allowed") {
    return { outcome, commandAuthorized };
  }
  return {
    outcome: "unauthorized",
    reason: effectiveAllowFrom.length === 0 ? "no-trusted-sender" : "sender-not-trusted",
  };
}

/** How to regain access to an account that trusts nobody. */
export function formatWeixinNoTrustedSenderHint(accountId: string): string {
  return (
    `no trusted sender is on record for account=${accountId}, so direct messages are refused. ` +
    "Log in again with `kaijibot channels login --channel wechat` to record the owner, " +
    "or list the WeChat user ids that may talk to the bot under channels.wechat.allowFrom."
  );
}

/**
 * Report a refused direct message. Unauthorized senders get no reply, so the log is the only
 * place the refusal shows.
 */
export function createWeixinDmRefusalLog(log: Pick<typeof logger, "info" | "warn"> = logger) {
  const missingOwnerNoticed = new Set<string>();
  return (accountId: string, senderId: string, reason: WeixinDmRefusalReason): void => {
    if (reason === "sender-not-trusted") {
      log.info(`authorization: dropping message from=${senderId} outcome=unauthorized`);
      return;
    }
    // Once per account: an unknown sender must not be able to flood the log.
    if (missingOwnerNoticed.has(accountId)) {
      return;
    }
    missingOwnerNoticed.add(accountId);
    log.warn(`authorization: dropping messages: ${formatWeixinNoTrustedSenderHint(accountId)}`);
  };
}
