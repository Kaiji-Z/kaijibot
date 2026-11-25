import {
  resolveDirectDmAuthorizationOutcome,
  resolveSenderCommandAuthorizationWithRuntime,
  type CommandAuthorizationRuntime,
} from "kaijibot/plugin-sdk/command-auth";
import type { KaijiBotConfig } from "kaijibot/plugin-sdk/core";
import { loadWeixinAccount } from "../auth/accounts.js";
import { readFrameworkAllowFromList } from "../auth/pairing.js";

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

export type WeixinDmAccess =
  | { outcome: "allowed"; commandAuthorized: boolean | undefined }
  | { outcome: "unauthorized" };

/**
 * Decide whether a direct-message sender may talk to the bot on an account.
 *
 * Weixin has no pairing flow of its own. Trusted senders come from the framework
 * pairing store (`*-allowFrom.json`), the account `userId` recorded at QR login as the
 * fallback, and `channels.wechat.allowFrom`. Extracted from processOneMessage so the
 * decision is testable on its own.
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
  const { senderAllowedForCommands, commandAuthorized } =
    await resolveSenderCommandAuthorizationWithRuntime({
      cfg: params.cfg,
      rawBody: params.rawBody,
      isGroup: false,
      dmPolicy: "pairing",
      configuredAllowFrom: params.configuredAllowFrom,
      configuredGroupAllowFrom: [],
      senderId: params.senderId,
      isSenderAllowed: (id: string, list: string[]) => list.length === 0 || list.includes(id),
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
  return { outcome: "unauthorized" };
}
