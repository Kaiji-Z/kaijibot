import { completeSimple, type Api, type Model, type TextContent } from "@mariozechner/pi-ai";
import type { KaijiBotConfig } from "../../config/types.kaijibot.js";
import type { ResolvedProviderAuth } from "../../agents/model-auth.js";
import { prepareSimpleCompletionModel } from "../../agents/simple-completion-runtime.js";
import { resolveDefaultModelForAgent } from "../../agents/model-selection.js";
import { extractFromMessage } from "./extractor.js";
import type { PersonaTree } from "../types.js";
import type { ExtractionResult } from "./types.js";

export type LlmExtractorDeps = {
  complete: typeof completeSimple;
  prepareModel: (
    cfg: KaijiBotConfig,
    modelRef?: string,
  ) => Promise<{ model: Model<Api>; auth: ResolvedProviderAuth } | { error: string }>;
};

export type LlmExtractorOptions = {
  modelRef?: string;
  timeout?: number;
  maxTokens?: number;
};

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_TOKENS = 300;

function isTextContentBlock(block: { type: string }): block is TextContent {
  return block.type === "text";
}

function splitModelRef(modelRef: string): { provider: string; modelId: string } | null {
  const idx = modelRef.indexOf("/");
  if (idx > 0 && idx < modelRef.length - 1) {
    return { provider: modelRef.slice(0, idx), modelId: modelRef.slice(idx + 1) };
  }
  return null;
}

export function createDefaultDeps(): LlmExtractorDeps {
  return {
    complete: completeSimple,
    prepareModel: async (cfg, modelRef) => {
      if (modelRef) {
        const split = splitModelRef(modelRef);
        if (split) {
          return prepareSimpleCompletionModel({ cfg, provider: split.provider, modelId: split.modelId });
        }
      }
      const resolved = resolveDefaultModelForAgent({ cfg });
      return prepareSimpleCompletionModel({ cfg, provider: resolved.provider, modelId: resolved.model });
    },
  };
}

/**
 * LLM-based persona extraction with rule-based fallback.
 *
 * Sends the conversation turn + existing persona to the LLM and asks it to
 * extract structured persona attributes. Falls back to the rule-based
 * `extractFromMessage()` on timeout, error, or empty/unparseable response.
 *
 * This function **never throws**.
 */
export async function extractFromMessageLLM(
  userMessage: string,
  assistantMessage: string,
  existingPersona: PersonaTree | undefined,
  config: KaijiBotConfig,
  deps: LlmExtractorDeps,
  options?: LlmExtractorOptions,
): Promise<ExtractionResult> {
  const prompt = buildExtractionPrompt(userMessage, assistantMessage, existingPersona);

  try {
    const modelRef =
      options?.modelRef ?? config.cognitive?.persona?.extractionModel;
    const prepared = await deps.prepareModel(config, modelRef);

    if ("error" in prepared) {
      return extractFromMessage(userMessage, assistantMessage, existingPersona);
    }

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      options?.timeout ?? DEFAULT_TIMEOUT_MS,
    );

    let result: Awaited<ReturnType<typeof completeSimple>>;
    try {
      result = await deps.complete(
        prepared.model,
        {
          messages: [
            { role: "user", content: prompt, timestamp: Date.now() },
          ],
        },
        {
          apiKey: prepared.auth.apiKey,
          maxTokens: options?.maxTokens ?? DEFAULT_MAX_TOKENS,
          temperature: 0.2,
          signal: controller.signal,
        },
      );
    } finally {
      clearTimeout(timeout);
    }

    const text = result.content
      .filter(isTextContentBlock)
      .map((block) => block.text)
      .join("")
      .trim();

    if (!text) {
      return extractFromMessage(userMessage, assistantMessage, existingPersona);
    }

    const parsed = parseLLMExtraction(text);
    // If the LLM returned nothing meaningful, fall back to rule-based
    if (
      parsed.attributes.length === 0 &&
      parsed.domains.length === 0 &&
      parsed.recentFocus.length === 0 &&
      parsed.pendingQuestions.length === 0
    ) {
      return extractFromMessage(userMessage, assistantMessage, existingPersona);
    }

    return parsed;
  } catch {
    return extractFromMessage(userMessage, assistantMessage, existingPersona);
  }
}

function buildExtractionPrompt(
  userMessage: string,
  assistantMessage: string,
  persona: PersonaTree | undefined,
): string {
  const personaContext = persona
    ? `\n\nKnown persona:\n- Domains: ${Object.keys(persona.domains).join(", ") || "none"}\n- Focus: ${persona.recentFocus.slice(0, 5).join(", ") || "none"}\n- Questions: ${persona.pendingQuestions.slice(0, 3).join("; ") || "none"}`
    : "";

  return `You are a persona extraction system. Analyze the conversation turn below and extract structured persona attributes.

USER MESSAGE:
${userMessage.slice(-1000)}

ASSISTANT MESSAGE:
${assistantMessage.slice(-500)}
${personaContext}

Extract and respond with ONLY a JSON object in this exact format (no markdown, no code fences):
{
  "attributes": [
    {"field": "identity.coreTraits.职业", "value": "...", "confidence": 0.8, "source": "explicit", "evidence": "..."},
    {"field": "identity.communicationStyle.technicalLevel", "value": "expert", "confidence": 0.7, "source": "inferred", "evidence": "..."}
  ],
  "domains": [
    {"name": "AI/机器学习", "depth": 3, "insights": [], "questions": []}
  ],
  "recentFocus": ["topic1", "topic2"],
  "pendingQuestions": ["question1"]
}

Rules:
- Only extract what is clearly stated or strongly implied
- confidence: 0-1, where 1 is absolutely certain
- source: "explicit" (user stated it), "inferred" (strongly implied), "observed" (from behavior)
- domain depth: 1=mentioned, 3=familiar, 5=expert
- Only include domains that are actually discussed
- If nothing meaningful can be extracted, return empty arrays
- Respond with ONLY the JSON, nothing else`;
}

function parseLLMExtraction(text: string): ExtractionResult {
  try {
    // Strip markdown code fences if present
    const cleaned = text
      .replace(/^```(?:json)?\s*/m, "")
      .replace(/\s*```$/m, "")
      .trim();
    const parsed = JSON.parse(cleaned);

    return {
      attributes: Array.isArray(parsed.attributes)
        ? parsed.attributes.map((a: Record<string, unknown>) => ({
            field: String(a.field ?? ""),
            value: String(a.value ?? ""),
            confidence: clamp01(Number(a.confidence ?? 0.5)),
            source: validSource(a.source),
            evidence: String(a.evidence ?? ""),
          }))
        : [],
      domains: Array.isArray(parsed.domains)
        ? parsed.domains.map((d: Record<string, unknown>) => ({
            name: String(d.name ?? ""),
            depth: clampDepth(Number(d.depth ?? 1)),
            insights: Array.isArray(d.insights) ? d.insights.map(String) : [],
            questions: Array.isArray(d.questions) ? d.questions.map(String) : [],
          }))
        : [],
      recentFocus: Array.isArray(parsed.recentFocus)
        ? parsed.recentFocus.map(String).slice(0, 5)
        : [],
      pendingQuestions: Array.isArray(parsed.pendingQuestions)
        ? parsed.pendingQuestions.map(String).slice(0, 5)
        : [],
    };
  } catch {
    return { attributes: [], domains: [], recentFocus: [], pendingQuestions: [] };
  }
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function clampDepth(n: number): number {
  return Math.max(1, Math.min(5, n));
}

function validSource(
  value: unknown,
): "explicit" | "inferred" | "observed" {
  const s = String(value);
  if (s === "explicit" || s === "inferred" || s === "observed") return s;
  return "inferred";
}
