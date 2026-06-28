/**
 * KaijiBot WeChat (iLink Bot) channel plugin — entry point.
 *
 * Adapted from Tencent's `@tencent-weixin/openclaw-weixin` for the KaijiBot
 * plugin SDK. Uses `defineBundledChannelEntry` (same pattern as feishu's
 * `channel-entry.ts`) — no agent tools, no secrets contract, no runtime
 * injection beyond the channel plugin object itself.
 */
import { defineBundledChannelEntry } from "kaijibot/plugin-sdk/channel-entry-contract";

export default defineBundledChannelEntry({
  id: "wechat",
  name: "WeChat",
  description: "KaijiBot WeChat (iLink Bot) channel plugin",
  importMetaUrl: import.meta.url,
  plugin: {
    specifier: "./api.js",
    exportName: "wechatPlugin",
  },
});
