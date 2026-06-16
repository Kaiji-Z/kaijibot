import type { KaijiBotConfig } from "../config/config.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import type { DispatchFromConfigResult } from "./reply/dispatch-from-config.js";
import { dispatchReplyFromConfig } from "./reply/dispatch-from-config.js";
import { finalizeInboundContext } from "./reply/inbound-context.js";
import {
  createReplyDispatcher,
  createReplyDispatcherWithTyping,
  type ReplyDispatcher,
  type ReplyDispatcherOptions,
  type ReplyDispatcherWithTypingOptions,
} from "./reply/reply-dispatcher.js";
import type { FinalizedMsgContext, MsgContext } from "./templating.js";
import type { GetReplyOptions } from "./types.js";

const log = createSubsystemLogger("auto-reply/dispatch");

export type DispatchInboundResult = DispatchFromConfigResult;

/**
 * Extract a feishu user id (ou_xxx) from a session key.
 * Mirrors the logic in memory-host-sdk/consolidation-userid.ts (not exported there).
 *   agent:main:feishu:direct:ou_xxx → ou_xxx
 *   agent:main:feishu:group:oc_xxx:...:sender:ou_xxx → ou_xxx
 *   agent:ou_xxx:rest → ou_xxx (fallback)
 */
function extractUserIdFromSessionKey(sessionKey: string): string | null {
  const parts = sessionKey.split(":");
  const tail = parts[parts.length - 1];
  if (tail && tail !== "main" && tail.startsWith("ou_")) {
    return tail;
  }
  if (parts.length >= 3 && parts[1] && parts[1] !== "main") {
    return parts[1];
  }
  return null;
}

/**
 * When an inbound message is a reply (parent_id / ReplyToId) to a previously
 * delivered proactive insight, extract implicit feedback signals from the
 * reply text and feed them back into the Thompson Sampling bandits via
 * processInsightFeedback. Fire-and-forget — never blocks the reply path.
 */
async function detectInsightReplyFeedback(params: {
  ctx: MsgContext | FinalizedMsgContext;
  cfg: KaijiBotConfig;
}): Promise<void> {
  const replyToId = params.ctx.ReplyToId?.trim();
  const sessionKey = params.ctx.SessionKey;
  if (!replyToId || !sessionKey) {
    return;
  }
  if (params.cfg.cognitive?.enabled === false) {
    return;
  }

  const userId = extractUserIdFromSessionKey(sessionKey);
  if (!userId) {
    return;
  }

  try {
    const [{ resolveConfigDir }, { resolveSessionAgentId }, insightStoreMod, personaStoreMod] =
      await Promise.all([
        import("../utils.js"),
        import("../agents/agent-scope.js"),
        import("../cognitive/insight/store.js"),
        import("../cognitive/persona/store.js"),
      ]);
    const collectorMod = await import("../cognitive/feedback/collector.js");

    const agentId = resolveSessionAgentId({ sessionKey, config: params.cfg });
    const configDir = resolveConfigDir();
    const insightStore = new insightStoreMod.InsightStore(configDir);
    const personaStore = new personaStoreMod.PersonaStore(configDir);

    const insight = await insightStore.findByDeliveryMessageId(agentId, userId, replyToId);
    if (!insight) {
      return;
    }

    const persona = await personaStore.load(agentId, userId);
    if (!persona) {
      return;
    }

    const userMessage = params.ctx.BodyForCommands ?? params.ctx.Body ?? "";
    const topic = insight.targetDomains[0];
    const signals = collectorMod.extractImplicitSignals(userMessage, undefined, topic, [topic]);
    const sentiment = collectorMod.classifySentimentFromSignals(signals);
    const updated = collectorMod.processInsightFeedback(persona, insight, sentiment);
    await personaStore.save(agentId, userId, updated);

    await insightStore.updateFeedback(agentId, userId, insight.id, sentiment, userMessage);

    log.info("insight reply feedback processed", {
      userId,
      insightId: insight.id,
      sentiment,
      signalCount: signals.length,
    });
  } catch (err) {
    log.warn(`insight reply feedback detection failed: ${String(err)}`);
  }
}

export async function withReplyDispatcher<T>(params: {
  dispatcher: ReplyDispatcher;
  run: () => Promise<T>;
  onSettled?: () => void | Promise<void>;
}): Promise<T> {
  try {
    return await params.run();
  } finally {
    // Ensure dispatcher reservations are always released on every exit path.
    params.dispatcher.markComplete();
    try {
      await params.dispatcher.waitForIdle();
    } finally {
      await params.onSettled?.();
    }
  }
}

export async function dispatchInboundMessage(params: {
  ctx: MsgContext | FinalizedMsgContext;
  cfg: KaijiBotConfig;
  dispatcher: ReplyDispatcher;
  replyOptions?: Omit<GetReplyOptions, "onToolResult" | "onBlockReply">;
  replyResolver?: typeof import("./reply.js").getReplyFromConfig;
}): Promise<DispatchInboundResult> {
  const finalized = finalizeInboundContext(params.ctx);
  void detectInsightReplyFeedback({ ctx: finalized, cfg: params.cfg }).catch((err) => {
    log.warn(`detectInsightReplyFeedback unexpected error: ${String(err)}`);
  });
  return await withReplyDispatcher({
    dispatcher: params.dispatcher,
    run: () =>
      dispatchReplyFromConfig({
        ctx: finalized,
        cfg: params.cfg,
        dispatcher: params.dispatcher,
        replyOptions: params.replyOptions,
        replyResolver: params.replyResolver,
      }),
  });
}

export async function dispatchInboundMessageWithBufferedDispatcher(params: {
  ctx: MsgContext | FinalizedMsgContext;
  cfg: KaijiBotConfig;
  dispatcherOptions: ReplyDispatcherWithTypingOptions;
  replyOptions?: Omit<GetReplyOptions, "onToolResult" | "onBlockReply">;
  replyResolver?: typeof import("./reply.js").getReplyFromConfig;
}): Promise<DispatchInboundResult> {
  const { dispatcher, replyOptions, markDispatchIdle, markRunComplete } =
    createReplyDispatcherWithTyping(params.dispatcherOptions);
  try {
    return await dispatchInboundMessage({
      ctx: params.ctx,
      cfg: params.cfg,
      dispatcher,
      replyResolver: params.replyResolver,
      replyOptions: {
        ...params.replyOptions,
        ...replyOptions,
      },
    });
  } finally {
    markRunComplete();
    markDispatchIdle();
  }
}

export async function dispatchInboundMessageWithDispatcher(params: {
  ctx: MsgContext | FinalizedMsgContext;
  cfg: KaijiBotConfig;
  dispatcherOptions: ReplyDispatcherOptions;
  replyOptions?: Omit<GetReplyOptions, "onToolResult" | "onBlockReply">;
  replyResolver?: typeof import("./reply.js").getReplyFromConfig;
}): Promise<DispatchInboundResult> {
  const dispatcher = createReplyDispatcher(params.dispatcherOptions);
  return await dispatchInboundMessage({
    ctx: params.ctx,
    cfg: params.cfg,
    dispatcher,
    replyResolver: params.replyResolver,
    replyOptions: params.replyOptions,
  });
}
