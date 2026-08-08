import { resolveCognitiveUserId } from "../cognitive/identity.js";
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

const FOLLOWUP_PATTERNS = [
  "展开", "详细", "具体", "深入", "解释", "说明", "什么意思",
  "举例", "例子", "比如", "怎么理解", "怎么看", "继续", "然后呢",
  "接着说", "为什么", "你是说", "你的意思是", "讲讲", "多说点",
  "tell me more", "elaborate", "explain", "what do you mean",
  "how so", "example", "go on", "continue", "interesting",
];

function textToBigrams(text: string): Set<string> {
  const clean = text.toLowerCase().replace(/[^\w\u4e00-\u9fff]/g, "");
  const result = new Set<string>();
  for (let i = 0; i < clean.length - 1; i++) {
    result.add(clean.slice(i, i + 2));
  }
  return result;
}

function bigramSimilarity(a: string, b: string): number {
  const setA = textToBigrams(a);
  const setB = textToBigrams(b);
  if (setA.size === 0 || setB.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const gram of setA) {
    if (setB.has(gram)) {
      intersection++;
    }
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export type DispatchInboundResult = DispatchFromConfigResult;

/**
 * Extract a userId from a session key + sender context.
 * Delegates to the unified resolveCognitiveUserId (channel-agnostic).
 */
function extractUserIdFromSessionKey(sessionKey: string, senderId?: string | null): string | null {
  return resolveCognitiveUserId(sessionKey, senderId);
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

  const userId = extractUserIdFromSessionKey(sessionKey, params.ctx.SenderId);
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

    const existing = await personaStore.load(agentId, userId);
    if (!existing) {
      return;
    }

    const userMessage = params.ctx.BodyForCommands ?? params.ctx.Body ?? "";
    const topic = insight.targetDomains[0];
    const signals = collectorMod.extractImplicitSignals(userMessage, undefined, topic, [topic]);
    const sentiment = collectorMod.classifySentimentFromSignals(signals);

    await personaStore.update(agentId, userId, (persona) =>
      collectorMod.processInsightFeedback(persona, insight, sentiment),
    );

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

async function detectInsightFollowupFeedback(params: {
  ctx: MsgContext | FinalizedMsgContext;
  cfg: KaijiBotConfig;
}): Promise<void> {
  const sessionKey = params.ctx.SessionKey;
  if (!sessionKey) {
    return;
  }
  if (params.cfg.cognitive?.enabled === false) {
    return;
  }
  const userId = extractUserIdFromSessionKey(sessionKey, params.ctx.SenderId);
  if (!userId) {
    return;
  }
  const userMessage = params.ctx.BodyForCommands ?? params.ctx.Body ?? "";
  if (!userMessage.trim()) {
    return;
  }

  const FOLLOWUP_WINDOW_MS = 30 * 60 * 1000;
  const SIMILARITY_THRESHOLD = 0.08;

  try {
    const [{ resolveConfigDir }, { resolveSessionAgentId }] = await Promise.all([
      import("../utils.js"),
      import("../agents/agent-scope.js"),
    ]);
    const insightStoreMod = await import("../cognitive/insight/store.js");
    const personaStoreMod = await import("../cognitive/persona/store.js");
    const collectorMod = await import("../cognitive/feedback/collector.js");

    const agentId = resolveSessionAgentId({ sessionKey, config: params.cfg });
    const configDir = resolveConfigDir();
    const personaStore = new personaStoreMod.PersonaStore(configDir);

    // Window check uses the most recent *delivered* insight's deliveredAt,
    // NOT persona.feedbackProfile.lastProactiveAt — that field is also
    // advanced by the time-based no-response penalty (proactive-scheduler),
    // so it no longer reflects the true last delivery time. Using it here
    // made the followup window effectively un-reachable after any penalty.
    const insightStore = new insightStoreMod.InsightStore(configDir);
    const recentDelivered = await insightStore.listRecent(agentId, userId, 5);
    const insight = recentDelivered.find(
      (r) => r.deliveredAt !== undefined && Date.now() - r.deliveredAt <= FOLLOWUP_WINDOW_MS,
    );
    if (!insight) {
      return;
    }

    const isDiscussing = bigramSimilarity(userMessage, insight.content) >= SIMILARITY_THRESHOLD;
    const isFollowUp = FOLLOWUP_PATTERNS.some((p) => userMessage.toLowerCase().includes(p));

    if (!isDiscussing && !isFollowUp) {
      return;
    }

    const sentiment = isDiscussing ? "engaged" : "positive";

    await personaStore.update(agentId, userId, (p) =>
      collectorMod.processInsightFeedback(p, insight, sentiment),
    );
    await insightStore.updateFeedback(agentId, userId, insight.id, sentiment, userMessage);

    log.info("insight followup feedback detected", {
      userId,
      insightId: insight.id,
      sentiment,
      isDiscussing,
      isFollowUp,
    });
  } catch (err) {
    log.warn(`insight followup feedback detection failed: ${String(err)}`);
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
  void detectInsightFollowupFeedback({ ctx: finalized, cfg: params.cfg }).catch((err) => {
    log.warn(`detectInsightFollowupFeedback unexpected error: ${String(err)}`);
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
