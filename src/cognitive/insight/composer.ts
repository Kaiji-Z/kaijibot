import { complete, type Api, type Model } from "@mariozechner/pi-ai";
import { randomUUID } from "node:crypto";
import type { ResolvedProviderAuth } from "../../agents/model-auth.js";
import { prepareSimpleCompletionModel } from "../../agents/simple-completion-runtime.js";
import type { KaijiBotConfig } from "../../config/config.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import type { PersonaTree } from "../types.js";
import type { BlindSpotCandidate } from "./fragment-types.js";
import { isSubstantiveContent, buildVoiceSection } from "./llm-engine.js";
import type { InsightCandidate } from "./types.js";

const FEW_SHOT_FOR_COMPOSER = [
  {
    context: "User tracks LLM fine-tuning. New: DPO",
    chinese: "你之前试过 LoRA 微调，最近 DPO 在大多数场景下已经能替代 RLHF 了——不需要 reward model，代码量是 PPO 的十分之一。",
    english: "You tried LoRA fine-tuning before — DPO now replaces RLHF in most scenarios. No reward model needed, code is 10x simpler than PPO.",
  },
  {
    context: "User knows TypeScript + embedded. Bridge: Rust RTOS",
    chinese: "你同时在看 TypeScript 和嵌入式，Rust 写 RTOS 内核的 embassy 框架用 async/await 模型做嵌入式并发——跟你写 TS 的思维模型完全一致，但跑在裸机上。",
    english: "You're into TypeScript and embedded — the embassy RTOS framework in Rust uses async/await for embedded concurrency. Same mental model as TS, but running on bare metal.",
  },
];

const log = createSubsystemLogger("cognitive/composer");

export type ComposerDeps = {
  complete: typeof complete;
  prepareModel: (
    cfg: KaijiBotConfig,
    modelRef?: string,
  ) => Promise<
    | { model: Model<Api>; auth: ResolvedProviderAuth }
    | { error: string }
  >;
  webSearch?: (query: string) => Promise<Array<{ title: string; url: string; snippet: string }>>;
  systemContext?: string;
};

export function createDefaultComposerDeps(): ComposerDeps {
  return {
    complete,
    prepareModel: async (cfg, modelRef) => {
      const extractionModel = cfg.cognitive?.persona?.extractionModel;
      const modelRefToUse = modelRef ?? extractionModel ?? "zai/glm-5-turbo";
      const [provider, ...modelParts] = modelRefToUse.split("/");
      const modelId = modelParts.join("/") || "glm-5-turbo";
      return prepareSimpleCompletionModel({ cfg, provider, modelId });
    },
  };
}

const TECHNICAL_TERMS = [
  "framework",
  "library",
  "algorithm",
  "pattern",
  "protocol",
  "architecture",
  "compiler",
  "runtime",
  "paradigm",
  "interface",
  "abstraction",
  "optimization",
  "concurrency",
  "serialization",
  "middleware",
];

export function containsFactualClaims(text: string): boolean {
  const digitMatches = text.match(/\d+/g);
  if (digitMatches && digitMatches.length >= 2) return true;
  const lower = text.toLowerCase();
  return TECHNICAL_TERMS.some((term) => lower.includes(term));
}

function getRecentInsightAvoidance(persona: PersonaTree): string {
  const recentContents = persona.feedbackProfile?.recentInsightContents;
  if (!recentContents || recentContents.length === 0) return "";
  const bannedOpenings = recentContents
    .slice(-3)
    .map((c) => c.trim().slice(0, 8))
    .filter((o) => o.length >= 4);
  if (bannedOpenings.length === 0) return "";
  return `Do NOT start with: ${bannedOpenings.map((o) => `"${o}"`).join(", ")}`;
}

/**
 * Compose a proactive insight from a BlindSpotCandidate via LLM.
 * Returns null on empty/generic content or any error. Never throws.
 */
export async function composeInsight(
  candidate: BlindSpotCandidate,
  persona: PersonaTree,
  config: KaijiBotConfig,
  deps: ComposerDeps,
): Promise<InsightCandidate | null> {
  let webContext = "";
  if (deps.webSearch && containsFactualClaims(candidate.blindSpot)) {
    try {
      const results = await deps.webSearch(candidate.blindSpot.slice(0, 100));
      const topResults = results.slice(0, 3);
      if (topResults.length > 0) {
        webContext = topResults.map((r) => `${r.title}: ${r.snippet}`).join("\n");
      }
    } catch (err) {
      log.warn("web search failed, proceeding without web context", { error: String(err) });
    }
  }

  const lang =
    config.cognitive?.insight?.outputLanguage ??
    persona.identity?.primaryLanguage ??
    "zh";
  const langInstruction = lang === "en" ? "Output in English." : "用中文输出。";

  const userName = persona.identity?.displayName ?? "";
  const nameLine = userName ? `User name: ${userName}` : "";

  const avoidanceLine = getRecentInsightAvoidance(persona);

  const voiceSection = buildVoiceSection(persona);
  const fewShotBlock = FEW_SHOT_FOR_COMPOSER.map(e => `Context: ${e.context}\n中文: ${e.chinese}\nEnglish: ${e.english}`).join("\n\n");

  const prompt = `${voiceSection}

EXAMPLES of ideal insights (match this quality, specificity, and tone):
${fewShotBlock}

${nameLine ? nameLine + "\n" : ""}BLIND SPOT:
${candidate.blindSpot}

DOMAINS: ${candidate.domains.join(", ")}
IMPACT TYPE: ${candidate.potentialImpact}
${webContext ? `\nWEB CONTEXT (use naturally, do NOT say 'saw'/'read'/'reportedly'):\n${webContext}` : ""}
${avoidanceLine ? `\n${avoidanceLine}` : ""}

Write 1-3 sentences. Start with something specific — a fact, number, or concrete observation.
${langInstruction}

Respond with ONLY the insight text (no JSON, no markdown, no code fences).`;

  let text: string;
  try {
    const prepared = await deps.prepareModel(config);
    if ("error" in prepared) {
      log.warn("model preparation failed", { error: prepared.error });
      return null;
    }

    const messages: Array<{ role: "user"; content: string; timestamp: number }> = [
      { role: "user", content: prompt, timestamp: Date.now() },
    ];
    const systemPrompt = deps.systemContext || undefined;

    const result = await deps.complete(
      prepared.model,
      { messages, systemPrompt },
      {
        apiKey: prepared.auth.apiKey,
        maxTokens: 300,
        temperature: 0.8,
        signal: AbortSignal.timeout(10_000),
      },
    );

    text = result.content
      .filter(
        (block): block is { type: "text"; text: string } => block.type === "text",
      )
      .map((block) => block.text)
      .join("")
      .trim();
  } catch (err) {
    const isTimeout = err instanceof DOMException && err.name === "TimeoutError";
    log.warn(`LLM call ${isTimeout ? "timed out" : "failed"}`, { error: String(err) });
    return null;
  }

  if (!text || !isSubstantiveContent(text)) {
    log.warn("LLM response empty or generic, discarding", { text: text.slice(0, 100) });
    return null;
  }

  log.info("insight composed", { contentPreview: text.slice(0, 80), domains: candidate.domains });

  return {
    id: randomUUID(),
    content: text,
    rationale: `Blind spot: ${candidate.blindSpot}`,
    targetDomains: candidate.domains,
    sourceDomains: candidate.unusedDomains,
    relevanceScore: candidate.crystallizationScore,
    surpriseScore: candidate.crystallizationScore * 0.8,
    compositeScore: candidate.crystallizationScore,
    sources: [],
    verificationStatus: "unverified",
  };
}
