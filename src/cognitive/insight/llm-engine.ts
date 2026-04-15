import { complete, type Api, type Model } from "@mariozechner/pi-ai";
import { randomUUID } from "node:crypto";
import type { ResolvedProviderAuth } from "../../agents/model-auth.js";
import { prepareSimpleCompletionModel } from "../../agents/simple-completion-runtime.js";
import type { KaijiBotConfig } from "../../config/config.js";
import type { PersonaTree } from "../types.js";
import { generateInsightCandidates } from "./engine.js";
import type { InsightCandidate, InsightEngineInput } from "./types.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";

const log = createSubsystemLogger("cognitive/insight-llm");

/** A single web search result item. */
export type WebSearchResult = {
  title: string;
  url: string;
  snippet: string;
};

/**
 * Injected dependencies for LLM insight generation.
 * All external side-effects go through this interface for testability.
 */
export type LlmInsightDeps = {
  complete: typeof complete;
  prepareModel: (
    cfg: KaijiBotConfig,
    modelRef?: string,
  ) => Promise<
    | { model: Model<Api>; auth: ResolvedProviderAuth }
    | { error: string }
  >;
  /**
   * Optional web search function. When provided the insight generator
   * will query recent web results before calling the LLM, producing
   * time-relevant insights.  Returns an empty array when unavailable
   * (e.g. no API key configured).
   */
  webSearch?: (query: string) => Promise<WebSearchResult[]>;
};

export type LlmInsightOptions = {
  /** Override the model used for insight generation. */
  modelRef?: string;
  /** Timeout in milliseconds for the LLM call (default 8 000). */
  timeout?: number;
  /** Max tokens for the LLM response (default 500). */
  maxTokens?: number;
  /** Maximum number of candidates to return (default 3). */
  maxCandidates?: number;
};

/**
 * Build the default deps that hit real infrastructure.
 * Import and call this in production code.
 */
export function createDefaultInsightDeps(): LlmInsightDeps {
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

/**
 * LLM-based insight generation with template fallback.
 *
 * Sends persona + domain knowledge to the LLM and asks it to produce
 * personalised insight candidates.  Falls back to the deterministic
 * template engine whenever the LLM call fails, times out, or returns
 * unparseable output.
 *
 * This function **never throws**.
 */
export async function generateInsightCandidatesLLM(
  persona: PersonaTree,
  input: InsightEngineInput,
  config: KaijiBotConfig,
  deps: LlmInsightDeps,
  options?: LlmInsightOptions,
): Promise<InsightCandidate[]> {
  const maxCandidates = options?.maxCandidates ?? 3;

  let webResults: WebSearchResult[] = [];
  if (deps.webSearch) {
    const query = buildSearchQuery(input);
    if (query) {
      try {
        webResults = await deps.webSearch(query);
      } catch {
        webResults = [];
      }
    }
  }

  const prompt = buildInsightPrompt(persona, input, webResults);

  try {
    const modelRef =
      options?.modelRef ?? config.cognitive?.persona?.extractionModel;
    const prepared = await deps.prepareModel(config, modelRef);

    if ("error" in prepared) {
      log.warn(`LLM model preparation failed: ${prepared.error}, falling back to template`);
      return generateInsightCandidates(persona, input, { maxCandidates });
    }

    const timeoutMs = options?.timeout ?? 20_000;
    const result = await deps.complete(
      prepared.model,
      {
        messages: [
          { role: "user", content: prompt, timestamp: Date.now() },
        ],
      },
      {
        apiKey: prepared.auth.apiKey,
        maxTokens: options?.maxTokens ?? 500,
        temperature: 0.7,
        signal: AbortSignal.timeout(timeoutMs),
      },
    );

    const text = result.content
      .filter(
        (block): block is { type: "text"; text: string } =>
          block.type === "text",
      )
      .map((block) => block.text)
      .join("")
      .trim();

    if (!text) {
      log.warn("LLM returned empty response, falling back to template");
      return generateInsightCandidates(persona, input, { maxCandidates });
    }

    const candidates = parseLLMInsights(text, maxCandidates);
    if (candidates.length === 0) {
      log.warn(`LLM response could not be parsed as insights, falling back to template (raw: ${text.slice(0, 200)})`);
      return generateInsightCandidates(persona, input, { maxCandidates });
    }
    log.info(`LLM generated ${candidates.length} insight candidate(s)`);
    return candidates.map((c) => enrichWithWebSources(c, webResults));
  } catch (err) {
    const isTimeout = err instanceof DOMException && err.name === "TimeoutError";
    log.warn(`LLM insight generation ${isTimeout ? "timed out" : "failed"}: ${String(err)}, falling back to template`);
    return generateInsightCandidates(persona, input, { maxCandidates });
  }
}

function buildSearchQuery(input: InsightEngineInput): string {
  const parts: string[] = [];
  if (input.targetDomains.length > 0) {
    parts.push(input.targetDomains.slice(0, 2).join(" "));
  }
  if (input.pendingQuestions.length > 0) {
    parts.push(input.pendingQuestions[0]);
  }
  if (input.recentFocus.length > 0) {
    parts.push(input.recentFocus[0]);
  }
  return parts.join(" ").slice(0, 120);
}

function enrichWithWebSources(
  candidate: InsightCandidate,
  webResults: WebSearchResult[],
): InsightCandidate {
  if (webResults.length === 0) return candidate;
  return {
    ...candidate,
    sources: webResults.map((r) => ({
      url: r.url,
      title: r.title,
      credibility: 0.5,
    })),
  };
}

function buildInsightPrompt(
  persona: PersonaTree,
  input: InsightEngineInput,
  webResults: WebSearchResult[] = [],
): string {
  const userDomains = Object.entries(persona.domains)
    .map(
      ([name, d]) =>
        `${name} (depth: ${d.depth}, insights: ${d.keyInsights.slice(0, 2).join(", ")})`,
    )
    .join("\n");

  const recentFocus = persona.recentFocus.slice(0, 5).join(", ");
  const pendingQuestions = persona.pendingQuestions.slice(0, 3).join("; ");
  const recentInsightIds = input.recentInsightIds.slice(0, 5).join(", ");

  const identityBlock = persona.identity
    ? [
        `USER'S IDENTITY (the person you're talking to):`,
        `Name / call sign: ${persona.identity.displayName || "unknown"}`,
        persona.identity.coreTraits
          ? `Traits: ${Object.entries(persona.identity.coreTraits)
              .filter(([, v]) => v.confidence >= 0.5)
              .map(([k, v]) => `${k}: ${v.value}`)
              .join(", ")}`
          : "",
        persona.identity.expertDomains?.length
          ? `Expert in: ${persona.identity.expertDomains.join(", ")}`
          : "",
        persona.identity.interestDomains?.length
          ? `Interested in: ${persona.identity.interestDomains.join(", ")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n")
    : "";

  return `You ARE the AI assistant — speaking in your own voice, personality, and tone. You are NOT a system or a tool. You are reaching out proactively to share a thought that crossed your mind about something related to this user's interests.

${identityBlock}

USER'S KNOWLEDGE DOMAINS:
${userDomains || "Not yet established"}

Recent focus: ${recentFocus || "None"}
Pending questions: ${pendingQuestions || "None"}
Trust level: ${persona.rapport.trustScore.toFixed(2)} / 1.0
Already-delivered insight IDs (avoid repeating): ${recentInsightIds || "None"}
${webResults.length > 0 ? `\nRECENT WEB CONTEXT (use these to make insights timely and specific):\n${webResults.map((r, i) => `${i + 1}. ${r.title}: ${r.snippet}`).join("\n")}` : ""}

Generate 1-3 insights that:
1. Connect the user's different knowledge domains in unexpected, surprising ways
2. Relate to their pending questions or recent focus
3. Spark new thinking — like a creative partner who just had an idea, not a system delivering analysis
4. Feel personal and specific to THIS user
5. Are in Chinese (matching user's language)
${webResults.length > 0 ? "6. Reference specific facts from the RECENT WEB CONTEXT when relevant — this makes the insight current and grounded" : ""}

CRITICAL: The "content" field must sound like YOU (the assistant) speaking in your own voice — the same personality, mannerisms, and tone the user knows from regular conversations. NOT like a formal report or system notification.

Respond with ONLY a JSON array (no markdown, no code fences):
[
  {
    "content": "Your insight spoken in your own voice and personality, in Chinese",
    "rationale": "Why this insight is relevant to this user",
    "targetDomains": ["domain1"],
    "sourceDomains": ["domain2"],
    "relevanceScore": 0.8,
    "surpriseScore": 0.6
  }
]

Keep insights concise (1-3 sentences each). Quality over quantity.`;
}

function parseLLMInsights(
  text: string,
  maxCandidates: number,
): InsightCandidate[] {
  try {
    const cleaned = text
      .replace(/^```(?:json)?\s*/m, "")
      .replace(/\s*```$/m, "")
      .trim();
    const parsed = JSON.parse(cleaned);
    const items = Array.isArray(parsed) ? parsed : [];

    return items
      .slice(0, maxCandidates)
      .map((item: Record<string, unknown>) => ({
        id: randomUUID(),
        content: String(item.content ?? ""),
        rationale: String(item.rationale ?? ""),
        targetDomains: Array.isArray(item.targetDomains)
          ? item.targetDomains.map(String)
          : [],
        sourceDomains: Array.isArray(item.sourceDomains)
          ? item.sourceDomains.map(String)
          : [],
        relevanceScore: clamp01(Number(item.relevanceScore ?? 0.5)),
        surpriseScore: clamp01(Number(item.surpriseScore ?? 0.5)),
        compositeScore: 0,
        sources: [],
        verificationStatus: "unverified" as const,
      }))
      .filter((c: InsightCandidate) => c.content.length > 0);
  } catch {
    return [];
  }
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
