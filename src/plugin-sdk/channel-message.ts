/**
 * Channel message adapter surface for plugin-owned messaging.
 *
 * NOTE: KaijiBot has not yet ported the channels/message and channels/turn
 * subsystems from upstream. The types are declared here for compilation
 * compatibility; runtime calls to unported functions will throw.
 */

import type {
  ChannelReplyPipeline,
} from "./channel-reply-pipeline.js";
import {
  createChannelReplyPipeline,
  createReplyPrefixContext,
  createReplyPrefixOptions,
  createTypingCallbacks,
} from "./channel-reply-pipeline.js";

// -- Re-export reply pipeline as channel-message aliases --

export {
  createChannelReplyPipeline as createChannelMessageReplyPipeline,
  createReplyPrefixContext,
  createReplyPrefixOptions,
  createTypingCallbacks,
} from "./channel-reply-pipeline.js";

export type {
  ChannelReplyPipeline as CreateChannelReplyPipelineParams,
} from "./channel-reply-pipeline.js";

// -- Types for message adapter surface --
// These types mirror the upstream interface so that extensions can compile
// against them even though the runtime is not yet ported.

export type MessageAckStage = "receive" | "send" | "final";
export type MessageAckPolicy = "auto" | "manual";
export type LiveMessagePhase = "preview" | "final" | "cancelled";

export type ChannelMessageSendAttemptKind = "text" | "media" | "poll" | "unknown";

export type ChannelMessageSendResult = {
  ok: boolean;
  platformId?: string;
  error?: { code: string; message: string };
};

export type MessageReceiptPartKind = "text" | "image" | "file" | "audio" | "video";
export type MessageReceiptPart = {
  kind: MessageReceiptPartKind;
  platformId?: string;
};
export type MessageReceiptSourceResult = {
  platformId: string;
  parts: MessageReceiptPart[];
};

export type RenderedMessageBatchPlanKind = "single" | "chunked";
export type RenderedMessageBatchPlanItem = {
  index: number;
  text: string;
};
export type RenderedMessageBatchPlan = {
  kind: RenderedMessageBatchPlanKind;
  items: RenderedMessageBatchPlanItem[];
};
export type RenderedMessageBatch = {
  plan: RenderedMessageBatchPlan;
};

export type MessageAckState = {
  stage: MessageAckStage;
  policy: MessageAckPolicy;
};

export type LiveMessageState = {
  phase: LiveMessagePhase;
  platformId?: string;
  receipt?: MessageReceiptSourceResult;
};

export type DurableMessageStateRecord = {
  id: string;
  status: "pending" | "sent" | "failed";
  platformId?: string;
  createdAt: number;
  updatedAt: number;
};

export type MessageReceipt = {
  primaryId: string;
  source?: MessageReceiptSourceResult;
};

export type MessageSendContext = {
  sessionId: string;
  agentId: string;
  routeSessionKey: string;
};

export type MessageDurabilityPolicy = "none" | "at-least-once";

export type ChannelMessageAdapterShape = {
  send?: unknown;
  receive?: unknown;
  live?: unknown;
  durableFinal?: unknown;
  outboundBridge?: unknown;
};

export type ChannelMessageAdapter<T extends ChannelMessageAdapterShape = ChannelMessageAdapterShape> = T & {
  receive?: unknown;
};

export type ChannelMessageSendAdapter = unknown;
export type ChannelMessageSendAttemptContext = unknown;
export type ChannelMessageSendCommitContext = unknown;
export type ChannelMessageSendFailureContext = unknown;
export type ChannelMessageSendLifecycleAdapter = unknown;
export type ChannelMessageSendMediaContext = unknown;
export type ChannelMessageSendPayloadContext = unknown;
export type ChannelMessageSendPollContext = unknown;
export type ChannelMessageSendSuccessContext = unknown;
export type ChannelMessageSendTextContext = unknown;
export type ChannelMessageUnknownSendContext = unknown;
export type ChannelMessageUnknownSendReconciliationResult = unknown;

export type ChannelMessageDurableFinalAdapter = unknown;
export type ChannelMessageLiveFinalizerAdapterShape = unknown;
export type ChannelMessageLiveAdapterShape = unknown;
export type ChannelMessageLiveCapability = unknown;
export type ChannelMessageOutboundBridgeAdapter = unknown;
export type ChannelMessageOutboundBridgeResult = unknown;
export type ChannelMessageReceiveAckPolicy = unknown;

export type DurableFinalDeliveryCapability = unknown;
export type DurableFinalDeliveryPayloadShape = unknown;
export type DurableFinalDeliveryRequirementMap = unknown;
export type DurableFinalRequirementExtras = unknown;
export type DurableMessageSendIntent = unknown;
export type DurableMessageSendState = unknown;

export type FinalizableLivePreviewAdapter = unknown;
export type LivePreviewFinalizerCapability = unknown;
export type LivePreviewFinalizerCapabilityMap = unknown;
export type LivePreviewFinalizerDraft = unknown;
export type LivePreviewFinalizerCapabilityProof = unknown;
export type LivePreviewFinalizerCapabilityProofMap = unknown;
export type LivePreviewFinalizerCapabilityProofResult = unknown;
export type LivePreviewFinalizerResult = { kind: string };
export type LivePreviewFinalizerResultKind = string;

export type ChannelMessageLiveCapabilityProof = unknown;
export type ChannelMessageLiveCapabilityProofMap = unknown;
export type ChannelMessageLiveCapabilityProofResult = unknown;
export type ChannelMessageReceiveAckPolicyProof = unknown;
export type ChannelMessageReceiveAckPolicyProofMap = unknown;
export type ChannelMessageReceiveAckPolicyProofResult = unknown;
export type DurableFinalCapabilityProof = unknown;
export type DurableFinalCapabilityProofMap = unknown;
export type DurableFinalCapabilityProofResult = unknown;

export type CreateChannelMessageAdapterFromOutboundParams = unknown;
export type DeriveDurableFinalDeliveryRequirementsParams = unknown;

export type MessageReceiveContext = unknown;

export type DurableInboundReplyDeliveryOptions = unknown;
export type DurableInboundReplyDeliveryParams = unknown;
export type DurableInboundReplyDeliveryResult = unknown;

export type DurableMessageBatchSendParams = unknown;
export type DurableMessageBatchSendResult = unknown;
export type DurableMessageSendContext = unknown;
export type DurableMessageSendContextParams = unknown;

// -- Runtime stubs --

function throwNotPorted(name: string): never {
  throw new Error(
    `Channel message subsystem not yet ported to KaijiBot: ${name}. ` +
      `The channels/message module from upstream has not been ported.`,
  );
}

export function createChannelMessageAdapterFromOutbound(_params: unknown): ChannelMessageAdapter {
  throwNotPorted("createChannelMessageAdapterFromOutbound");
}

export function createMessageReceiptFromOutboundResults(_results: unknown): MessageReceipt {
  throwNotPorted("createMessageReceiptFromOutboundResults");
}

export function listMessageReceiptPlatformIds(_receipt: MessageReceipt): string[] {
  throwNotPorted("listMessageReceiptPlatformIds");
}

export function createMessageReceiveContext(_params: unknown): MessageReceiveContext {
  throwNotPorted("createMessageReceiveContext");
}

export function createPreviewMessageReceipt(_params: unknown): MessageReceipt {
  throwNotPorted("createPreviewMessageReceipt");
}

export function defineFinalizableLivePreviewAdapter(_params: unknown): FinalizableLivePreviewAdapter {
  throwNotPorted("defineFinalizableLivePreviewAdapter");
}

export function deriveDurableFinalDeliveryRequirements(_params: unknown): unknown {
  throwNotPorted("deriveDurableFinalDeliveryRequirements");
}

export function deliverFinalizableLivePreview(_params: unknown): Promise<LivePreviewFinalizerResult> {
  throwNotPorted("deliverFinalizableLivePreview");
}

export function deliverWithFinalizableLivePreviewAdapter(_params: unknown): Promise<LivePreviewFinalizerResult> {
  throwNotPorted("deliverWithFinalizableLivePreviewAdapter");
}

export function listDeclaredChannelMessageLiveCapabilities(): never {
  throwNotPorted("listDeclaredChannelMessageLiveCapabilities");
}

export function listDeclaredDurableFinalCapabilities(): never {
  throwNotPorted("listDeclaredDurableFinalCapabilities");
}

export function listDeclaredLivePreviewFinalizerCapabilities(): never {
  throwNotPorted("listDeclaredLivePreviewFinalizerCapabilities");
}

export function listDeclaredReceiveAckPolicies(): never {
  throwNotPorted("listDeclaredReceiveAckPolicies");
}

export function createLiveMessageState(_params: unknown): LiveMessageState {
  throwNotPorted("createLiveMessageState");
}

export function createDurableMessageStateRecord(_params: unknown): DurableMessageStateRecord {
  throwNotPorted("createDurableMessageStateRecord");
}

export function markLiveMessageCancelled(_state: LiveMessageState): LiveMessageState {
  throwNotPorted("markLiveMessageCancelled");
}

export function markLiveMessageFinalized(_state: LiveMessageState, _params: unknown): LiveMessageState {
  throwNotPorted("markLiveMessageFinalized");
}

export function markLiveMessagePreviewUpdated(_state: LiveMessageState, _params: unknown): LiveMessageState {
  throwNotPorted("markLiveMessagePreviewUpdated");
}

export function resolveMessageReceiptPrimaryId(_receipt: MessageReceipt): string {
  throwNotPorted("resolveMessageReceiptPrimaryId");
}

export function shouldAckMessageAfterStage(_params: unknown): boolean {
  throwNotPorted("shouldAckMessageAfterStage");
}

export function verifyChannelMessageAdapterCapabilityProofs(_params: unknown): boolean {
  throwNotPorted("verifyChannelMessageAdapterCapabilityProofs");
}

export function verifyChannelMessageLiveCapabilityAdapterProofs(_params: unknown): boolean {
  throwNotPorted("verifyChannelMessageLiveCapabilityAdapterProofs");
}

export function verifyChannelMessageLiveCapabilityProofs(_params: unknown): boolean {
  throwNotPorted("verifyChannelMessageLiveCapabilityProofs");
}

export function verifyChannelMessageLiveFinalizerProofs(_params: unknown): boolean {
  throwNotPorted("verifyChannelMessageLiveFinalizerProofs");
}

export function verifyChannelMessageReceiveAckPolicyAdapterProofs(_params: unknown): boolean {
  throwNotPorted("verifyChannelMessageReceiveAckPolicyAdapterProofs");
}

export function verifyChannelMessageReceiveAckPolicyProofs(_params: unknown): boolean {
  throwNotPorted("verifyChannelMessageReceiveAckPolicyProofs");
}

export function verifyDurableFinalCapabilityProofs(_params: unknown): boolean {
  throwNotPorted("verifyDurableFinalCapabilityProofs");
}

export function verifyLivePreviewFinalizerCapabilityProofs(_params: unknown): boolean {
  throwNotPorted("verifyLivePreviewFinalizerCapabilityProofs");
}

export function classifyDurableSendRecoveryState(_params: unknown): unknown {
  throwNotPorted("classifyDurableSendRecoveryState");
}

export const hasFinalChannelTurnDispatch = (_result: unknown): boolean => false;
export const hasVisibleChannelTurnDispatch = (_result: unknown): boolean => false;
export const resolveChannelTurnDispatchCounts = (_result: unknown): { final: number; visible: number } => ({ final: 0, visible: 0 });

/** @deprecated Use `createChannelMessageReplyPipeline(...)` for compatibility dispatchers. */
export function createChannelTurnReplyPipeline(params: { cfg: unknown; agentId: string; channel?: string; accountId?: string }): ChannelReplyPipeline {
  return createChannelReplyPipeline(params as Parameters<typeof createChannelReplyPipeline>[0]);
}

/** @deprecated Compatibility helper for legacy reply dispatch results. */
export const hasFinalChannelMessageReplyDispatch = hasFinalChannelTurnDispatch;
/** @deprecated Compatibility helper for legacy reply dispatch results. */
export const hasVisibleChannelMessageReplyDispatch = hasVisibleChannelTurnDispatch;
/** @deprecated Compatibility helper for legacy reply dispatch results. */
export const resolveChannelMessageReplyDispatchCounts = resolveChannelTurnDispatchCounts;

/** @deprecated Compatibility helper for legacy reply dispatch bridges. */
export const buildChannelMessageReplyDispatchBase = (_params: unknown): unknown => {
  throwNotPorted("buildChannelMessageReplyDispatchBase");
};

/** @deprecated Compatibility reply-dispatch bridge. */
export async function dispatchChannelMessageReplyWithBase(..._args: unknown[]): Promise<unknown> {
  throwNotPorted("dispatchChannelMessageReplyWithBase");
}

/** @deprecated Compatibility reply-dispatch bridge. */
export async function recordChannelMessageReplyDispatch(..._args: unknown[]): Promise<unknown> {
  throwNotPorted("recordChannelMessageReplyDispatch");
}

export async function deliverInboundReplyWithMessageSendContext(..._args: unknown[]): Promise<unknown> {
  throwNotPorted("deliverInboundReplyWithMessageSendContext");
}

/** @deprecated Use `deliverInboundReplyWithMessageSendContext`. */
export const deliverDurableInboundReplyPayload = deliverInboundReplyWithMessageSendContext;

export async function sendDurableMessageBatch(_params: unknown): Promise<unknown> {
  throwNotPorted("sendDurableMessageBatch");
}

export async function withDurableMessageSendContext<T>(_params: unknown, _run: (ctx: unknown) => Promise<T>): Promise<T> {
  throwNotPorted("withDurableMessageSendContext");
}

const defaultManualReceiveAdapter = {
  defaultAckPolicy: "manual",
  supportedAckPolicies: ["manual"],
} as const;

export function defineChannelMessageAdapter<const TAdapter extends ChannelMessageAdapterShape>(
  adapter: TAdapter,
): ChannelMessageAdapter<TAdapter> {
  return {
    ...adapter,
    receive: adapter.receive ?? defaultManualReceiveAdapter,
  } as ChannelMessageAdapter<TAdapter>;
}
