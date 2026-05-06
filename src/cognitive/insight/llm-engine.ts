import { complete, type Api, type Model } from "@mariozechner/pi-ai";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ResolvedProviderAuth } from "../../agents/model-auth.js";
import { prepareSimpleCompletionModel } from "../../agents/simple-completion-runtime.js";
import type { KaijiBotConfig } from "../../config/config.js";
import type { PersonaTree } from "../types.js";
import type { InsightCandidate, InsightEngineInput, InsightMode, LlmCritiqueResult, PromptBuildResult, VerificationResult } from "./types.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { inferSearchStrategy, type InterestInferenceDeps } from "./interest-inference.js";
import { isDuplicateByContent, isDuplicateBySemanticOverlap, extractContentThemes } from "./content-similarity.js";
import { pickPromptVariant } from "../feedback/preference-learner.js";

const log = createSubsystemLogger("cognitive/insight-llm");

export function buildVoiceSection(persona: PersonaTree): string {
  const style = persona.identity?.communicationStyle;
  const name = persona.identity?.displayName ?? "the user";
  const parts: string[] = [];
  parts.push(`You're writing to ${name}, a person you know well. This is a proactive message — like suddenly remembering something fascinating to tell a friend.`);
  if (style) {
    if (style.formality === "casual") parts.push("Tone: casual, like chatting with a close friend. Use 你 not 您.");
    else if (style.formality === "formal") parts.push("Tone: professional but warm. You can use 您 but keep it conversational.");
    else parts.push("Tone: natural and conversational. Match whatever feels right for the content.");
    if (style.technicalLevel === "expert") parts.push("Assume deep technical literacy. Use technical terms freely without explanation.");
    else if (style.technicalLevel === "beginner") parts.push("Explain technical concepts briefly when they appear. Avoid jargon.");
    if (style.verbosity === "concise") parts.push("Be brief: 1-2 sentences maximum. Every word earns its place.");
    else if (style.verbosity === "detailed") parts.push("You can use 2-3 sentences. Give enough context to be self-contained.");
  }
  return parts.join("\n");
}

const DIVERSE_FEW_SHOT_SETS = [
  {
    name: "Cross-domain bridge",
    examples: [
      {
        context: "User knows React and Rust. Bridge: WebAssembly",
        chinese: "Rust 编译到 WASM 的性能实测比 JS 快 3-10 倍，但你之前关注的 React 组件库有个完全不同的路线——编译时提取计算到 Worker，不碰 WASM。这对你同时写 Rust 和 React 的场景可能更有启发。",
        english: "Rust-to-WASM benchmarks show 3-10x over JS, but the React lib you follow takes a different approach — compile-time extraction to Workers, no WASM. Might be more relevant for your Rust+React stack.",
      },
      {
        context: "User tracks LLM fine-tuning. New: DPO",
        chinese: "你之前试过 LoRA 微调，最近 DPO 在大多数场景下已经能替代 RLHF 了——不需要 reward model，代码量是 PPO 的十分之一。",
        english: "You tried LoRA fine-tuning before — DPO now replaces RLHF in most scenarios. No reward model needed, code is 10x simpler than PPO.",
      },
    ],
  },
  {
    name: "Counter-intuitive observation",
    examples: [
      {
        context: "User optimizes for architecture flexibility",
        chinese: "你一直在用'先搭架子再填细节'的方式做架构，但你最近的几个技术选择都在优化灵活性——你实际上在回避什么时候该做硬编码决策这个问题。",
        english: "You keep using the 'scaffold first, fill in details later' approach to architecture, but your recent tech choices all optimize for flexibility — you're actually avoiding the question of when to make hardcoded decisions.",
      },
      {
        context: "User says they want to ship fast but invests in tooling",
        chinese: "你说要快速上线，但花了三周搭基础设施。这不算矛盾——你真正在意的是上线之后能不能快速迭代，而不是上线这个动作本身。",
        english: "You say you want to ship fast, but spent three weeks on infrastructure. Not a contradiction — what you actually care about is whether you can iterate fast after launch, not the act of launching itself.",
      },
    ],
  },
  {
    name: "Behavioral pattern",
    examples: [
      {
        context: "User asks AI for confirmation rather than challenge",
        chinese: "你问 AI 的方式暴露了一个倾向：你总是在确认自己已经怀疑的方向，而不是让 AI 挑战你的假设。试试反过来问它'我可能哪里想错了'。",
        english: "The way you ask AI reveals a pattern: you keep confirming directions you already suspect, rather than letting AI challenge your assumptions. Try asking it 'what might I be getting wrong' instead.",
      },
      {
        context: "User explores breadth but avoids going deep in any one area",
        chinese: "你每次深入一个方向到六七成就会切换到新话题。这不是缺乏专注——你是在用广度给自己找正确的深度方向。但你已经看了够多了，该选一个往下挖了。",
        english: "Every time you reach 60-70% depth in a direction, you switch to a new topic. Not lack of focus — you're using breadth to find the right direction for depth. But you've seen enough, it's time to pick one and dig.",
      },
    ],
  },
  {
    name: "Hidden priority",
    examples: [
      {
        context: "User says they want speed but always chooses completeness",
        chinese: "你嘴上说想快速迭代，但你每次的架构选择都在追求完备性。这不是矛盾——你其实更在乎系统的可预测性，而不是速度。",
        english: "You say you want fast iteration, but every architecture choice you make optimizes for completeness. Not a contradiction — you actually care more about system predictability than speed.",
      },
      {
        context: "User claims to value simplicity but gravitates toward complex solutions",
        chinese: "你说喜欢简单方案，但每次都选了更复杂的那个。不是你口是心非——你真正想要的是'可以自己掌控的复杂'，而不是黑箱式的简单。",
        english: "You say you prefer simple solutions, but always pick the more complex one. Not hypocrisy — what you actually want is 'complexity you can control yourself', not black-box simplicity.",
      },
    ],
  },
] as const;

const DIVERSITY_INSTRUCTION = `These examples demonstrate the expected QUALITY LEVEL and DEPTH of observation. Do NOT copy their structure, sentence pattern, or opening style. Each insight must be uniquely shaped by the specific user data and fragments you see. Every insight should feel like it could ONLY be about THIS specific user.`;

export const CONTRASTIVE_INSTRUCTION = `CONTRASTIVE FRAMEWORK — your insight MUST be genuinely NEW relative to past insights:
- COUNTER-EXAMPLE: If a past insight said "X is good", find a case where X fails or the opposite holds.
- INVERSE FRAMING: If a past insight opened with a fact, open with a question/stakes/paradox instead.
- ORTHOGONAL OBSERVATION: If past insights covered domain A∩B, find a completely different angle (historical, ethical, practical, cross-cultural) on the same intersection.
- NOVELTY TEST: Before finalizing, check: "Could this insight be mistaken for a paraphrase of any past insight?" If yes, rewrite.`;

const FEW_SHOT_INSIGHTS = [
  {
    context: "User knows React and Rust. Bridge: WebAssembly",
    chinese: "Rust 编译到 WASM 的性能实测比 JS 快 3-10 倍，但你之前关注的 React 组件库有个完全不同的路线——编译时提取计算到 Worker，不碰 WASM。这对你同时写 Rust 和 React 的场景可能更有启发。",
    english: "Rust-to-WASM benchmarks show 3-10x over JS, but the React lib you follow takes a different approach — compile-time extraction to Workers, no WASM. Might be more relevant for your Rust+React stack.",
  },
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
  webSearch?: (query: string) => Promise<WebSearchResult[]>;
  inferenceDeps?: InterestInferenceDeps;
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
  /** System context injected before the insight prompt (e.g. SOUL.md + IDENTITY.md). */
  systemContext?: string;
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
    inferenceDeps: { complete, prepareModel: async (cfg, modelRef) => {
      const extractionModel = cfg.cognitive?.persona?.extractionModel;
      const modelRefToUse = modelRef ?? extractionModel ?? "zai/glm-5-turbo";
      const [provider, ...modelParts] = modelRefToUse.split("/");
      const modelId = modelParts.join("/") || "glm-5-turbo";
      return prepareSimpleCompletionModel({ cfg, provider, modelId });
    } },
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
  const mode = input.mode ?? "extend";

  if (mode === "pattern") {
    const { prompt, variant } = buildPatternInsightPrompt(persona, input, input.recentInsightContents);
    try {
      const modelRef =
        options?.modelRef ?? config.cognitive?.persona?.extractionModel;
      const prepared = await deps.prepareModel(config, modelRef);

      if ("error" in prepared) {
        log.warn(`LLM model preparation failed: ${prepared.error}, skipping insight`);
        return [];
      }

      const timeoutMs = options?.timeout ?? 20_000;
      const systemPrompt = options?.systemContext || undefined;
      const messages: Array<{ role: "user"; content: string; timestamp: number }> = [];
      messages.push({ role: "user", content: prompt, timestamp: Date.now() });

      const result = await deps.complete(
        prepared.model,
        { messages, systemPrompt },
        {
          apiKey: prepared.auth.apiKey,
          maxTokens: options?.maxTokens ?? 2000,
          temperature: 0.85,
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
        log.warn("LLM returned empty response for pattern mode, skipping insight");
        return [];
      }

      const candidates = parseLLMInsights(text, maxCandidates);
      if (candidates.length === 0) {
        log.warn("LLM response could not be parsed as insights (pattern mode)", { raw: text.slice(0, 300) });
        return [];
      }
      log.info(`Pattern-mode LLM generated ${candidates.length} insight candidate(s)`);

      const recentContents = input.recentInsightContents;
      const filtered = recentContents.length > 0
        ? candidates.filter(c => !isDuplicateBySemanticOverlap(c.content, recentContents, { trigramThreshold: 0.85, contentWordThreshold: 0.5 }))
        : candidates;

      if (filtered.length < candidates.length) {
        log.info("pattern-mode trigram dedup filtered candidates", {
          before: candidates.length,
          after: filtered.length,
        });
      }

      return filtered.map(c => {
        const inputDomains = input.targetDomains;
        const llmDomains = c.targetDomains;
        const hasOverlap = llmDomains.length > 0 && llmDomains.some(d =>
          inputDomains.some(id => id.toLowerCase() === d.toLowerCase()),
        );
        if (!hasOverlap && inputDomains.length > 0) {
          log.info("force-aligned pattern-mode LLM output domains to input targetDomains", {
            llmDomains,
            inputDomains,
          });
          c.targetDomains = [...inputDomains];
        }
        c.promptVariant = variant;
        return c;
      });
    } catch (err) {
      const isTimeout = err instanceof DOMException && err.name === "TimeoutError";
      log.warn(`Pattern-mode LLM insight generation ${isTimeout ? "timed out" : "failed"}: ${String(err)}, skipping insight`);
      return [];
    }
  }

  let webResults: WebSearchResult[] = [];
  let searchStrategy: import("./types.js").SearchStrategy | undefined;
  let queryUsed: string | undefined;

  if (mode === "surprise" && deps.inferenceDeps) {
    const inferenceResult = await inferSearchStrategy(persona, input, config, deps.inferenceDeps);
    if (inferenceResult.ok) {
      searchStrategy = inferenceResult.strategy;
      if (deps.webSearch && searchStrategy.searchQuery) {
        queryUsed = searchStrategy.searchQuery;
        try {
          webResults = await cachedWebSearch(deps.webSearch, searchStrategy.searchQuery);
          log.info("surprise-mode web search completed", { query: searchStrategy.searchQuery, resultCount: webResults.length });
        } catch (err) {
          log.warn("surprise-mode web search failed", { query: searchStrategy.searchQuery, error: String(err) });
        }
      }
    } else {
      log.info("inference failed, falling back to extend mode", { error: inferenceResult.error });
      return generateExtendMode(persona, input, config, deps, options, maxCandidates);
    }
  } else {
    if (deps.webSearch) {
      let query: string | undefined;
      // Try LLM-based query generation for extend mode when inferenceDeps available
      if (deps.inferenceDeps) {
        try {
          const inferenceResult = await inferSearchStrategy(persona, input, config, deps.inferenceDeps, "extend");
          if (inferenceResult.ok && inferenceResult.strategy.searchQuery) {
            query = inferenceResult.strategy.searchQuery;
            log.info("extend-mode LLM query generated", { query });
          }
        } catch (err) {
          log.warn("extend-mode inference failed, falling back to rule-based query", { error: String(err) });
        }
      }
      // Fallback to rule-based query
      if (!query) {
        query = buildSearchQuery(input) || undefined;
      }
      queryUsed = query;
      if (query) {
        try {
          webResults = await cachedWebSearch(deps.webSearch, query);
          log.info("web search completed", { query, resultCount: webResults.length });
        } catch (err) {
          log.warn("web search failed, proceeding without web results", { query, error: String(err) });
          webResults = [];
        }
      } else {
        log.info("web search skipped: empty query");
      }
    } else {
      log.info("web search skipped: no webSearch dep provided");
    }
  }

  const outputLanguage = config.cognitive?.insight?.outputLanguage ?? detectOutputLanguage(persona);

  let webSnippetByDomain: Map<string, string[]> | undefined;
  if (webResults.length > 0) {
    try {
      webSnippetByDomain = await matchWebResultsToDomainsLLM(webResults, persona, config, deps, input.targetDomains);
      log.info("LLM domain matching completed", {
        matchedDomains: [...webSnippetByDomain.keys()],
        totalResults: webResults.length,
      });
    } catch (err) {
      log.warn("LLM domain matching error, will use keyword fallback in prompt builder", { error: String(err) });
    }
  }

  const { prompt, variant } = mode === "surprise" && searchStrategy
    ? buildSurpriseInsightPrompt(persona, input, webResults, input.recentInsightContents, searchStrategy, outputLanguage, webSnippetByDomain)
    : buildInsightPrompt(persona, input, webResults, input.recentInsightContents, webSnippetByDomain);

  try {
    const modelRef =
      options?.modelRef ?? config.cognitive?.persona?.extractionModel;
    const prepared = await deps.prepareModel(config, modelRef);

    if ("error" in prepared) {
      log.warn(`LLM model preparation failed: ${prepared.error}, skipping insight`);
      return [];
    }

    const timeoutMs = options?.timeout ?? 20_000;
    const systemPrompt = options?.systemContext || undefined;
    const messages: Array<{ role: "user"; content: string; timestamp: number }> = [];
    messages.push({ role: "user", content: prompt, timestamp: Date.now() });

    const result = await deps.complete(
      prepared.model,
      { messages, systemPrompt },
      {
        apiKey: prepared.auth.apiKey,
        maxTokens: options?.maxTokens ?? 2000,
        temperature: 0.85,
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
      log.warn("LLM returned empty response, skipping insight");
      return [];
    }

    const candidates = parseLLMInsights(text, maxCandidates);
    if (candidates.length === 0) {
      log.warn("LLM response could not be parsed as insights", { raw: text.slice(0, 300) });
      return [];
    }
    log.info(`LLM generated ${candidates.length} insight candidate(s)`);

    // Trigram dedup: filter candidates too similar to recently delivered insights
    const recentContents = input.recentInsightContents;
    const filtered = recentContents.length > 0
      ? candidates.filter(c => !isDuplicateBySemanticOverlap(c.content, recentContents, { trigramThreshold: 0.85, contentWordThreshold: 0.5 }))
      : candidates;

    if (filtered.length < candidates.length) {
      log.info("trigram dedup filtered candidates", {
        before: candidates.length,
        after: filtered.length,
      });
    }

    return filtered.map((c) => {
      // Force-align targetDomains: LLM often deviates from the requested domains.
      // If LLM output domains share no overlap with input.targetDomains, override
      // with the input domains to prevent domain-overlap dedup from killing the insight.
      const inputDomains = input.targetDomains;
      const llmDomains = c.targetDomains;
      const hasOverlap = llmDomains.length > 0 && llmDomains.some(d =>
        inputDomains.some(id => id.toLowerCase() === d.toLowerCase()),
      );
      if (!hasOverlap && inputDomains.length > 0) {
        log.info("force-aligned LLM output domains to input targetDomains", {
          llmDomains,
          inputDomains,
        });
        c.targetDomains = [...inputDomains];
      }
      const enriched = enrichWithWebSources(c, webResults);
      if (queryUsed) enriched.searchQueryUsed = queryUsed;
      enriched.promptVariant = variant;
      return enriched;
    });
  } catch (err) {
    const isTimeout = err instanceof DOMException && err.name === "TimeoutError";
    log.warn(`LLM insight generation ${isTimeout ? "timed out" : "failed"}: ${String(err)}, skipping insight`);
    return [];
  }
}

async function generateExtendMode(
  persona: PersonaTree,
  input: InsightEngineInput,
  config: KaijiBotConfig,
  deps: LlmInsightDeps,
  options: LlmInsightOptions | undefined,
  maxCandidates: number,
): Promise<InsightCandidate[]> {
  const extendInput: InsightEngineInput = { ...input, mode: "extend" };
  return generateInsightCandidatesLLM(persona, extendInput, config, deps, { ...options, maxCandidates });
}

function detectOutputLanguage(persona: PersonaTree): string {
  const lang = persona.identity?.primaryLanguage
    ?? persona.identity?.communicationStyle?.preferredLanguage;
  if (lang === "en") return "en";
  if (lang === "mixed") return "zh";
  return "zh";
}

/**
 * Strip conversational noise from a raw user utterance and keep only
 * the noun-phrases / technical terms that are useful as search keywords.
 *
 * Removes:
 *  - Feishu user-ID prefixes (`ou_xxx:`, `9cc3e...:`)
 *  - Common Chinese conversational fillers / question wrappers
 *  - Leading interrogatives (你能不能, 我能怎么, 为什么 etc.)
 *  - Stray punctuation
 */
export function extractKeyTerms(text: string): string[] {
  let cleaned = text
    .replace(/\bou_[0-9a-f]+\s*:?\s*/g, "")
    .replace(/\b[0-9a-f]{16,}\s*:?\s*/g, "")
    .replace(/^(?:需要我|你能|我能不能|我能怎么|你为什么|是不是|你好[，,]?|请问|能不能|为什么)/, "")
    .replace(/[？?，,。.！!]+$/g, "")
    .replace(/(?:才能|的话|到底|这个|那个|一下|帮我|帮我去)/g, " ")
    .trim();

  if (!cleaned) return [];

  const segments = cleaned
    .split(/[，,？?；;、—–]+|(?:的?时候|之前|之后|还是)/)
    .flatMap((s) => {
      const trimmed = s.trim();
      if (!trimmed) return [];
      if (trimmed.length <= 30 && trimmed.length >= 2) return [trimmed];
      if (trimmed.length > 30) {
        return trimmed.split(/\s+/).filter((w) => w.length >= 2 && w.length <= 30);
      }
      return [];
    });

  return segments;
}

const SUFFIXES = [" 最新进展", " 实践案例", " 最佳实践", " 技术趋势", " 新方向"] as const;

const SEARCH_CACHE_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 100;
const searchCache = new Map<string, { results: WebSearchResult[]; fetchedAt: number }>();

function cachedWebSearch(
  webSearch: (query: string) => Promise<WebSearchResult[]>,
  query: string,
): Promise<WebSearchResult[]> {
  const now = Date.now();
  const cached = searchCache.get(query);
  if (cached && now - cached.fetchedAt < SEARCH_CACHE_TTL_MS) {
    log.info("web search cache hit", { query });
    return Promise.resolve(cached.results);
  }
  if (searchCache.size >= MAX_CACHE_ENTRIES) {
    const staleKeys: string[] = [];
    for (const [k, v] of searchCache) {
      if (now - v.fetchedAt >= SEARCH_CACHE_TTL_MS) staleKeys.push(k);
    }
    if (staleKeys.length > 0) {
      for (const k of staleKeys) searchCache.delete(k);
    } else {
      const firstKey = searchCache.keys().next().value;
      if (firstKey !== undefined) searchCache.delete(firstKey);
    }
  }
  return webSearch(query).then(results => {
    searchCache.set(query, { results, fetchedAt: now });
    return results;
  });
}

export function clearSearchCache(): void {
  searchCache.clear();
}

export function buildSearchQuery(input: InsightEngineInput): string {
  const parts: string[] = [];
  const seen = new Set<string>();

  const historyTerms = new Set<string>();
  const history = input.recentQueryHistory ?? [];
  for (const query of history.slice(-3)) {
    for (const term of extractKeyTerms(query)) {
      historyTerms.add(term.toLowerCase());
    }
    for (const word of query.split(/\s+/)) {
      if (word.length >= 2) historyTerms.add(word.toLowerCase());
    }
  }

  for (const domain of input.targetDomains) {
    const terms = domain.split(/[\/\+\-\s]+/).filter(p => p.length > 0);
    const domainMatchesHistory = terms.length > 0 && terms.every(t => historyTerms.has(t.toLowerCase()));
    if (domainMatchesHistory && input.targetDomains.length > 1) continue;

    for (const term of terms) {
      const lower = term.toLowerCase();
      if (!seen.has(lower)) {
        parts.push(term);
        seen.add(lower);
      }
    }
    if (parts.length >= 3) break;
  }

  if (parts.length < 4 && input.recentFocus.length > 0) {
    for (let fi = 0; fi < input.recentFocus.length && parts.length < 4; fi++) {
      const focusTerms = extractKeyTerms(input.recentFocus[fi]!);
      for (const term of focusTerms) {
        const lower = term.toLowerCase();
        if (!seen.has(lower)) {
          parts.push(term);
          seen.add(lower);
        }
        if (parts.length >= 4) break;
      }
    }
  }

  if (parts.length === 0) return "";

  const suffixIndex = parts.length <= 2
    ? (history.length % SUFFIXES.length)
    : -1;
  const suffix = suffixIndex >= 0 ? SUFFIXES[suffixIndex]! : "";

  const currentYear = new Date().getFullYear().toString();
  const baseQuery = parts.join(" ") + suffix;
  // Only append year if not already present in the query
  const queryWithYear = baseQuery.includes(currentYear)
    ? baseQuery
    : `${baseQuery} ${currentYear}`;
  return queryWithYear.slice(0, 120);
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

export function buildSurpriseInsightPrompt(
  persona: PersonaTree,
  input: InsightEngineInput,
  webResults: WebSearchResult[] = [],
  recentInsightContents: string[] = [],
  strategy: import("./types.js").SearchStrategy,
  outputLanguage: string = "zh",
  webSnippetByDomain?: Map<string, string[]>,
): PromptBuildResult {
  const resolvedWebSnippetByDomain = webSnippetByDomain ?? (() => {
    const keywordMap = buildDomainKeywordMap(persona.domains);
    return matchWebResultsToDomains(webResults, keywordMap);
  })();

  const sortedDomainEntries = Object.entries(persona.domains)
    .sort(([, a], [, b]) => b.lastMentioned - a.lastMentioned);

  const anchorFacts = sortedDomainEntries
    .flatMap(([name, d]) => d.keyInsights.slice(0, 2).map((ki) => `${name}: ${ki}`))
    .slice(0, 6);
  const anchorBlock = anchorFacts.length > 0
    ? anchorFacts.map((f, i) => `${i + 1}. ${f}`).join("\n")
    : "  (not yet established)";

  const externalFacts = buildExternalFactsEntries(resolvedWebSnippetByDomain);
  const externalFactsBlock = externalFacts.length > 0
    ? externalFacts.map((f, i) => `${i + 1}. ${f}`).join("\n")
    : "";

  const userName = persona.identity?.displayName || "";
  const identityBlock = persona.identity
    ? [
        userName ? `Name: ${userName}` : "",
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

  const pastInsightBlock = recentInsightContents.length > 0
    ? recentInsightContents.slice(-5).map((c, i) => `${i + 1}. ${truncate(c, 120)}`).join("\n")
    : "";

  const bannedOpenings = recentInsightContents
    .slice(-5)
    .map((c) => c.trim().slice(0, 8))
    .filter((o) => o.length >= 4);

  const openingBans = bannedOpenings.length > 0
    ? bannedOpenings.map((o) => `不要以"${o}"开头`).join("；")
    : "";

  const langInstruction = outputLanguage === "en"
    ? "Output in English."
    : "用中文输出。";

  const fewShotIdx = input.feedbackProfile
    ? pickPromptVariant(input.feedbackProfile, DIVERSE_FEW_SHOT_SETS.map((_, i) => `fewShot:${i}`))
    : Math.floor(Math.random() * DIVERSE_FEW_SHOT_SETS.length);
  const fewShotBlock = DIVERSE_FEW_SHOT_SETS[fewShotIdx]!
    .examples.map(e => `Context: ${e.context}\n中文: ${e.chinese}\nEnglish: ${e.english}`).join("\n\n");

  return { prompt: `${buildVoiceSection(persona)}

EXAMPLES of ideal insights (match this quality, specificity, and tone):
${fewShotBlock}

${DIVERSITY_INSTRUCTION}

CRITICAL: Output in your own voice — the same personality the user knows from regular conversations. NOT a formal report, NOT a system notification.

You are the AI assistant speaking in your own voice and personality. You are proactively reaching out to share something genuinely SURPRISING — something the user hasn't encountered but would find fascinating.

${identityBlock ? `USER:\n${identityBlock}` : ""}

INFERRED LATENT INTEREST:
  Interest: ${strategy.inferredInterest}
  Bridge: ${strategy.bridgeReasoning}
  Why surprising: This area is adjacent to what the user knows but explores a direction they haven't considered.

SPECIFIC FACTS YOU KNOW ABOUT THIS USER:
${anchorBlock}
 ${externalFactsBlock ? `\nEXTERNAL_FACTS (fresh web findings):\n${externalFactsBlock}` : ""}

${pastInsightBlock ? `\nPAST INSIGHTS (your insight must be CONTRASTIVELY different — see CONTRASTIVE FRAMEWORK below):\n${pastInsightBlock}\n\n${CONTRASTIVE_INSTRUCTION}` : ""}
${recentInsightContents.length > 0 ? `\nRECENTLY USED CONTENT THEMES (DO NOT reuse these concepts even for different domains):\n${extractContentThemes(recentInsightContents).join("、")}` : ""}
${(input.recentInsightDomains?.length ?? 0) > 0 ? `\nRECENTLY COVERED DOMAIN COMBINATIONS (insight MUST explore NEW territory, NOT repeat these):\n${input.recentInsightDomains!.slice(-5).map((domains, i) => `${i + 1}. ${domains.join(" + ")}`).join("\n")}` : ""}

TASK:
Share a specific, surprising insight about "${strategy.inferredInterest}". Bridge from what the user already knows (${strategy.avoidTopics.join(", ")}) to this new territory. The insight should feel like a genuine discovery, not a recommendation or tutorial.

Constraints:
- 1-3 sentences, ${langInstruction}
- Tone: like suddenly remembering something fascinating to tell a friend
- NO question marks, NO lists, NO numbering
- Forbidden phrases: "值得关注", "挺有意思", "不得不说", "你有没有想过", "最近在关注", "有趣的是", "值得注意的是"
- Start with a concrete fact, counter-intuitive observation, or specific case — never with "关于", "在...领域", "结合你", "作为"
- ${openingBans ? `Also do NOT start with: ${openingBans}` : ""}
- Content must be a specific judgment, observation, or discovery — not vague feelings
${webResults.length > 0 ? "- Weave external information naturally, do NOT say 'saw', 'read', 'reportedly'" : ""}

Good surprise insight traits (hit at least one):
- Frontier bridge: connects user's existing knowledge to a genuinely new development
- Unexpected connection: reveals a hidden link the user wouldn't have noticed
- Paradigm shift: challenges an assumption the user likely holds

Respond with ONLY a JSON array (no markdown, no code fences):
IMPORTANT: In the "content" field, escape any inner quotes as \\" or use Chinese curly quotes (""). Do NOT use unescaped ASCII quotes inside string values.
[
  {
    "content": "Your surprising insight in your own voice",
    "rationale": "Why this is surprising and relevant to this user SPECIFICALLY",
    "targetDomains": ["inferred-domain"],
    "sourceDomains": ["user-known-domain"],
    "relevanceScore": 0.8,
    "surpriseScore": 0.7
  }
]`, variant: { fewShotSet: fewShotIdx, frameIndex: 0 } };
}

/** Extended context for prompt frame generation. */
type PromptFrameExtra = {
  domains: string[];
  keyInsights: string[];
  recentFocus: string[];
  userName: string;
};

function pickRandom<T>(arr: readonly T[]): T | undefined {
  return arr.length > 0 ? arr[Math.floor(Math.random() * arr.length)] : undefined;
}

/** Prompt framework variants — each anchors on specific persona data to avoid generic output. */
const PROMPT_FRAMES = [
  // 0: Extend a known keyInsight
  (topic: string, extra: PromptFrameExtra) => {
    const insight = pickRandom(extra.keyInsights);
    if (insight) {
      return `你了解到用户对"${insight}"有独到理解。从这个具体的认知出发，说出一个被大多数人忽略的延伸方向或实际应用场景。不要解释这个认知本身，直接说延伸的部分。`;
    }
    return `针对${topic}，你有一个具体的观察——不是泛泛的感受，而是能直接指导下一步行动的判断。直接说出来。`;
  },
  // 1: Cross-domain with concrete anchor
  (topic: string, extra: PromptFrameExtra) => {
    if (extra.domains.length >= 2 && extra.keyInsights.length >= 2) {
      return `用户同时在${topic}和${extra.domains[extra.domains.length - 1]!}两个方向有积累。你看到了一条具体的关联线索——不是概念上的相似，而是实际的、可操作的交集。直接把这条线索说出来。`;
    }
    return `在${topic}方向上，用户目前的理解里有一个盲区。你看到了，直接指出来，不要铺垫。`;
  },
  // 2: Concrete change or case related to user's focus
  (topic: string, _extra: PromptFrameExtra) => {
    return `你刚注意到${topic}领域一个具体的变化或案例，直接关系到用户之前提到的关注点。简洁地说出来。`;
  },
  // 3: Challenge assumption using a keyInsight
  (topic: string, extra: PromptFrameExtra) => {
    const insight = pickRandom(extra.keyInsights);
    if (insight) {
      return `基于"${insight}"这个认知，常见的做法里有一个效率或思路上的问题。你有一个更好的替代方案——说出来，说清楚为什么更好。`;
    }
    return `关于${topic}，你有一个来自实践的具体经验，跟大多数人的做法不一样。分享这个经验。`;
  },
  // 4: Practical recommendation tied to recentFocus
  (topic: string, extra: PromptFrameExtra) => {
    const focus = extra.recentFocus.length > 0 ? pickRandom(extra.recentFocus)! : topic;
    return `用户最近在看${focus}相关的东西。你恰好知道一个具体的工具、方法或资源能直接帮上忙。推荐它，说清楚为什么适合现在的阶段。`;
  },
  // 5: Counter-intuitive fact
  (topic: string, extra: PromptFrameExtra) => {
    const insight = pickRandom(extra.keyInsights);
    if (insight) {
      return `关于"${insight}"，有一个反直觉的事实。你把它说出来，用事实本身说话，不要加"有趣的是"之类的评论。`;
    }
    return `在${topic}领域，你发现了一条被低估的技术路径或思路。说出它是什么，以及为什么被低估。`;
  },
  // 6: Hidden connection between topic and recentFocus
  (topic: string, extra: PromptFrameExtra) => {
    if (extra.recentFocus.length >= 1) {
      const focus = extra.recentFocus[Math.min(extra.recentFocus.length - 1, 1)]!;
      return `${topic}和${focus}之间有一条暗线——不是表面的关联，而是底层逻辑或设计理念的共通之处。直接说出这条暗线是什么。`;
    }
    return `你注意到${topic}领域有一个正在发生但还没被广泛讨论的变化。说出它是什么。`;
  },
  // 7: Cross-domain method transfer
  (topic: string, extra: PromptFrameExtra) => {
    if (extra.domains.length >= 2) {
      return `把${extra.domains[extra.domains.length - 1]!}里的一个成熟做法，迁移到${topic}的场景中。说出具体的迁移方案和预期效果。`;
    }
    return `给${topic}方向一个具体的下一步建议——不是方向性的，而是可以直接执行的那种。`;
  },
] as const;

function pickPromptFrame(
  topics: string[],
  domainNames: string[],
  keyInsights: string[],
  recentFocus: string[],
  userName: string,
  feedbackProfile?: InsightEngineInput["feedbackProfile"],
): { text: string; frameIndex: number } {
  const topic = topics.length > 0 ? topics[0]! : "你的兴趣领域";
  const frameIdx = feedbackProfile
    ? pickPromptVariant(feedbackProfile, PROMPT_FRAMES.map((_, i) => `frame:${i}`))
    : Math.floor(Math.random() * PROMPT_FRAMES.length);
  const frame = PROMPT_FRAMES[frameIdx]!;
  return { text: frame(topic, { domains: domainNames, keyInsights, recentFocus, userName }), frameIndex: frameIdx };
}

const STRUCTURE_SEEDS = [
  "这次用一个具体的事实或数据点开头，不要用观点开头。",
  "这次先说结论或判断，再说原因，不要反过来。",
  "这次直接给一个可执行的建议，不要做分析。",
  "这次说一个具体的案例或例子，不要抽象概括。",
  "这次用一个反直觉的陈述开头。",
  "这次提出一个具体的技术选择或方案，说明为什么选它。",
  "这次指出一个常见的误区或错误做法，然后给出正确的方式。",
  "这次说一条暗线——两个看似无关的东西之间的隐藏联系。",
] as const;

function getTimeTag(lastMentioned: number): string {
  const hoursAgo = (Date.now() - lastMentioned) / (60 * 60 * 1000);
  if (hoursAgo < 24) return "active-today";
  if (hoursAgo < 72) return "recent";
  if (hoursAgo < 168) return "this-week";
  return "inactive";
}

function truncate(s: string, maxLen: number): string {
  return s.length > maxLen ? s.slice(0, maxLen) + "…" : s;
}

function buildExternalFactsEntries(webSnippetByDomain: Map<string, string[]>): string[] {
  return [...webSnippetByDomain.entries()]
    .flatMap(([domain, snippets]) => snippets.map((s) => `[${domain}] ${truncate(s, 120)}`))
    .slice(0, 6);
}

function buildDomainKeywordMap(
  domains: Record<string, import("../types.js").DomainNode>,
): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const [name, domain] of Object.entries(domains)) {
    const keywords = new Set<string>();
    keywords.add(name.toLowerCase());
    // Split compound names: "AI/机器学习" → "ai", "机器学习"
    for (const part of name.split(/[\/\+]/)) {
      const trimmed = part.trim().toLowerCase();
      if (trimmed.length >= 2) keywords.add(trimmed);
    }
    for (const insight of domain.keyInsights.slice(0, 3)) {
      const lower = insight.toLowerCase();
      keywords.add(lower);
      for (const word of lower.split(/\s+/)) {
        if (word.length >= 3) keywords.add(word);
      }
    }
    map.set(name, keywords);
  }
  return map;
}

function extractBigrams(text: string): Set<string> {
  const bigrams = new Set<string>();
  const normalized = text.toLowerCase().replace(/\s+/g, "");
  for (let i = 0; i < normalized.length - 1; i++) {
    bigrams.add(normalized.slice(i, i + 2));
  }
  return bigrams;
}

function matchWebResultsToDomains(
  webResults: WebSearchResult[],
  keywordMap: Map<string, Set<string>>,
): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const r of webResults) {
    const titleLower = r.title.toLowerCase();
    const snippetLower = r.snippet.toLowerCase();
    for (const [domainName, keywords] of keywordMap) {
      const matched = [...keywords].some((kw) => {
        if (titleLower.includes(kw) || snippetLower.includes(kw)) return true;
        // Bigram similarity for fuzzy matching
        if (kw.length >= 4) {
          const kwBigrams = extractBigrams(kw);
          const textBigrams = extractBigrams(titleLower + " " + snippetLower);
          const overlap = [...kwBigrams].filter(b => textBigrams.has(b)).length;
          const similarity = overlap / Math.max(kwBigrams.size, 1);
          return similarity > 0.7;
        }
        return false;
      });
      if (matched) {
        const list = result.get(domainName) ?? [];
        list.push(r.snippet);
        result.set(domainName, list);
      }
    }
  }
  return result;
}

/**
 * LLM-based domain matching for web search results.
 *
 * Sends web result snippets to the LLM with the user's domain list and
 * asks it to classify each result into the most relevant domain(s).
 * Falls back to keyword/bigram matching (`matchWebResultsToDomains`) on
 * any failure (LLM error, JSON parse error, timeout, model prep failure).
 */
export async function matchWebResultsToDomainsLLM(
  webResults: WebSearchResult[],
  persona: PersonaTree,
  config: KaijiBotConfig,
  deps: LlmInsightDeps,
  extraTargetDomains: string[] = [],
): Promise<Map<string, string[]>> {
  if (webResults.length === 0) return new Map();

  const domainEntries: Array<{ name: string; hints: string[] }> = [];
  const seen = new Set<string>();
  for (const [name, domain] of Object.entries(persona.domains)) {
    if (!seen.has(name)) {
      seen.add(name);
      domainEntries.push({
        name,
        hints: domain.keyInsights.slice(0, 2),
      });
    }
  }
  for (const td of extraTargetDomains) {
    if (!seen.has(td)) {
      seen.add(td);
      domainEntries.push({ name: td, hints: [] });
    }
  }

  const domainLines = domainEntries
    .map((d) => {
      const hint = d.hints.length > 0 ? `: ${d.hints.join(", ")}` : "";
      return `- ${d.name}${hint}`;
    })
    .join("\n");

  const resultLines = webResults
    .map((r, i) => `${i + 1}. [${r.title}] ${r.snippet}`)
    .join("\n");

  const prompt = `Classify each web search result into the most relevant user domain(s).

User domains (with known interests):
${domainLines}

Web results:
${resultLines}

For each result number, list which domain(s) it relates to. Use JSON format:
{"1": ["typescript"], "2": ["rust", "wasm"], ...}
If a result doesn't match any domain, skip it. Respond with ONLY the JSON object.`;

  try {
    const modelRef = config.cognitive?.persona?.extractionModel;
    const prepared = await deps.prepareModel(config, modelRef);
    if ("error" in prepared) {
      throw new Error(prepared.error);
    }

    const result = await deps.complete(
      prepared.model,
      { messages: [{ role: "user", content: prompt, timestamp: Date.now() }] },
      {
        apiKey: prepared.auth.apiKey,
        maxTokens: 500,
        temperature: 0.2,
        signal: AbortSignal.timeout(10_000),
      },
    );

    const text = result.content
      .filter((block): block is { type: "text"; text: string } => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();

    if (!text) {
      throw new Error("LLM returned empty response for domain classification");
    }

    const objStart = text.indexOf("{");
    const objEnd = text.lastIndexOf("}");
    if (objStart === -1 || objEnd === -1 || objEnd <= objStart) {
      throw new Error("No JSON object found in LLM domain classification response");
    }

    const jsonStr = text.slice(objStart, objEnd + 1);
    const parsed: Record<string, string[]> = JSON.parse(jsonStr);

    const domainMap = new Map<string, string[]>();
    for (const [idxStr, domains] of Object.entries(parsed)) {
      const idx = Number(idxStr) - 1;
      if (idx < 0 || idx >= webResults.length || !Array.isArray(domains)) continue;
      const snippet = webResults[idx]!.snippet;
      for (const domain of domains) {
        if (typeof domain !== "string") continue;
        const list = domainMap.get(domain) ?? [];
        list.push(snippet);
        domainMap.set(domain, list);
      }
    }

    return domainMap;
  } catch (err) {
    log.warn("LLM domain matching failed, falling back to keyword matching", { error: String(err) });
    const keywordMap = buildDomainKeywordMap(persona.domains);
    for (const td of extraTargetDomains) {
      if (!keywordMap.has(td)) {
        const keywords = new Set<string>();
        keywords.add(td.toLowerCase());
        for (const part of td.split(/[\/\+]/)) {
          const trimmed = part.trim().toLowerCase();
          if (trimmed.length >= 2) keywords.add(trimmed);
        }
        keywordMap.set(td, keywords);
      }
    }
    return matchWebResultsToDomains(webResults, keywordMap);
  }
}

const PATTERN_PROMPT_FRAMES = [
  (_topic: string, _extra: PromptFrameExtra) =>
    "You notice a recurring thinking pattern across the user's conversations — describe what it is, when it helps, and when it becomes a limitation.",
  (_topic: string, _extra: PromptFrameExtra) =>
    "The user has an implicit priority or value ranking visible across their decisions — name it and explain what it costs them.",
  (_topic: string, _extra: PromptFrameExtra) =>
    "There's a contradiction between what the user says they want and what they actually do — point it out directly.",
  (_topic: string, _extra: PromptFrameExtra) =>
    "There's a perspective or approach the user never considers — name it and explain why they're missing it.",
] as const;

export function buildPatternInsightPrompt(
  persona: PersonaTree,
  input: InsightEngineInput,
  recentInsightContents: string[],
): PromptBuildResult {
  const fewShotIdx = input.feedbackProfile
    ? pickPromptVariant(input.feedbackProfile, DIVERSE_FEW_SHOT_SETS.map((_, i) => `fewShot:${i}`))
    : Math.floor(Math.random() * DIVERSE_FEW_SHOT_SETS.length);
  const fewShotBlock = DIVERSE_FEW_SHOT_SETS[fewShotIdx]!
    .examples.map(e => `Context: ${e.context}\n中文: ${e.chinese}\nEnglish: ${e.english}`)
    .join("\n\n");

  const fragments = input.fragments ?? [];
  const sortedFragments = [...fragments]
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 8);
  const fragmentBlock = sortedFragments.length > 0
    ? sortedFragments
      .map(f => `[${f.kind}] ${f.structuralTag}: "${truncate(f.evidence, 120)}" (strength: ${f.strength.toFixed(2)}, domains: ${f.domains.join(", ")})`)
      .join("\n")
    : "(no fragments collected yet)";

  const sortedDomainEntries = Object.entries(persona.domains)
    .sort(([, a], [, b]) => b.lastMentioned - a.lastMentioned);

  const anchorFacts = sortedDomainEntries
    .flatMap(([name, d]) => d.keyInsights.slice(0, 2).map((ki) => `${name}: ${ki}`))
    .slice(0, 6);
  const anchorBlock = anchorFacts.length > 0
    ? anchorFacts.map((f, i) => `${i + 1}. ${f}`).join("\n")
    : "  (not yet established)";

  const pastInsightBlock = recentInsightContents.length > 0
    ? recentInsightContents.slice(-5).map((c, i) => `${i + 1}. ${truncate(c, 120)}`).join("\n")
    : "";

  const bannedOpenings = recentInsightContents
    .slice(-5)
    .map((c) => c.trim().slice(0, 8))
    .filter((o) => o.length >= 4);

  const openingBans = bannedOpenings.length > 0
    ? bannedOpenings.map((o) => `不要以"${o}"开头`).join("；")
    : "";

  const patternFrameIdx = input.feedbackProfile
    ? pickPromptVariant(input.feedbackProfile, PATTERN_PROMPT_FRAMES.map((_, i) => `pattern:${i}`))
    : Math.floor(Math.random() * PATTERN_PROMPT_FRAMES.length);
  const frame = PATTERN_PROMPT_FRAMES[patternFrameIdx]!;
  const taskInstruction = frame(input.targetDomains.join(", "), { domains: input.targetDomains, keyInsights: anchorFacts, recentFocus: input.recentFocus, userName: persona.identity?.displayName ?? "" });

  return { prompt: `${buildVoiceSection(persona)}

EXAMPLES of ideal behavioral observations (match this quality, specificity, and depth):
${fewShotBlock}

${DIVERSITY_INSTRUCTION}

CRITICAL: Output in your own voice — the same personality the user knows from regular conversations. NOT a formal report, NOT a system notification, NOT a therapy session.

You are the AI assistant speaking in your own voice and personality. You are proactively sharing a behavioral observation — something you noticed about how this user thinks, decides, or acts across their conversations.

OBSERVED THINKING PATTERNS (from recent conversations):
${fragmentBlock}

SPECIFIC FACTS YOU KNOW ABOUT THIS USER:
${anchorBlock}
 ${pastInsightBlock ? `\nPAST INSIGHTS (your insight must be CONTRASTIVELY different — see CONTRASTIVE FRAMEWORK below):\n${pastInsightBlock}\n\n${CONTRASTIVE_INSTRUCTION}` : ""}
${recentInsightContents.length > 0 ? `\nRECENTLY USED CONTENT THEMES (DO NOT reuse these concepts):\n${extractContentThemes(recentInsightContents).join("、")}` : ""}

TASK:
${taskInstruction}

Constraints:
- 1-3 sentences, Chinese
- No question marks, no lists, no numbering
- Forbidden phrases: "值得关注", "挺有意思", "不得不说", "你有没有想过", "最近在关注", "有趣的是", "值得注意的是"
- Start with a concrete observation — never with "关于", "在...领域", "结合你", "作为"
- ${openingBans ? `Also do NOT start with: ${openingBans}` : ""}
- Do NOT mention "patterns", "blind spots", "cognitive biases", or use meta-analytical language. Speak as a friend sharing an observation, not as a therapist diagnosing.
- Content must reference AT LEAST ONE specific fragment from the OBSERVED THINKING PATTERNS section above
- Content must be a specific, honest observation — not vague encouragement or generic advice

Respond with ONLY a JSON array (no markdown, no code fences):
重要提示：在 "content" 字段中，请用 \\" 转义内部引号，或使用中文弯引号（""）。不要在字符串值中使用未转义的 ASCII 引号。
[
  {
    "content": "Your behavioral observation in your own voice, in Chinese",
    "rationale": "Which fragments and persona data led to this observation",
    "targetDomains": ["domain-from-fragments"],
    "sourceDomains": ["observed-pattern"],
    "relevanceScore": 0.8,
    "surpriseScore": 0.7
  }
]

Keep insights concise (1-3 sentences). Quality over quantity.`, variant: { fewShotSet: fewShotIdx, frameIndex: 0, patternFrame: patternFrameIdx } };
}

export function buildInsightPrompt(
  persona: PersonaTree,
  input: InsightEngineInput,
  webResults: WebSearchResult[] = [],
  recentInsightContents: string[] = [],
  webSnippetByDomain?: Map<string, string[]>,
): PromptBuildResult {
  let resolvedWebSnippetByDomain: Map<string, string[]>;
  if (webSnippetByDomain) {
    resolvedWebSnippetByDomain = webSnippetByDomain;
  } else {
    const keywordMap = buildDomainKeywordMap(persona.domains);
    for (const td of input.targetDomains) {
      if (!keywordMap.has(td)) {
        const keywords = new Set<string>();
        keywords.add(td.toLowerCase());
        for (const part of td.split(/[\/\+]/)) {
          const trimmed = part.trim().toLowerCase();
          if (trimmed.length >= 2) keywords.add(trimmed);
        }
        keywordMap.set(td, keywords);
      }
    }
    resolvedWebSnippetByDomain = matchWebResultsToDomains(webResults, keywordMap);
  }
  if (webResults.length > 0) {
    const matchedDomains = [...resolvedWebSnippetByDomain.keys()];
    const matchedUrls = new Set<string>();
    for (const result of webResults) {
      for (const snippets of resolvedWebSnippetByDomain.values()) {
        if (snippets.some(s => s === result.snippet)) {
          matchedUrls.add(result.url);
          break;
        }
      }
    }
    const unmatched = webResults.length - matchedUrls.size;
    log.info("web search domain matching", {
      totalResults: webResults.length,
      matchedDomains,
      unmatchedSnippets: unmatched,
    });
  }

  const sortedDomainEntries = Object.entries(persona.domains)
    .sort(([, a], [, b]) => b.lastMentioned - a.lastMentioned);

  const userDomains = sortedDomainEntries
    .slice(0, 8)
    .map(([name, d]) => {
      const recencyTag = getTimeTag(d.lastMentioned);
      const parts: string[] = [`${name} [${recencyTag}, depth: ${d.depth}]`];
      if (d.keyInsights.length > 0) {
        parts.push(`known: ${d.keyInsights.slice(0, 3).join("; ")}`);
      }
      return parts.join(" | ");
    })
    .join("\n");

  const anchorFacts = sortedDomainEntries
    .flatMap(([name, d]) => d.keyInsights.slice(0, 2).map((ki) => `${name}: ${ki}`))
    .slice(0, 6);
  const anchorBlock = anchorFacts.length > 0
    ? anchorFacts.map((f, i) => `${i + 1}. ${f}`).join("\n")
    : "  (not yet established)";

  const externalFacts = buildExternalFactsEntries(resolvedWebSnippetByDomain);
  const externalFactsBlock = externalFacts.length > 0
    ? externalFacts.map((f, i) => `${i + 1}. ${f}`).join("\n")
    : "";

  const recentFocus = persona.recentFocus.slice(0, 5).join(", ");
  const recentInsightIds = input.recentInsightIds.slice(0, 5).join(", ");

  const userName = persona.identity?.displayName || "";
  const identityBlock = persona.identity
    ? [
        userName ? `Name: ${userName}` : "",
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

  const pastInsightBlock = recentInsightContents.length > 0
    ? recentInsightContents.slice(-5).map((c, i) => `${i + 1}. ${truncate(c, 120)}`).join("\n")
    : "";

  const bannedOpenings = recentInsightContents
    .slice(-5)
    .map((c) => c.trim().slice(0, 8))
    .filter((o) => o.length >= 4);

  const coOccurrenceBlock = persona.domainGraph && persona.domainGraph.edges.length > 0
    ? persona.domainGraph.edges
        .filter(e => e.observations >= 3)
        .sort((a, b) => b.observations - a.observations)
        .slice(0, 5)
        .map(e => `${e.source} ↔ ${e.target} (${e.observations}次共现)`)
        .join("\n")
    : "";

  const domainNames = sortedDomainEntries.map(([name]) => name);
  const flatKeyInsights = sortedDomainEntries.flatMap(([, d]) => d.keyInsights.slice(0, 2));
  const { text: promptFrame, frameIndex } = pickPromptFrame(
    input.targetDomains, domainNames,
    flatKeyInsights, persona.recentFocus, userName,
    input.feedbackProfile,
  );

  const structureSeedIdx = input.feedbackProfile
    ? pickPromptVariant(input.feedbackProfile, STRUCTURE_SEEDS.map((_, i) => `seed:${i}`))
    : Math.floor(Math.random() * STRUCTURE_SEEDS.length);
  const structureSeed = STRUCTURE_SEEDS[structureSeedIdx]!;
  const openingBans = bannedOpenings.length > 0
    ? bannedOpenings.map((o) => `不要以"${o}"开头`).join("；")
    : "";

  const fewShotIdx = input.feedbackProfile
    ? pickPromptVariant(input.feedbackProfile, DIVERSE_FEW_SHOT_SETS.map((_, i) => `fewShot:${i}`))
    : Math.floor(Math.random() * DIVERSE_FEW_SHOT_SETS.length);
  const fewShotBlock = DIVERSE_FEW_SHOT_SETS[fewShotIdx]!
    .examples.map(e => `Context: ${e.context}\n中文: ${e.chinese}\nEnglish: ${e.english}`).join("\n\n");

  return { prompt: `${buildVoiceSection(persona)}

EXAMPLES of ideal insights (match this quality, specificity, and tone):
${fewShotBlock}

${DIVERSITY_INSTRUCTION}

CRITICAL: Output in your own voice — the same personality the user knows from regular conversations. NOT a formal report, NOT a system notification.

You are the AI assistant speaking in your own voice and personality. You are proactively reaching out to share something that crossed your mind — genuinely useful or surprising for THIS specific user.

${identityBlock ? `USER:\n${identityBlock}` : ""}

USER'S DOMAINS (sorted by recency — most active first):
${userDomains || "Not yet established"}
 ${coOccurrenceBlock ? `\nCROSS-DOMAIN CONNECTIONS:\n${coOccurrenceBlock}` : ""}

SPECIFIC FACTS YOU KNOW ABOUT THIS USER (your insight MUST reference at least one):
${anchorBlock}
${externalFactsBlock ? `\nEXTERNAL_FACTS (recent web findings relevant to user's domains):\n${externalFactsBlock}\n\nIMPORTANT: If EXTERNAL_FACTS contains information relevant to the user's focus areas, prioritize building the insight around those external facts rather than recombining known keyInsights.` : ""}

 Recent focus: ${recentFocus || "None"}
  Trust: ${persona.rapport.trustScore.toFixed(2)} / 1.0
  Delivered insight IDs: ${recentInsightIds || "None"}
${pastInsightBlock ? `\nPAST INSIGHTS (your insight must be CONTRASTIVELY different — see CONTRASTIVE FRAMEWORK below):\n${pastInsightBlock}\n\n${CONTRASTIVE_INSTRUCTION}` : ""}
${recentInsightContents.length > 0 ? `\nRECENTLY USED CONTENT THEMES (DO NOT reuse these concepts even for different domains):\n${extractContentThemes(recentInsightContents).join("、")}` : ""}
${(input.recentInsightDomains?.length ?? 0) > 0 ? `\nRECENTLY COVERED DOMAIN COMBINATIONS (insight MUST explore NEW territory, NOT repeat these domain angles):\n${input.recentInsightDomains!.slice(-5).map((domains, i) => `${i + 1}. ${domains.join(" + ")}`).join("\n")}` : ""}

  TARGET DOMAINS (insight MUST be about these domains):
${input.targetDomains.join(", ")}

 TASK:
${promptFrame}

 STRUCTURE CONSTRAINT:
${structureSeed}

 硬性要求（必须全部满足，否则拒绝输出）：
- 洞察内容必须围绕上面的"TARGET DOMAINS"展开，targetDomains字段必须包含这些域中的至少一个
- 必须引用上面"SPECIFIC FACTS"列表中的至少一条具体事实——不能只提领域名称，要说出用户在这个领域的具体认知或关注点
- 1-3句话，中文，语气像突然想到什么要跟朋友说
- 不用问号结尾，不用列表或编号
- 禁止以下句式：
  · "值得关注"、"挺有意思"、"不得不说"
  · "你有没有想过"、"最近在关注"
  · "有趣的是"、"值得注意的是"
${openingBans ? `  · ${openingBans}` : ""}
- 内容必须是一个具体的判断、观察或建议，不是泛泛的感受
${webResults.length > 0 ? "- 外部信息自然融入内容里，不要说'看到'、'读到'、'据说'" : ""}

 好的洞察（满足至少一条）：
 - 跨域连接：把用户不同兴趣领域的具体知识关联起来
 - 实用建议：给一个明确的、可直接执行的行动方向
 - 反常识观点：挑战一个可能的错误认知，用事实反驳

Respond with ONLY a JSON array (no markdown, no code fences):
重要提示：在 "content" 字段中，请用 \\" 转义内部引号，或使用中文弯引号（""）。不要在字符串值中使用未转义的 ASCII 引号。
[
  {
    "content": "Your insight in your own voice, in Chinese",
    "rationale": "Why this is relevant to this user SPECIFICALLY (reference persona data)",
    "targetDomains": ["${input.targetDomains[0] ?? "domain1"}"],
    "sourceDomains": ["domain2"],
    "relevanceScore": 0.8,
    "surpriseScore": 0.6
  }
]
CRITICAL: targetDomains MUST include at least one of: ${input.targetDomains.join(", ")}. Do NOT substitute other domains.

Keep insights concise (1-3 sentences). Quality over quantity.`, variant: { fewShotSet: fewShotIdx, frameIndex, structureSeed: structureSeedIdx } };
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

    let jsonStr = extractJsonArray(cleaned);
    if (!jsonStr) {
      log.warn("parseLLMInsights: no JSON array found in LLM response", { raw: cleaned.slice(0, 200) });
      return [];
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      const repaired = repairJsonArray(jsonStr);
      try {
        parsed = JSON.parse(repaired);
      } catch {
        // Tier 3: aggressive ASCII quote repair for unescaped inner quotes
        const aggressivelyRepaired = aggressiveAsciiQuoteRepair(repaired);
        try {
          parsed = JSON.parse(aggressivelyRepaired);
        } catch (repairErr) {
          log.warn("parseLLMInsights: JSON repair failed", { error: String(repairErr), raw: jsonStr.slice(0, 200) });
          return [];
        }
      }
    }

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
        compositeScore: (clamp01(Number(item.relevanceScore ?? 0.5)) + clamp01(Number(item.surpriseScore ?? 0.5))) / 2,
        sources: [],
        verificationStatus: "unverified" as const,
        source: "v1" as const,
      }))
      .filter((c: InsightCandidate) => c.content.length > 0 && isSubstantiveContent(c.content));
  } catch (err) {
    log.warn("parseLLMInsights: unexpected error", { error: String(err) });
    return [];
  }
}

function extractJsonArray(text: string): string | null {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}

function repairJsonArray(raw: string): string {
  let s = raw;

  // Normalize Chinese curly quotes inside string values before any bracket fixing.
  // GLM models tend to emit \u201c/\u201d inside JSON strings, which breaks JSON.parse.
  {
    let inStr = false;
    let esc = false;
    let normalized = "";
    for (let i = 0; i < s.length; i++) {
      const ch = s[i]!;
      if (esc) { normalized += ch; esc = false; continue; }
      if (ch === "\\") { normalized += ch; esc = true; continue; }
      if (ch === '"') { inStr = !inStr; normalized += ch; continue; }
      if (inStr && (ch === "\u201c" || ch === "\u201d")) {
        normalized += '"';
        continue;
      }
      normalized += ch;
    }
    s = normalized;
  }

  s = s.replace(/,\s*([}\]])/g, "$1");
  let openBrackets = 0;
  let openBraces = 0;
  let inString = false;
  let escape = false;
  for (const ch of s) {
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "[") openBrackets++;
    else if (ch === "]") openBrackets--;
    else if (ch === "{") openBraces++;
    else if (ch === "}") openBraces--;
  }
  while (openBraces > 0) { s += "}"; openBraces--; }
  while (openBrackets > 0) { s += "]"; openBrackets--; }
  return s;
}

/**
 * Aggressive repair for unescaped ASCII `"` inside JSON string values.
 * GLM models frequently produce output like:
 *   [{"content": "他说"你好"吗", ...}]
 * where the inner `"你好"` breaks JSON.parse.
 *
 * Strategy: character-by-character state machine that tracks whether we're
 * inside a JSON string. When inside a string and encountering an unescaped `"`,
 * we look ahead to decide if it's a structural quote (end-of-string) or an
 * inner quote that needs escaping.
 */
function aggressiveAsciiQuoteRepair(raw: string): string {
  let result = "";
  let i = 0;
  let inStr = false;
  let esc = false;

  while (i < raw.length) {
    const ch = raw[i]!;

    if (esc) {
      result += ch;
      esc = false;
      i++;
      continue;
    }

    if (ch === "\\") {
      result += ch;
      esc = true;
      i++;
      continue;
    }

    if (ch === '"') {
      if (!inStr) {
        inStr = true;
        result += ch;
        i++;
        continue;
      }

      if (isStructuralQuote(raw, i)) {
        inStr = false;
        result += ch;
      } else {
        result += '\\"';
      }
      i++;
      continue;
    }
    result += ch;
    i++;
  }

  return result;
}

/**
 * Determine if the `"` at position `pos` in `raw` is a structural quote
 * (i.e., terminates a JSON string value) rather than an inner quote.
 *
 * A `"` is structural if the next non-whitespace character is one of:
 * `,` `}` `]` `:` — indicating the end of a string value in a JSON structure.
 * Also structural if we're at end-of-string or end-of-input.
 */
function isStructuralQuote(raw: string, pos: number): boolean {
  // Look ahead past the quote
  for (let j = pos + 1; j < raw.length; j++) {
    const next = raw[j]!;
    if (next === " " || next === "\t" || next === "\n" || next === "\r") continue;
    // Structural patterns: `,` `}` `]` or `:` (key separator)
    return next === "," || next === "}" || next === "]" || next === ":";
  }
  // End of input — structural (closing string at EOF)
  return true;
}

export const GENERIC_INSIGHT_PATTERNS: ReadonlyArray<RegExp> = [
  /最近出现了?一些值得关注的新方向/,
  /结合你在这个领域的深度理解/,
  /可能会影响你的技术决策/,
  /探索未知领域有助于拓展思维边界/,
  /挺有意思的/,
  /值得关注/,
  /^.{0,10}是一个.{2,10}的方向$/,
  /被(人)?.*但(换个角度|它其实|它和)/,
  /你有没有想过/,
  /最近在关注/,
  /不得不说/,
  /其实.*也是$/,
  /背后.*值得/,
  /换个角度来看/,
  /有没有可能/,
  /有趣的是/,
  /值得注意的是/,
  /^关于.{2,6}[，,]/,
  /^在.{2,8}领域/,
  /^作为.{2,8}[，,]/,
  /结合你/,
];

export function isSubstantiveContent(content: string): boolean {
  const trimmed = content.trim();
  if (trimmed.length < 10) return false;
  for (const pattern of GENERIC_INSIGHT_PATTERNS) {
    if (pattern.test(trimmed)) return false;
  }
  return true;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

const PERSONA_WORKSPACE_FILES = ["SOUL.md", "IDENTITY.md", "USER.md"] as const;

export async function loadWorkspacePersonaContext(
  workspaceDir?: string,
): Promise<string> {
  const dir = workspaceDir ?? path.join(os.homedir(), ".kaijibot", "workspace");
  const parts: string[] = [];
  for (const filename of PERSONA_WORKSPACE_FILES) {
    try {
      const content = await fs.readFile(path.join(dir, filename), "utf-8");
      const trimmed = content.trim();
      if (trimmed) {
        parts.push(`## ${filename}\n${trimmed}`);
      }
    } catch {
    }
  }
  return parts.join("\n\n");
}

export function buildCritiquePrompt(
  candidate: InsightCandidate,
  persona: PersonaTree,
): string {
  const sortedDomainEntries = Object.entries(persona.domains)
    .sort(([, a], [, b]) => b.lastMentioned - a.lastMentioned);

  const anchorFacts = sortedDomainEntries
    .flatMap(([name, d]) => d.keyInsights.slice(0, 2).map((ki) => `${name}: ${ki}`))
    .slice(0, 6);
  const anchorBlock = anchorFacts.length > 0
    ? anchorFacts.map((f, i) => `${i + 1}. ${f}`).join("\n")
    : "(not yet established)";

  const userName = persona.identity?.displayName ?? "the user";

  return `You are a strict quality evaluator for AI-generated insights about a user.

USER: ${userName}
EXPERT DOMAINS: ${persona.identity?.expertDomains?.join(", ") ?? "unknown"}
INTEREST DOMAINS: ${persona.identity?.interestDomains?.join(", ") ?? "unknown"}

KNOWN FACTS ABOUT THIS USER:
${anchorBlock}

INSIGHT TO EVALUATE:
---
${candidate.content}
---
Target domains: ${candidate.targetDomains.join(", ")}
Rationale: ${candidate.rationale}
---

Evaluate this insight on 5 dimensions (each 0.0-1.0):

1. SPECIFICITY: Does the insight contain concrete, verifiable claims? Or is it vague platitudes?
2. PERSONA RELEVANCE: Does it reference known facts about THIS user? Or generic advice anyone could receive?
3. ACTIONABILITY: Can the user act on this? Or is it an abstract observation with no next step?
4. SURPRISE: Is this genuinely new information the user likely doesn't know? Or obvious/common knowledge?
5. VOICE MATCH: Does it sound natural for a helpful AI companion? Or stiff/formal/system-notification-like?

Also provide an overallScore (0.0-1.0), a textual critique, and specific improvement suggestions.

Respond with ONLY a JSON object (no markdown, no code fences):
{
  "specificity": 0.0-1.0,
  "personaRelevance": 0.0-1.0,
  "actionability": 0.0-1.0,
  "surprise": 0.0-1.0,
  "voiceMatch": 0.0-1.0,
  "overallScore": 0.0-1.0,
  "critique": "textual feedback explaining the scores",
  "improvementSuggestions": ["specific suggestion 1", "specific suggestion 2"]
}`;
}

export function buildRefinePrompt(
  originalPrompt: string,
  candidate: InsightCandidate,
  critique: LlmCritiqueResult,
  persona: PersonaTree,
): string {
  const suggestions = critique.improvementSuggestions
    .map((s, i) => `${i + 1}. ${s}`)
    .join("\n");

  return `${buildVoiceSection(persona)}

ORIGINAL GENERATION PROMPT:
---
${originalPrompt}
---

ORIGINAL INSIGHT:
---
${candidate.content}
---

CRITIQUE (overall score: ${critique.overallScore.toFixed(2)}/1.0):
${critique.critique}

IMPROVEMENT SUGGESTIONS:
${suggestions}

Generate a REVISED insight that addresses these specific weaknesses. Keep the strengths, fix the problems. The revised insight should feel like it could ONLY be about THIS specific user.

Constraints:
- 1-3 sentences, Chinese
- No question marks, no lists, no numbering
- Forbidden phrases: "值得关注", "挺有意思", "不得不说", "你有没有想过", "最近在关注", "有趣的是", "值得注意的是"
- Start with a concrete fact, observation, or judgment — never with "关于", "在...领域", "结合你", "作为"

Respond with ONLY a JSON array (no markdown, no code fences):
[
  {
    "content": "Your revised insight in your own voice, in Chinese",
    "rationale": "Why this revision is better",
    "targetDomains": ${JSON.stringify(candidate.targetDomains)},
    "sourceDomains": ${JSON.stringify(candidate.sourceDomains)},
    "relevanceScore": 0.8,
    "surpriseScore": 0.7
  }
]`;
}

export async function critiqueInsightWithLLM(
  candidate: InsightCandidate,
  persona: PersonaTree,
  config: KaijiBotConfig,
  deps: LlmInsightDeps,
  options?: LlmInsightOptions,
): Promise<LlmCritiqueResult | null> {
  try {
    const prompt = buildCritiquePrompt(candidate, persona);
    const modelRef = options?.modelRef ?? config.cognitive?.persona?.extractionModel;
    const prepared = await deps.prepareModel(config, modelRef);

    if ("error" in prepared) {
      log.warn("critiqueInsightWithLLM: model preparation failed", { error: prepared.error });
      return null;
    }

    const result = await deps.complete(
      prepared.model,
      { messages: [{ role: "user", content: prompt, timestamp: Date.now() }] },
      {
        apiKey: prepared.auth.apiKey,
        maxTokens: options?.maxTokens ?? 500,
        temperature: 0.3,
        signal: AbortSignal.timeout(options?.timeout ?? 8_000),
      },
    );

    const text = result.content
      .filter((block): block is { type: "text"; text: string } => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();

    if (!text) return null;

    const objStart = text.indexOf("{");
    const objEnd = text.lastIndexOf("}");
    if (objStart === -1 || objEnd === -1 || objEnd <= objStart) return null;

    const parsed: Record<string, unknown> = JSON.parse(text.slice(objStart, objEnd + 1));

    const requiredFields = ["specificity", "personaRelevance", "actionability", "surprise", "voiceMatch", "overallScore", "critique", "improvementSuggestions"];
    for (const field of requiredFields) {
      if (!(field in parsed)) return null;
    }

    const improvementSuggestions = parsed.improvementSuggestions;
    if (!Array.isArray(improvementSuggestions)) return null;

    return {
      specificity: clamp01(Number(parsed.specificity) || 0),
      personaRelevance: clamp01(Number(parsed.personaRelevance) || 0),
      actionability: clamp01(Number(parsed.actionability) || 0),
      surprise: clamp01(Number(parsed.surprise) || 0),
      voiceMatch: clamp01(Number(parsed.voiceMatch) || 0),
      overallScore: clamp01(Number(parsed.overallScore) || 0),
      critique: String(parsed.critique ?? ""),
      improvementSuggestions: improvementSuggestions.map(String),
    };
  } catch (err) {
    log.warn("critiqueInsightWithLLM: failed", { error: String(err) });
    return null;
  }
}

export async function refineInsightWithLLM(
  originalPrompt: string,
  candidate: InsightCandidate,
  critique: LlmCritiqueResult,
  persona: PersonaTree,
  config: KaijiBotConfig,
  deps: LlmInsightDeps,
  options?: LlmInsightOptions,
): Promise<InsightCandidate | null> {
  try {
    const prompt = buildRefinePrompt(originalPrompt, candidate, critique, persona);
    const modelRef = options?.modelRef ?? config.cognitive?.persona?.extractionModel;
    const prepared = await deps.prepareModel(config, modelRef);

    if ("error" in prepared) {
      log.warn("refineInsightWithLLM: model preparation failed", { error: prepared.error });
      return null;
    }

    const result = await deps.complete(
      prepared.model,
      { messages: [{ role: "user", content: prompt, timestamp: Date.now() }] },
      {
        apiKey: prepared.auth.apiKey,
        maxTokens: options?.maxTokens ?? 500,
        temperature: 0.85,
        signal: AbortSignal.timeout(options?.timeout ?? 8_000),
      },
    );

    const text = result.content
      .filter((block): block is { type: "text"; text: string } => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();

    if (!text) return null;

    const candidates = parseLLMInsights(text, 1);
    if (candidates.length === 0) return null;

    const refined = candidates[0]!;
    return {
      ...refined,
      id: candidate.id,
      targetDomains: candidate.targetDomains,
      sources: candidate.sources,
      promptVariant: candidate.promptVariant,
    };
  } catch (err) {
    log.warn("refineInsightWithLLM: failed", { error: String(err) });
    return null;
  }
}

export function buildVerificationPrompt(
  candidate: InsightCandidate,
  persona: PersonaTree,
): string {
  const sortedDomainEntries = Object.entries(persona.domains)
    .sort(([, a], [, b]) => b.lastMentioned - a.lastMentioned);

  const anchorFacts = sortedDomainEntries
    .flatMap(([name, d]) => d.keyInsights.slice(0, 2).map((ki) => `${name}: ${ki}`))
    .slice(0, 6);
  const anchorBlock = anchorFacts.length > 0
    ? anchorFacts.map((f, i) => `${i + 1}. ${f}`).join("\n")
    : "(not yet established)";

  const sourceBlock = candidate.sources.length > 0
    ? candidate.sources.map((s, i) => `${i + 1}. [${s.title}](${s.url}) (credibility: ${s.credibility})`).join("\n")
    : "(no sources)";

  const userName = persona.identity?.displayName ?? "the user";

  return `You are a quality gate judge for AI-generated proactive insights.

USER: ${userName}
EXPERT DOMAINS: ${persona.identity?.expertDomains?.join(", ") ?? "unknown"}
INTEREST DOMAINS: ${persona.identity?.interestDomains?.join(", ") ?? "unknown"}

KNOWN FACTS:
${anchorBlock}

INSIGHT TO VERIFY:
---
${candidate.content}
---
Target domains: ${candidate.targetDomains.join(", ")}
Rationale: ${candidate.rationale}

SOURCES:
${sourceBlock}
---

Evaluate: Is this insight worth delivering to the user?

Criteria for each status:
- "verified": High quality — specific, relevant to THIS user, actionable, consistent with sources
- "partial": Decent quality but missing some elements — still acceptable for delivery
- "unverified": Generic, vague, or not relevant enough to this specific user
- "contradicted": Contains factual errors or contradicts known information about the user

Respond with ONLY a JSON object (no markdown, no code fences):
{
  "approved": true/false,
  "confidence": 0.0-1.0,
  "status": "verified" | "partial" | "unverified" | "contradicted",
  "notes": "Brief explanation of the verdict"
}`;
}

export async function verifyInsightWithLLM(
  candidate: InsightCandidate,
  persona: PersonaTree,
  config: KaijiBotConfig,
  deps: LlmInsightDeps,
  options?: LlmInsightOptions,
): Promise<VerificationResult> {
  const unverified: VerificationResult = {
    status: "unverified",
    sources: candidate.sources,
    confidence: 0,
    notes: "Verification unavailable",
  };

  try {
    const prompt = buildVerificationPrompt(candidate, persona);
    const modelRef = options?.modelRef ?? config.cognitive?.persona?.extractionModel;
    const prepared = await deps.prepareModel(config, modelRef);

    if ("error" in prepared) {
      log.warn("verifyInsightWithLLM: model preparation failed", { error: prepared.error });
      return unverified;
    }

    const result = await deps.complete(
      prepared.model,
      { messages: [{ role: "user", content: prompt, timestamp: Date.now() }] },
      {
        apiKey: prepared.auth.apiKey,
        maxTokens: options?.maxTokens ?? 300,
        temperature: 0.2,
        signal: AbortSignal.timeout(options?.timeout ?? 8_000),
      },
    );

    const text = result.content
      .filter((block): block is { type: "text"; text: string } => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();

    if (!text) return unverified;

    const objStart = text.indexOf("{");
    const objEnd = text.lastIndexOf("}");
    if (objStart === -1 || objEnd === -1 || objEnd <= objStart) return unverified;

    const parsed: Record<string, unknown> = JSON.parse(text.slice(objStart, objEnd + 1));

    const confidence = clamp01(Number(parsed.confidence) || 0);
    const llmStatus = String(parsed.status ?? "");

    let status: VerificationResult["status"];
    if (llmStatus === "contradicted") {
      status = "contradicted";
    } else if (confidence >= 0.7) {
      status = "verified";
    } else if (confidence >= 0.4) {
      status = "partial";
    } else {
      status = "unverified";
    }

    return {
      status,
      sources: candidate.sources,
      confidence,
      notes: String(parsed.notes ?? ""),
    };
  } catch (err) {
    log.warn("verifyInsightWithLLM: failed", { error: String(err) });
    return unverified;
  }
}

// ---------------------------------------------------------------------------
// Semantic freshness check (LLM-based novelty detection)
// ---------------------------------------------------------------------------

function buildFreshnessPrompt(
  candidate: InsightCandidate,
  recentInsightContents: string[],
): string {
  const MAX_PER_INSIGHT = 120;
  const shown = recentInsightContents.slice(0, 5);

  const pastBlock = shown
    .map((text, i) => `${i + 1}. ${text.length > MAX_PER_INSIGHT ? text.slice(0, MAX_PER_INSIGHT) : text}`)
    .join("\n");

  return `SYSTEM: You are a semantic novelty evaluator. Your job is to determine if a new insight says something genuinely new compared to past insights.

NEW INSIGHT:
${candidate.content}

PAST INSIGHTS (last ${shown.length}):
${pastBlock}

Is this new insight semantically equivalent to or a paraphrase of any past insight? Or does it say something genuinely new?

Respond ONLY with valid JSON:
{ "isNovel": boolean, "similarityToClosest": 0-1, "reason": string }

Criteria:
- isNovel = true: the insight covers genuinely different ground, introduces a new angle, or connects ideas in a way not seen in past insights.
- isNovel = false: the insight is semantically the same as a past insight even if worded differently. Paraphrases, restatements, and near-duplicates should be marked as not novel.
- similarityToClosest: 0 = completely different topic, 1 = essentially the same insight.
- reason: one concise sentence explaining your decision.`;
}

const FRESHNESS_FALLBACK = { isNovel: true, reason: "LLM freshness check unavailable" } as const;

export async function checkSemanticNoveltyWithLLM(
  candidate: InsightCandidate,
  recentInsightContents: string[],
  config: KaijiBotConfig,
  deps: LlmInsightDeps,
  options?: LlmInsightOptions,
): Promise<{ isNovel: boolean; reason: string }> {
  if (recentInsightContents.length < 2) {
    return { isNovel: true, reason: "Insufficient history for comparison" };
  }

  try {
    const prompt = buildFreshnessPrompt(candidate, recentInsightContents);
    const modelRef = options?.modelRef ?? config.cognitive?.persona?.extractionModel;
    const prepared = await deps.prepareModel(config, modelRef);

    if ("error" in prepared) {
      log.warn("checkSemanticNoveltyWithLLM: model preparation failed", { error: prepared.error });
      return { isNovel: true, reason: "LLM freshness check unavailable" };
    }

    const result = await deps.complete(
      prepared.model,
      { messages: [{ role: "user", content: prompt, timestamp: Date.now() }] },
      {
        apiKey: prepared.auth.apiKey,
        maxTokens: options?.maxTokens ?? 200,
        temperature: 0.2,
        signal: AbortSignal.timeout(options?.timeout ?? 6_000),
      },
    );

    const text = result.content
      .filter((block): block is { type: "text"; text: string } => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();

    if (!text) return { isNovel: true, reason: "LLM freshness check unavailable" };

    const objStart = text.indexOf("{");
    const objEnd = text.lastIndexOf("}");
    if (objStart === -1 || objEnd === -1 || objEnd <= objStart) {
      return { isNovel: true, reason: "LLM freshness check unavailable" };
    }

    const parsed: Record<string, unknown> = JSON.parse(text.slice(objStart, objEnd + 1));

    if (typeof parsed.isNovel !== "boolean" || typeof parsed.reason !== "string") {
      return { isNovel: true, reason: "LLM freshness check unavailable" };
    }

    return { isNovel: parsed.isNovel, reason: parsed.reason };
  } catch (err) {
    log.warn("checkSemanticNoveltyWithLLM: failed", { error: String(err) });
    return { isNovel: true, reason: "LLM freshness check unavailable" };
  }
}
