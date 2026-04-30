import { randomUUID } from "node:crypto";
import type { KaijiBotConfig } from "../../config/types.kaijibot.js";
import type { EvolutionCandidate } from "./types.js";

export type HardTriggerParams = {
  toolMetas: ReadonlyArray<{ toolName?: string; meta?: string }>;
  sessionKey: string;
  trigger?: string;
  config: KaijiBotConfig;
  senderId?: string | null;
  started: number;
};

export async function evaluateHardTrigger(params: HardTriggerParams): Promise<void> {
  if (params.trigger !== "user" && params.trigger !== "manual" && params.trigger !== undefined) {
    return;
  }

  const userId = resolveUserIdFromSession(params.sessionKey, params.senderId);
  if (!userId) return;

  const toolCalls = params.toolMetas
    .map((m) => m.toolName)
    .filter((name): name is string => typeof name === "string" && name.length > 0);
  if (toolCalls.length < 3) return;

  const { EvolutionEngine } = await import("./engine.js");
  const { EvolutionStore } = await import("./store.js");
  const { generateSkillDraftLLM } = await import("./llm-draft-generator.js");
  const { createStandaloneGenerateText } = await import("./standalone-generate.js");
  const { consumeToolErrorProfile } = await import("../../agents/tool-error-summary.js");
  const { enqueueSystemEvent } = await import("../../infra/system-events.js");
  const { resolveConfigDir } = await import("../../utils.js");

  const errorProfile = consumeToolErrorProfile(params.sessionKey);
  const uniqueTools = new Set(toolCalls);

  const candidate: EvolutionCandidate = {
    taskSummary: `Multi-step task with ${toolCalls.length} tool calls (${uniqueTools.size} unique)`,
    toolCalls,
    uniqueToolCount: uniqueTools.size,
    durationMs: Date.now() - params.started,
    reasoningTurns: Math.max(1, Math.floor(toolCalls.length / 2)),
    domain: "auto",
    errorProfile,
  };

  const configDir = resolveConfigDir();
  const store = new EvolutionStore(configDir);

  let engine: InstanceType<typeof EvolutionEngine>;
  try {
    const generateText = await createStandaloneGenerateText(params.config, {
      maxTokens: 4000,
      timeout: 60_000,
    });
    engine = new EvolutionEngine(store, undefined, undefined, (c) =>
      generateSkillDraftLLM(c, { generateText }),
    );
  } catch {
    engine = new EvolutionEngine(store);
  }

  const decision = await engine.evaluate(candidate, userId);
  if (!decision.shouldSuggest) return;

  const draft = await engine.generate(candidate);

  await store.save({
    id: randomUUID(),
    userId,
    candidate,
    decision,
    draft,
    timestamp: Date.now(),
  });

  const suggestionText = buildSuggestionText(candidate, draft);
  enqueueSystemEvent(suggestionText, { sessionKey: params.sessionKey });
}

function resolveUserIdFromSession(sessionKey: string, senderId?: string | null): string | null {
  if (senderId) return senderId;
  const tail = sessionKey.split(":").pop();
  if (!tail || tail === "main") return null;
  return tail;
}

function buildSuggestionText(
  candidate: EvolutionCandidate,
  draft: { name: string; description: string },
): string {
  return [
    `[系统提示] 刚才完成的任务涉及 ${candidate.toolCalls.length} 次工具调用（${candidate.uniqueToolCount} 种工具），耗时 ${Math.round(candidate.durationMs / 1000)} 秒。`,
    `系统已自动生成技能「${draft.name}」：${draft.description}`,
    "",
    "如果觉得有用，回复\u201C保存技能\u201D；如果需要调整，告诉我怎么改；不需要的话直接忽略即可。",
  ].join("\n");
}
