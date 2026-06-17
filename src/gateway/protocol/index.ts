import { compileTypeBoxValidator, type TypeBoxValidationError } from "./typebox-validator.js";

export type { TypeBoxValidationError, TypeBoxValidator } from "./typebox-validator.js";
import type { SessionsPatchResult } from "../session-utils.types.js";
import {
  type AgentEvent,
  AgentEventSchema,
  type AgentIdentityParams,
  AgentIdentityParamsSchema,
  type AgentIdentityResult,
  AgentIdentityResultSchema,
  AgentParamsSchema,
  type AgentSummary,
  AgentSummarySchema,
  type AgentsFileEntry,
  AgentsFileEntrySchema,
  type AgentsCreateParams,
  AgentsCreateParamsSchema,
  type AgentsCreateResult,
  AgentsCreateResultSchema,
  type AgentsUpdateParams,
  AgentsUpdateParamsSchema,
  type AgentsUpdateResult,
  AgentsUpdateResultSchema,
  type AgentsDeleteParams,
  AgentsDeleteParamsSchema,
  type AgentsDeleteResult,
  AgentsDeleteResultSchema,
  type AgentsFilesGetParams,
  AgentsFilesGetParamsSchema,
  type AgentsFilesGetResult,
  AgentsFilesGetResultSchema,
  type AgentsFilesListParams,
  AgentsFilesListParamsSchema,
  type AgentsFilesListResult,
  AgentsFilesListResultSchema,
  type AgentsFilesSetParams,
  AgentsFilesSetParamsSchema,
  type AgentsFilesSetResult,
  AgentsFilesSetResultSchema,
  type AgentsListParams,
  AgentsListParamsSchema,
  type AgentsListResult,
  AgentsListResultSchema,
  type AgentWaitParams,
  AgentWaitParamsSchema,
  type AuthStoreApiKeyParams,
  AuthStoreApiKeyParamsSchema,
  type AuthStoreApiKeyResult,
  AuthStoreApiKeyResultSchema,
  type AuthListProviderStatusParams,
  AuthListProviderStatusParamsSchema,
  type AuthListProviderStatusResult,
  AuthListProviderStatusResultSchema,
  type AuthListProviderAuthOptionsParams,
  AuthListProviderAuthOptionsParamsSchema,
  type AuthListProviderAuthOptionsResult,
  AuthListProviderAuthOptionsResultSchema,
  type ChannelsLogoutParams,
  ChannelsLogoutParamsSchema,
  type TalkConfigParams,
  TalkConfigParamsSchema,
  type TalkConfigResult,
  TalkConfigResultSchema,
  type TalkSpeakParams,
  TalkSpeakParamsSchema,
  type TalkSpeakResult,
  TalkSpeakResultSchema,
  type ChannelsStatusParams,
  ChannelsStatusParamsSchema,
  type ChannelsStatusResult,
  ChannelsStatusResultSchema,
  type ChatAbortParams,
  ChatAbortParamsSchema,
  type ChatEvent,
  ChatEventSchema,
  ChatHistoryParamsSchema,
  type ChatInjectParams,
  ChatInjectParamsSchema,
  ChatSendParamsSchema,
  type ConfigApplyParams,
  ConfigApplyParamsSchema,
  type ConfigGetParams,
  ConfigGetParamsSchema,
  type ConfigPatchParams,
  ConfigPatchParamsSchema,
  type ConfigSchemaLookupParams,
  ConfigSchemaLookupParamsSchema,
  type ConfigSchemaLookupResult,
  ConfigSchemaLookupResultSchema,
  type ConfigSchemaParams,
  ConfigSchemaParamsSchema,
  type ConfigSchemaResponse,
  ConfigSchemaResponseSchema,
  type ConfigSetParams,
  ConfigSetParamsSchema,
  type ConnectParams,
  ConnectParamsSchema,
  type CronAddParams,
  CronAddParamsSchema,
  type CronJob,
  CronJobSchema,
  type CronListParams,
  CronListParamsSchema,
  type CronRemoveParams,
  CronRemoveParamsSchema,
  type CronRunLogEntry,
  type CronRunParams,
  CronRunParamsSchema,
  type CronRunsParams,
  CronRunsParamsSchema,
  type CronStatusParams,
  CronStatusParamsSchema,
  type CronUpdateParams,
  CronUpdateParamsSchema,
  type DevicePairApproveParams,
  DevicePairApproveParamsSchema,
  type DevicePairListParams,
  DevicePairListParamsSchema,
  type DevicePairRemoveParams,
  DevicePairRemoveParamsSchema,
  type DevicePairRejectParams,
  DevicePairRejectParamsSchema,
  type DeviceTokenRevokeParams,
  DeviceTokenRevokeParamsSchema,
  type DeviceTokenRotateParams,
  DeviceTokenRotateParamsSchema,
  type ExecApprovalsGetParams,
  ExecApprovalsGetParamsSchema,
  type ExecApprovalsNodeGetParams,
  ExecApprovalsNodeGetParamsSchema,
  type ExecApprovalsNodeSetParams,
  ExecApprovalsNodeSetParamsSchema,
  type ExecApprovalsSetParams,
  ExecApprovalsSetParamsSchema,
  type ExecApprovalsSnapshot,
  type ExecApprovalGetParams,
  ExecApprovalGetParamsSchema,
  type ExecApprovalRequestParams,
  ExecApprovalRequestParamsSchema,
  type ExecApprovalResolveParams,
  ExecApprovalResolveParamsSchema,
  type PluginApprovalRequestParams,
  PluginApprovalRequestParamsSchema,
  type PluginApprovalResolveParams,
  PluginApprovalResolveParamsSchema,
  ErrorCodes,
  type ErrorShape,
  ErrorShapeSchema,
  type EventFrame,
  EventFrameSchema,
  errorShape,
  type GatewayFrame,
  GatewayFrameSchema,
  type HelloOk,
  HelloOkSchema,
  type LogsTailParams,
  LogsTailParamsSchema,
  type LogsTailResult,
  LogsTailResultSchema,
  type ModelsListParams,
  ModelsListParamsSchema,
  type NodeDescribeParams,
  NodeDescribeParamsSchema,
  type NodeEventParams,
  NodeEventParamsSchema,
  type NodePendingDrainParams,
  NodePendingDrainParamsSchema,
  type NodePendingDrainResult,
  NodePendingDrainResultSchema,
  type NodePendingEnqueueParams,
  NodePendingEnqueueParamsSchema,
  type NodePendingEnqueueResult,
  NodePendingEnqueueResultSchema,
  type NodeInvokeParams,
  NodeInvokeParamsSchema,
  type NodeInvokeResultParams,
  NodeInvokeResultParamsSchema,
  type NodeListParams,
  NodeListParamsSchema,
  type NodePendingAckParams,
  NodePendingAckParamsSchema,
  type NodePairApproveParams,
  NodePairApproveParamsSchema,
  type NodePairListParams,
  NodePairListParamsSchema,
  type NodePairRejectParams,
  NodePairRejectParamsSchema,
  type NodePairRequestParams,
  NodePairRequestParamsSchema,
  type NodePairVerifyParams,
  NodePairVerifyParamsSchema,
  type NodeRenameParams,
  NodeRenameParamsSchema,
  type PollParams,
  PollParamsSchema,
  PROTOCOL_VERSION,
  type PushTestParams,
  PushTestParamsSchema,
  PushTestResultSchema,
  type PresenceEntry,
  PresenceEntrySchema,
  ProtocolSchemas,
  type RequestFrame,
  RequestFrameSchema,
  type ResponseFrame,
  ResponseFrameSchema,
  SendParamsSchema,
  type SecretsResolveParams,
  type SecretsResolveResult,
  SecretsResolveParamsSchema,
  SecretsResolveResultSchema,
  type SessionsAbortParams,
  SessionsAbortParamsSchema,
  type SessionsCompactParams,
  SessionsCompactParamsSchema,
  type SessionsCompactionBranchParams,
  SessionsCompactionBranchParamsSchema,
  type SessionsCompactionGetParams,
  SessionsCompactionGetParamsSchema,
  type SessionsCompactionListParams,
  SessionsCompactionListParamsSchema,
  type SessionsCompactionRestoreParams,
  SessionsCompactionRestoreParamsSchema,
  type SessionsCreateParams,
  SessionsCreateParamsSchema,
  type SessionsDeleteParams,
  SessionsDeleteParamsSchema,
  type SessionsListParams,
  SessionsListParamsSchema,
  type SessionsMessagesSubscribeParams,
  SessionsMessagesSubscribeParamsSchema,
  type SessionsMessagesUnsubscribeParams,
  SessionsMessagesUnsubscribeParamsSchema,
  type SessionsPatchParams,
  SessionsPatchParamsSchema,
  type SessionsPreviewParams,
  SessionsPreviewParamsSchema,
  type SessionsResetParams,
  SessionsResetParamsSchema,
  type SessionsResolveParams,
  SessionsResolveParamsSchema,
  type SessionsSendParams,
  SessionsSendParamsSchema,
  type SessionsUsageParams,
  SessionsUsageParamsSchema,
  type ShutdownEvent,
  ShutdownEventSchema,
  type SkillsBinsParams,
  SkillsBinsParamsSchema,
  type SkillsBinsResult,
  type SkillsDetailParams,
  SkillsDetailParamsSchema,
  type SkillsDetailResult,
  SkillsDetailResultSchema,
  type SkillsInstallParams,
  SkillsInstallParamsSchema,
  type SkillsSearchParams,
  SkillsSearchParamsSchema,
  type SkillsSearchResult,
  SkillsSearchResultSchema,
  type SkillsStatusParams,
  SkillsStatusParamsSchema,
  type SkillsUpdateParams,
  SkillsUpdateParamsSchema,
  type ToolsCatalogParams,
  ToolsCatalogParamsSchema,
  type ToolsCatalogResult,
  type ToolsEffectiveParams,
  ToolsEffectiveParamsSchema,
  type ToolsEffectiveResult,
  type Snapshot,
  SnapshotSchema,
  type StateVersion,
  StateVersionSchema,
  type TalkModeParams,
  TalkModeParamsSchema,
  type TickEvent,
  TickEventSchema,
  type UpdateRunParams,
  UpdateRunParamsSchema,
  type WakeParams,
  WakeParamsSchema,
  type WebLoginStartParams,
  WebLoginStartParamsSchema,
  type WebLoginWaitParams,
  WebLoginWaitParamsSchema,
  type WizardCancelParams,
  WizardCancelParamsSchema,
  type WizardNextParams,
  WizardNextParamsSchema,
  type WizardNextResult,
  WizardNextResultSchema,
  type WizardStartParams,
  WizardStartParamsSchema,
  type WizardStartResult,
  WizardStartResultSchema,
  type WizardStatusParams,
  WizardStatusParamsSchema,
  type WizardStatusResult,
  WizardStatusResultSchema,
  type WizardStep,
  WizardStepSchema,
} from "./schema.js";

export const validateConnectParams = compileTypeBoxValidator<ConnectParams>(ConnectParamsSchema);
export const validateRequestFrame = compileTypeBoxValidator<RequestFrame>(RequestFrameSchema);
export const validateResponseFrame = compileTypeBoxValidator<ResponseFrame>(ResponseFrameSchema);
export const validateEventFrame = compileTypeBoxValidator<EventFrame>(EventFrameSchema);
export const validateSendParams = compileTypeBoxValidator(SendParamsSchema);
export const validatePollParams = compileTypeBoxValidator<PollParams>(PollParamsSchema);
export const validateAgentParams = compileTypeBoxValidator(AgentParamsSchema);
export const validateAgentIdentityParams =
  compileTypeBoxValidator<AgentIdentityParams>(AgentIdentityParamsSchema);
export const validateAgentWaitParams =
  compileTypeBoxValidator<AgentWaitParams>(AgentWaitParamsSchema);
export const validateWakeParams = compileTypeBoxValidator<WakeParams>(WakeParamsSchema);
export const validateAgentsListParams =
  compileTypeBoxValidator<AgentsListParams>(AgentsListParamsSchema);
export const validateAgentsCreateParams =
  compileTypeBoxValidator<AgentsCreateParams>(AgentsCreateParamsSchema);
export const validateAgentsUpdateParams =
  compileTypeBoxValidator<AgentsUpdateParams>(AgentsUpdateParamsSchema);
export const validateAgentsDeleteParams =
  compileTypeBoxValidator<AgentsDeleteParams>(AgentsDeleteParamsSchema);
export const validateAgentsFilesListParams = compileTypeBoxValidator<AgentsFilesListParams>(
  AgentsFilesListParamsSchema,
);
export const validateAgentsFilesGetParams = compileTypeBoxValidator<AgentsFilesGetParams>(
  AgentsFilesGetParamsSchema,
);
export const validateAgentsFilesSetParams = compileTypeBoxValidator<AgentsFilesSetParams>(
  AgentsFilesSetParamsSchema,
);
export const validateNodePairRequestParams = compileTypeBoxValidator<NodePairRequestParams>(
  NodePairRequestParamsSchema,
);
export const validateNodePairListParams =
  compileTypeBoxValidator<NodePairListParams>(NodePairListParamsSchema);
export const validateNodePairApproveParams = compileTypeBoxValidator<NodePairApproveParams>(
  NodePairApproveParamsSchema,
);
export const validateNodePairRejectParams = compileTypeBoxValidator<NodePairRejectParams>(
  NodePairRejectParamsSchema,
);
export const validateNodePairVerifyParams = compileTypeBoxValidator<NodePairVerifyParams>(
  NodePairVerifyParamsSchema,
);
export const validateNodeRenameParams =
  compileTypeBoxValidator<NodeRenameParams>(NodeRenameParamsSchema);
export const validateNodeListParams = compileTypeBoxValidator<NodeListParams>(NodeListParamsSchema);
export const validateNodePendingAckParams = compileTypeBoxValidator<NodePendingAckParams>(
  NodePendingAckParamsSchema,
);
export const validateNodeDescribeParams =
  compileTypeBoxValidator<NodeDescribeParams>(NodeDescribeParamsSchema);
export const validateNodeInvokeParams =
  compileTypeBoxValidator<NodeInvokeParams>(NodeInvokeParamsSchema);
export const validateNodeInvokeResultParams = compileTypeBoxValidator<NodeInvokeResultParams>(
  NodeInvokeResultParamsSchema,
);
export const validateNodeEventParams =
  compileTypeBoxValidator<NodeEventParams>(NodeEventParamsSchema);
export const validateNodePendingDrainParams = compileTypeBoxValidator<NodePendingDrainParams>(
  NodePendingDrainParamsSchema,
);
export const validateNodePendingEnqueueParams = compileTypeBoxValidator<NodePendingEnqueueParams>(
  NodePendingEnqueueParamsSchema,
);
export const validatePushTestParams = compileTypeBoxValidator<PushTestParams>(PushTestParamsSchema);
export const validateSecretsResolveParams = compileTypeBoxValidator<SecretsResolveParams>(
  SecretsResolveParamsSchema,
);
export const validateSecretsResolveResult = compileTypeBoxValidator<SecretsResolveResult>(
  SecretsResolveResultSchema,
);
export const validateSessionsListParams =
  compileTypeBoxValidator<SessionsListParams>(SessionsListParamsSchema);
export const validateSessionsPreviewParams = compileTypeBoxValidator<SessionsPreviewParams>(
  SessionsPreviewParamsSchema,
);
export const validateSessionsResolveParams = compileTypeBoxValidator<SessionsResolveParams>(
  SessionsResolveParamsSchema,
);
export const validateSessionsCreateParams = compileTypeBoxValidator<SessionsCreateParams>(
  SessionsCreateParamsSchema,
);
export const validateSessionsSendParams =
  compileTypeBoxValidator<SessionsSendParams>(SessionsSendParamsSchema);
export const validateSessionsMessagesSubscribeParams =
  compileTypeBoxValidator<SessionsMessagesSubscribeParams>(SessionsMessagesSubscribeParamsSchema);
export const validateSessionsMessagesUnsubscribeParams =
  compileTypeBoxValidator<SessionsMessagesUnsubscribeParams>(
    SessionsMessagesUnsubscribeParamsSchema,
  );
export const validateSessionsAbortParams =
  compileTypeBoxValidator<SessionsAbortParams>(SessionsAbortParamsSchema);
export const validateSessionsPatchParams =
  compileTypeBoxValidator<SessionsPatchParams>(SessionsPatchParamsSchema);
export const validateSessionsResetParams =
  compileTypeBoxValidator<SessionsResetParams>(SessionsResetParamsSchema);
export const validateSessionsDeleteParams = compileTypeBoxValidator<SessionsDeleteParams>(
  SessionsDeleteParamsSchema,
);
export const validateSessionsCompactParams = compileTypeBoxValidator<SessionsCompactParams>(
  SessionsCompactParamsSchema,
);
export const validateSessionsCompactionListParams =
  compileTypeBoxValidator<SessionsCompactionListParams>(SessionsCompactionListParamsSchema);
export const validateSessionsCompactionGetParams =
  compileTypeBoxValidator<SessionsCompactionGetParams>(SessionsCompactionGetParamsSchema);
export const validateSessionsCompactionBranchParams =
  compileTypeBoxValidator<SessionsCompactionBranchParams>(SessionsCompactionBranchParamsSchema);
export const validateSessionsCompactionRestoreParams =
  compileTypeBoxValidator<SessionsCompactionRestoreParams>(SessionsCompactionRestoreParamsSchema);
export const validateSessionsUsageParams =
  compileTypeBoxValidator<SessionsUsageParams>(SessionsUsageParamsSchema);
export const validateConfigGetParams =
  compileTypeBoxValidator<ConfigGetParams>(ConfigGetParamsSchema);
export const validateConfigSetParams =
  compileTypeBoxValidator<ConfigSetParams>(ConfigSetParamsSchema);
export const validateConfigApplyParams =
  compileTypeBoxValidator<ConfigApplyParams>(ConfigApplyParamsSchema);
export const validateConfigPatchParams =
  compileTypeBoxValidator<ConfigPatchParams>(ConfigPatchParamsSchema);
export const validateConfigSchemaParams =
  compileTypeBoxValidator<ConfigSchemaParams>(ConfigSchemaParamsSchema);
export const validateConfigSchemaLookupParams = compileTypeBoxValidator<ConfigSchemaLookupParams>(
  ConfigSchemaLookupParamsSchema,
);
export const validateConfigSchemaLookupResult = compileTypeBoxValidator<ConfigSchemaLookupResult>(
  ConfigSchemaLookupResultSchema,
);
export const validateWizardStartParams =
  compileTypeBoxValidator<WizardStartParams>(WizardStartParamsSchema);
export const validateWizardNextParams =
  compileTypeBoxValidator<WizardNextParams>(WizardNextParamsSchema);
export const validateWizardCancelParams =
  compileTypeBoxValidator<WizardCancelParams>(WizardCancelParamsSchema);
export const validateWizardStatusParams =
  compileTypeBoxValidator<WizardStatusParams>(WizardStatusParamsSchema);
export const validateTalkModeParams = compileTypeBoxValidator<TalkModeParams>(TalkModeParamsSchema);
export const validateTalkConfigParams =
  compileTypeBoxValidator<TalkConfigParams>(TalkConfigParamsSchema);
export const validateTalkConfigResult =
  compileTypeBoxValidator<TalkConfigResult>(TalkConfigResultSchema);
export const validateTalkSpeakParams =
  compileTypeBoxValidator<TalkSpeakParams>(TalkSpeakParamsSchema);
export const validateTalkSpeakResult =
  compileTypeBoxValidator<TalkSpeakResult>(TalkSpeakResultSchema);
export const validateChannelsStatusParams = compileTypeBoxValidator<ChannelsStatusParams>(
  ChannelsStatusParamsSchema,
);
export const validateChannelsLogoutParams = compileTypeBoxValidator<ChannelsLogoutParams>(
  ChannelsLogoutParamsSchema,
);
export const validateModelsListParams =
  compileTypeBoxValidator<ModelsListParams>(ModelsListParamsSchema);
export const validateAuthStoreApiKeyParams = compileTypeBoxValidator<AuthStoreApiKeyParams>(
  AuthStoreApiKeyParamsSchema,
);
export const validateAuthStoreApiKeyResult = compileTypeBoxValidator<AuthStoreApiKeyResult>(
  AuthStoreApiKeyResultSchema,
);
export const validateAuthListProviderStatusParams =
  compileTypeBoxValidator<AuthListProviderStatusParams>(AuthListProviderStatusParamsSchema);
export const validateAuthListProviderStatusResult =
  compileTypeBoxValidator<AuthListProviderStatusResult>(AuthListProviderStatusResultSchema);
export const validateAuthListProviderAuthOptionsParams =
  compileTypeBoxValidator<AuthListProviderAuthOptionsParams>(
    AuthListProviderAuthOptionsParamsSchema,
  );
export const validateAuthListProviderAuthOptionsResult =
  compileTypeBoxValidator<AuthListProviderAuthOptionsResult>(
    AuthListProviderAuthOptionsResultSchema,
  );
export const validateSkillsStatusParams =
  compileTypeBoxValidator<SkillsStatusParams>(SkillsStatusParamsSchema);
export const validateToolsCatalogParams =
  compileTypeBoxValidator<ToolsCatalogParams>(ToolsCatalogParamsSchema);
export const validateToolsEffectiveParams = compileTypeBoxValidator<ToolsEffectiveParams>(
  ToolsEffectiveParamsSchema,
);
export const validateSkillsBinsParams =
  compileTypeBoxValidator<SkillsBinsParams>(SkillsBinsParamsSchema);
export const validateSkillsInstallParams =
  compileTypeBoxValidator<SkillsInstallParams>(SkillsInstallParamsSchema);
export const validateSkillsUpdateParams =
  compileTypeBoxValidator<SkillsUpdateParams>(SkillsUpdateParamsSchema);
export const validateSkillsSearchParams =
  compileTypeBoxValidator<SkillsSearchParams>(SkillsSearchParamsSchema);
export const validateSkillsDetailParams =
  compileTypeBoxValidator<SkillsDetailParams>(SkillsDetailParamsSchema);
export const validateCronListParams = compileTypeBoxValidator<CronListParams>(CronListParamsSchema);
export const validateCronStatusParams =
  compileTypeBoxValidator<CronStatusParams>(CronStatusParamsSchema);
export const validateCronAddParams = compileTypeBoxValidator<CronAddParams>(CronAddParamsSchema);
export const validateCronUpdateParams =
  compileTypeBoxValidator<CronUpdateParams>(CronUpdateParamsSchema);
export const validateCronRemoveParams =
  compileTypeBoxValidator<CronRemoveParams>(CronRemoveParamsSchema);
export const validateCronRunParams = compileTypeBoxValidator<CronRunParams>(CronRunParamsSchema);
export const validateCronRunsParams = compileTypeBoxValidator<CronRunsParams>(CronRunsParamsSchema);
export const validateDevicePairListParams = compileTypeBoxValidator<DevicePairListParams>(
  DevicePairListParamsSchema,
);
export const validateDevicePairApproveParams = compileTypeBoxValidator<DevicePairApproveParams>(
  DevicePairApproveParamsSchema,
);
export const validateDevicePairRejectParams = compileTypeBoxValidator<DevicePairRejectParams>(
  DevicePairRejectParamsSchema,
);
export const validateDevicePairRemoveParams = compileTypeBoxValidator<DevicePairRemoveParams>(
  DevicePairRemoveParamsSchema,
);
export const validateDeviceTokenRotateParams = compileTypeBoxValidator<DeviceTokenRotateParams>(
  DeviceTokenRotateParamsSchema,
);
export const validateDeviceTokenRevokeParams = compileTypeBoxValidator<DeviceTokenRevokeParams>(
  DeviceTokenRevokeParamsSchema,
);
export const validateExecApprovalsGetParams = compileTypeBoxValidator<ExecApprovalsGetParams>(
  ExecApprovalsGetParamsSchema,
);
export const validateExecApprovalsSetParams = compileTypeBoxValidator<ExecApprovalsSetParams>(
  ExecApprovalsSetParamsSchema,
);
export const validateExecApprovalGetParams = compileTypeBoxValidator<ExecApprovalGetParams>(
  ExecApprovalGetParamsSchema,
);
export const validateExecApprovalRequestParams = compileTypeBoxValidator<ExecApprovalRequestParams>(
  ExecApprovalRequestParamsSchema,
);
export const validateExecApprovalResolveParams = compileTypeBoxValidator<ExecApprovalResolveParams>(
  ExecApprovalResolveParamsSchema,
);
export const validatePluginApprovalRequestParams =
  compileTypeBoxValidator<PluginApprovalRequestParams>(PluginApprovalRequestParamsSchema);
export const validatePluginApprovalResolveParams =
  compileTypeBoxValidator<PluginApprovalResolveParams>(PluginApprovalResolveParamsSchema);
export const validateExecApprovalsNodeGetParams =
  compileTypeBoxValidator<ExecApprovalsNodeGetParams>(ExecApprovalsNodeGetParamsSchema);
export const validateExecApprovalsNodeSetParams =
  compileTypeBoxValidator<ExecApprovalsNodeSetParams>(ExecApprovalsNodeSetParamsSchema);
export const validateLogsTailParams = compileTypeBoxValidator<LogsTailParams>(LogsTailParamsSchema);
export const validateChatHistoryParams = compileTypeBoxValidator(ChatHistoryParamsSchema);
export const validateChatSendParams = compileTypeBoxValidator(ChatSendParamsSchema);
export const validateChatAbortParams =
  compileTypeBoxValidator<ChatAbortParams>(ChatAbortParamsSchema);
export const validateChatInjectParams =
  compileTypeBoxValidator<ChatInjectParams>(ChatInjectParamsSchema);
export const validateChatEvent = compileTypeBoxValidator(ChatEventSchema);
export const validateUpdateRunParams =
  compileTypeBoxValidator<UpdateRunParams>(UpdateRunParamsSchema);
export const validateWebLoginStartParams =
  compileTypeBoxValidator<WebLoginStartParams>(WebLoginStartParamsSchema);
export const validateWebLoginWaitParams =
  compileTypeBoxValidator<WebLoginWaitParams>(WebLoginWaitParamsSchema);

export function formatValidationErrors(errors: TypeBoxValidationError[] | null | undefined) {
  if (!errors?.length) {
    return "unknown validation error";
  }

  const parts: string[] = [];

  for (const err of errors) {
    const keyword = typeof err?.keyword === "string" ? err.keyword : "";
    const instancePath = typeof err?.instancePath === "string" ? err.instancePath : "";

    if (keyword === "additionalProperties") {
      // TypeBox reports additionalProperties as a string[] (vs AJV's singular
      // additionalProperty string). Expand each offending property.
      const params = err?.params as { additionalProperties?: unknown } | undefined;
      const additional = params?.additionalProperties;
      if (Array.isArray(additional) && additional.length > 0) {
        const where = instancePath ? `at ${instancePath}` : "at root";
        for (const prop of additional) {
          if (typeof prop === "string" && prop.trim()) {
            parts.push(`${where}: unexpected property '${prop}'`);
          }
        }
        continue;
      }
    }

    const message =
      typeof err?.message === "string" && err.message.trim() ? err.message : "validation error";
    const where = instancePath ? `at ${instancePath}: ` : "";
    parts.push(`${where}${message}`);
  }

  // De-dupe while preserving order.
  const unique = Array.from(new Set(parts.filter((part) => part.trim())));
  if (!unique.length) {
    return "unknown validation error";
  }
  return unique.join("; ");
}

export {
  ConnectParamsSchema,
  HelloOkSchema,
  RequestFrameSchema,
  ResponseFrameSchema,
  EventFrameSchema,
  GatewayFrameSchema,
  PresenceEntrySchema,
  SnapshotSchema,
  ErrorShapeSchema,
  StateVersionSchema,
  AgentEventSchema,
  ChatEventSchema,
  SendParamsSchema,
  PollParamsSchema,
  AgentParamsSchema,
  AgentIdentityParamsSchema,
  AgentIdentityResultSchema,
  WakeParamsSchema,
  PushTestParamsSchema,
  PushTestResultSchema,
  NodePairRequestParamsSchema,
  NodePairListParamsSchema,
  NodePairApproveParamsSchema,
  NodePairRejectParamsSchema,
  NodePairVerifyParamsSchema,
  NodeListParamsSchema,
  NodePendingAckParamsSchema,
  NodeInvokeParamsSchema,
  NodePendingDrainParamsSchema,
  NodePendingDrainResultSchema,
  NodePendingEnqueueParamsSchema,
  NodePendingEnqueueResultSchema,
  SessionsListParamsSchema,
  SessionsPreviewParamsSchema,
  SessionsResolveParamsSchema,
  SessionsCompactionListParamsSchema,
  SessionsCompactionGetParamsSchema,
  SessionsCompactionBranchParamsSchema,
  SessionsCompactionRestoreParamsSchema,
  SessionsCreateParamsSchema,
  SessionsSendParamsSchema,
  SessionsAbortParamsSchema,
  SessionsPatchParamsSchema,
  SessionsResetParamsSchema,
  SessionsDeleteParamsSchema,
  SessionsCompactParamsSchema,
  SessionsUsageParamsSchema,
  ConfigGetParamsSchema,
  ConfigSetParamsSchema,
  ConfigApplyParamsSchema,
  ConfigPatchParamsSchema,
  ConfigSchemaParamsSchema,
  ConfigSchemaLookupParamsSchema,
  ConfigSchemaResponseSchema,
  ConfigSchemaLookupResultSchema,
  WizardStartParamsSchema,
  WizardNextParamsSchema,
  WizardCancelParamsSchema,
  WizardStatusParamsSchema,
  WizardStepSchema,
  WizardNextResultSchema,
  WizardStartResultSchema,
  WizardStatusResultSchema,
  TalkConfigParamsSchema,
  TalkConfigResultSchema,
  TalkSpeakParamsSchema,
  TalkSpeakResultSchema,
  ChannelsStatusParamsSchema,
  ChannelsStatusResultSchema,
  ChannelsLogoutParamsSchema,
  WebLoginStartParamsSchema,
  WebLoginWaitParamsSchema,
  AgentSummarySchema,
  AgentsFileEntrySchema,
  AgentsCreateParamsSchema,
  AgentsCreateResultSchema,
  AgentsUpdateParamsSchema,
  AgentsUpdateResultSchema,
  AgentsDeleteParamsSchema,
  AgentsDeleteResultSchema,
  AgentsFilesListParamsSchema,
  AgentsFilesListResultSchema,
  AgentsFilesGetParamsSchema,
  AgentsFilesGetResultSchema,
  AgentsFilesSetParamsSchema,
  AgentsFilesSetResultSchema,
  AgentsListParamsSchema,
  AgentsListResultSchema,
  ModelsListParamsSchema,
  AuthStoreApiKeyParamsSchema,
  AuthStoreApiKeyResultSchema,
  AuthListProviderStatusParamsSchema,
  AuthListProviderStatusResultSchema,
  SkillsStatusParamsSchema,
  ToolsCatalogParamsSchema,
  ToolsEffectiveParamsSchema,
  SkillsInstallParamsSchema,
  SkillsSearchParamsSchema,
  SkillsSearchResultSchema,
  SkillsDetailParamsSchema,
  SkillsDetailResultSchema,
  SkillsUpdateParamsSchema,
  CronJobSchema,
  CronListParamsSchema,
  CronStatusParamsSchema,
  CronAddParamsSchema,
  CronUpdateParamsSchema,
  CronRemoveParamsSchema,
  CronRunParamsSchema,
  CronRunsParamsSchema,
  LogsTailParamsSchema,
  LogsTailResultSchema,
  ExecApprovalsGetParamsSchema,
  ExecApprovalsSetParamsSchema,
  ExecApprovalGetParamsSchema,
  ExecApprovalRequestParamsSchema,
  ExecApprovalResolveParamsSchema,
  ChatHistoryParamsSchema,
  ChatSendParamsSchema,
  ChatInjectParamsSchema,
  UpdateRunParamsSchema,
  TickEventSchema,
  ShutdownEventSchema,
  ProtocolSchemas,
  PROTOCOL_VERSION,
  ErrorCodes,
  errorShape,
};

export type {
  GatewayFrame,
  ConnectParams,
  HelloOk,
  RequestFrame,
  ResponseFrame,
  EventFrame,
  PresenceEntry,
  Snapshot,
  ErrorShape,
  StateVersion,
  AgentEvent,
  AgentIdentityParams,
  AgentIdentityResult,
  AgentWaitParams,
  ChatEvent,
  TickEvent,
  ShutdownEvent,
  WakeParams,
  NodePairRequestParams,
  NodePairListParams,
  NodePairApproveParams,
  DevicePairListParams,
  DevicePairApproveParams,
  DevicePairRejectParams,
  ConfigGetParams,
  ConfigSetParams,
  ConfigApplyParams,
  ConfigPatchParams,
  ConfigSchemaParams,
  ConfigSchemaResponse,
  WizardStartParams,
  WizardNextParams,
  WizardCancelParams,
  WizardStatusParams,
  WizardStep,
  WizardNextResult,
  WizardStartResult,
  WizardStatusResult,
  TalkConfigParams,
  TalkConfigResult,
  TalkSpeakParams,
  TalkSpeakResult,
  TalkModeParams,
  ChannelsStatusParams,
  ChannelsStatusResult,
  ChannelsLogoutParams,
  WebLoginStartParams,
  WebLoginWaitParams,
  AgentSummary,
  AgentsFileEntry,
  AgentsCreateParams,
  AgentsCreateResult,
  AgentsUpdateParams,
  AgentsUpdateResult,
  AgentsDeleteParams,
  AgentsDeleteResult,
  AgentsFilesListParams,
  AgentsFilesListResult,
  AgentsFilesGetParams,
  AgentsFilesGetResult,
  AgentsFilesSetParams,
  AgentsFilesSetResult,
  AgentsListParams,
  AgentsListResult,
  SkillsStatusParams,
  ToolsCatalogParams,
  ToolsCatalogResult,
  ToolsEffectiveParams,
  ToolsEffectiveResult,
  SkillsBinsParams,
  SkillsBinsResult,
  SkillsSearchParams,
  SkillsSearchResult,
  SkillsDetailParams,
  SkillsDetailResult,
  SkillsInstallParams,
  SkillsUpdateParams,
  NodePairRejectParams,
  NodePairVerifyParams,
  NodeListParams,
  NodeInvokeParams,
  NodeInvokeResultParams,
  NodeEventParams,
  NodePendingDrainParams,
  NodePendingDrainResult,
  NodePendingEnqueueParams,
  NodePendingEnqueueResult,
  SessionsListParams,
  SessionsPreviewParams,
  SessionsResolveParams,
  SessionsPatchParams,
  SessionsPatchResult,
  SessionsResetParams,
  SessionsDeleteParams,
  SessionsCompactParams,
  SessionsUsageParams,
  CronJob,
  CronListParams,
  CronStatusParams,
  CronAddParams,
  CronUpdateParams,
  CronRemoveParams,
  CronRunParams,
  CronRunsParams,
  CronRunLogEntry,
  ExecApprovalsGetParams,
  ExecApprovalsSetParams,
  ExecApprovalsSnapshot,
  ExecApprovalGetParams,
  ExecApprovalRequestParams,
  ExecApprovalResolveParams,
  LogsTailParams,
  LogsTailResult,
  PollParams,
  UpdateRunParams,
  ChatInjectParams,
};
