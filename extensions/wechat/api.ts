/**
 * KaijiBot WeChat channel plugin — public barrel.
 *
 * Re-exports the channel plugin object produced by `src/channel.ts`.
 * Entry point (`index.ts`) references this via `defineBundledChannelEntry`.
 */
export { weixinPlugin as wechatPlugin } from "./src/channel.js";
