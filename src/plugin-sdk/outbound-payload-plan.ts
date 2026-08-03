import { resolveSendableOutboundReplyParts } from "./reply-payload.js";
import { parseReplyDirectives } from "../auto-reply/reply/reply-directives.js";
import {
  isRenderablePayload,
  shouldSuppressReasoningPayload,
} from "../auto-reply/reply/reply-payloads.js";
import type { ReplyPayload } from "../auto-reply/types.js";
import {
  hasInteractiveReplyBlocks,
  hasMessagePresentationBlocks,
  hasReplyChannelData,
  hasReplyPayloadContent,
  type InteractiveReply,
  type MessagePresentation,
  type ReplyPayloadDelivery,
} from "../interactive/payload.js";

export type { InteractiveReply, MessagePresentation, ReplyPayloadDelivery };

export type OutboundPayloadPlanContext = {
  cfg?: unknown;
  sessionKey?: string;
  surface?: string;
  conversationType?: string;
};

export type OutboundPayloadPlan = {
  payload: ReplyPayload;
  parts: ReturnType<typeof resolveSendableOutboundReplyParts>;
  hasPresentation: boolean;
  hasInteractive: boolean;
  hasChannelData: boolean;
};

function mergeMediaUrls(...lists: Array<ReadonlyArray<string | undefined> | undefined>): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const list of lists) {
    if (!list) {
      continue;
    }
    for (const entry of list) {
      const trimmed = entry?.trim();
      if (!trimmed) {
        continue;
      }
      if (seen.has(trimmed)) {
        continue;
      }
      seen.add(trimmed);
      merged.push(trimmed);
    }
  }
  return merged;
}

type PreparedOutboundPayloadPlanEntry = {
  payload: ReplyPayload;
  hasPresentation: boolean;
  hasInteractive: boolean;
  hasChannelData: boolean;
  isSilent: boolean;
};

function createOutboundPayloadPlanEntry(
  payload: ReplyPayload,
): PreparedOutboundPayloadPlanEntry | null {
  if (shouldSuppressReasoningPayload(payload)) {
    return null;
  }
  const parsed = parseReplyDirectives(payload.text ?? "");
  const explicitMediaUrls = payload.mediaUrls ?? parsed.mediaUrls;
  const explicitMediaUrl = payload.mediaUrl ?? parsed.mediaUrl;
  const mergedMedia = mergeMediaUrls(
    explicitMediaUrls,
    explicitMediaUrl ? [explicitMediaUrl] : undefined,
  );
  const parsedText = parsed.text ?? "";
  const isSilent = parsed.isSilent && mergedMedia.length === 0;
  const hasMultipleMedia = (explicitMediaUrls?.length ?? 0) > 1;
  const resolvedMediaUrl = hasMultipleMedia ? undefined : explicitMediaUrl;
  const normalizedPayload: ReplyPayload = {
    ...payload,
    text: parsedText,
    mediaUrls: mergedMedia.length ? mergedMedia : undefined,
    mediaUrl: resolvedMediaUrl,
    replyToId: payload.replyToId ?? parsed.replyToId,
    replyToTag: payload.replyToTag || parsed.replyToTag,
    replyToCurrent: payload.replyToCurrent || parsed.replyToCurrent,
    audioAsVoice: Boolean(payload.audioAsVoice || parsed.audioAsVoice),
  };
  if (!isRenderablePayload(normalizedPayload) && !isSilent) {
    return null;
  }
  const hasChannelData = hasReplyChannelData(normalizedPayload.channelData);
  return {
    payload: normalizedPayload,
    hasPresentation: hasMessagePresentationBlocks(
      (normalizedPayload as ReplyPayload & { presentation?: unknown }).presentation,
    ),
    hasInteractive: hasInteractiveReplyBlocks(normalizedPayload.interactive),
    hasChannelData,
    isSilent,
  };
}

export function createOutboundPayloadPlan(
  payloads: readonly ReplyPayload[],
  _context: OutboundPayloadPlanContext = {},
): OutboundPayloadPlan[] {
  const prepared: PreparedOutboundPayloadPlanEntry[] = [];
  for (const payload of payloads) {
    const entry = createOutboundPayloadPlanEntry(payload);
    if (!entry) {
      continue;
    }
    prepared.push(entry);
  }
  const plan: OutboundPayloadPlan[] = [];
  for (const entry of prepared) {
    if (entry.isSilent) {
      continue;
    }
    plan.push({
      payload: entry.payload,
      parts: resolveSendableOutboundReplyParts(entry.payload),
      hasPresentation: entry.hasPresentation,
      hasInteractive: entry.hasInteractive,
      hasChannelData: entry.hasChannelData,
    });
  }
  return plan;
}

export function projectOutboundPayloadPlanForDelivery(
  plan: readonly OutboundPayloadPlan[],
): ReplyPayload[] {
  return plan.map((entry) => entry.payload);
}

export function hasReplyPayloadPlanContent(plan: readonly OutboundPayloadPlan[]): boolean {
  return plan.some((entry) =>
    hasReplyPayloadContent(
      { ...entry.payload, text: entry.parts.text, mediaUrls: entry.parts.mediaUrls },
      { hasChannelData: entry.hasChannelData },
    ),
  );
}
