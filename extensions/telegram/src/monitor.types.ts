import type { ChannelAccountSnapshot } from "kaijibot/plugin-sdk/channel-contract";
import type { KaijiBotConfig } from "kaijibot/plugin-sdk/config-runtime";
import type { PluginRuntimeChannel } from "kaijibot/plugin-sdk/plugin-runtime";
import type { RuntimeEnv } from "kaijibot/plugin-sdk/runtime-env";

export type MonitorTelegramOpts = {
  token?: string;
  accountId?: string;
  config?: KaijiBotConfig;
  runtime?: RuntimeEnv;
  channelRuntime?: PluginRuntimeChannel;
  abortSignal?: AbortSignal;
  useWebhook?: boolean;
  webhookPath?: string;
  webhookPort?: number;
  webhookSecret?: string;
  webhookHost?: string;
  proxyFetch?: typeof fetch;
  webhookUrl?: string;
  webhookCertPath?: string;
  setStatus?: (patch: Omit<ChannelAccountSnapshot, "accountId">) => void;
};

export type TelegramMonitorFn = (opts?: MonitorTelegramOpts) => Promise<void>;
