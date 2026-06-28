import type { KaijiBotConfig } from "kaijibot/plugin-sdk/core";

type WeixinChannelConfig = {
  replyProgressMessages?: boolean;
};

export function resolveReplyProgressMessagesEnabled(cfg: KaijiBotConfig): boolean {
  const section = cfg.channels?.["wechat"] as WeixinChannelConfig | undefined;
  return section?.replyProgressMessages !== false;
}
