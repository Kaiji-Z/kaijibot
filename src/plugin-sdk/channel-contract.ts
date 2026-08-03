// Pure channel contract types used by plugin implementations and tests.
export type {
  BaseProbeResult,
  BaseTokenResolution,
  ChannelAgentTool,
  ChannelAccountSnapshot,
  ChannelApprovalAdapter,
  ChannelApprovalCapability,
  ChannelCommandConversationContext,
  ChannelDirectoryEntry,
  ChannelResolveKind,
  ChannelResolveResult,
  ChannelGroupContext,
  ChannelMessageActionAdapter,
  ChannelMessageActionContext,
  ChannelMessageActionDiscoveryContext,
  ChannelMessageActionName,
  ChannelMessageToolDiscovery,
  ChannelMessageToolSchemaContribution,
  ChannelStructuredComponents,
  ChannelStatusIssue,
  ChannelThreadingContext,
  ChannelThreadingToolContext,
  ChannelToolSend,
} from "../channels/plugins/types.js";
export type { ChannelLegacyStateMigrationPlan } from "../channels/plugins/types.core.js";

export type {
  ChannelDirectoryAdapter,
  ChannelDoctorAdapter,
  ChannelDoctorConfigMutation,
  ChannelDoctorEmptyAllowlistAccountContext,
  ChannelDoctorLegacyConfigRule,
  ChannelDoctorSequenceResult,
  ChannelGatewayContext,
  ChannelOutboundAdapter,
} from "../channels/plugins/types.adapters.js";

/**
 * Minimal channel-runtime surface threaded through gateway/setup flows.
 *
 * KaijiBot does not ship the upstream channel-runtime-context registry; this
 * type is a structural placeholder so channel plugins that declare an
 * optional `channelRuntime` dependency compile against the same shape.
 */
export type ChannelRuntimeSurface = {
  runtimeContexts?: {
    register?: (params: {
      channelId: string;
      accountId?: string | null;
      capability: string;
      context: unknown;
      abortSignal?: AbortSignal;
    }) => { dispose: () => void };
    get?: <T = unknown>(params: {
      channelId: string;
      accountId?: string | null;
      capability: string;
    }) => T | undefined;
    watch?: (params: {
      channelId?: string;
      accountId?: string | null;
      capability?: string;
      onEvent: (event: unknown) => void;
    }) => () => void;
  };
  [key: string]: unknown;
};
