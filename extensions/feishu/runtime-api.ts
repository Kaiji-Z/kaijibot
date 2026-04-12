// Private runtime barrel for the bundled Feishu extension.
// Keep this barrel thin and generic-only.

export type {
  AllowlistMatch,
  AnyAgentTool,
  BaseProbeResult,
  ChannelGroupContext,
  ChannelMessageActionName,
  ChannelMeta,
  ChannelOutboundAdapter,
  ChannelPlugin,
  HistoryEntry,
  KaijiBotConfig,
  KaijiBotPluginApi,
  OutboundIdentity,
  PluginRuntime,
  ReplyPayload,
} from "kaijibot/plugin-sdk/core";
export type { KaijiBotConfig as ClawdbotConfig } from "kaijibot/plugin-sdk/core";
export type { RuntimeEnv } from "kaijibot/plugin-sdk/runtime";
export type { GroupToolPolicyConfig } from "kaijibot/plugin-sdk/config-runtime";
export {
  DEFAULT_ACCOUNT_ID,
  buildChannelConfigSchema,
  createActionGate,
  createDedupeCache,
} from "kaijibot/plugin-sdk/core";
export {
  PAIRING_APPROVED_MESSAGE,
  buildProbeChannelStatusSummary,
  createDefaultChannelRuntimeState,
} from "kaijibot/plugin-sdk/channel-status";
export { buildAgentMediaPayload } from "kaijibot/plugin-sdk/agent-media-payload";
export { createChannelPairingController } from "kaijibot/plugin-sdk/channel-pairing";
export { createReplyPrefixContext } from "kaijibot/plugin-sdk/channel-reply-pipeline";
export {
  evaluateSupplementalContextVisibility,
  filterSupplementalContextItems,
  resolveChannelContextVisibilityMode,
} from "kaijibot/plugin-sdk/config-runtime";
export { loadSessionStore, resolveSessionStoreEntry } from "kaijibot/plugin-sdk/config-runtime";
export { readJsonFileWithFallback } from "kaijibot/plugin-sdk/json-store";
export { createPersistentDedupe } from "kaijibot/plugin-sdk/persistent-dedupe";
export { normalizeAgentId } from "kaijibot/plugin-sdk/routing";
export { chunkTextForOutbound } from "kaijibot/plugin-sdk/text-chunking";
export {
  isRequestBodyLimitError,
  readRequestBodyWithLimit,
  requestBodyErrorToText,
} from "kaijibot/plugin-sdk/webhook-ingress";
export { setFeishuRuntime } from "./src/runtime.js";
