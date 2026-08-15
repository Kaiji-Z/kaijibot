import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { complete, type Api, type Model } from "@earendil-works/pi-ai";
import { resolveAgentWorkspaceDir } from "../../agents/agent-scope.js";
import { resolveSoulPreset } from "../../agents/bootstrap-files.js";
import { DEFAULT_MODEL } from "../../agents/defaults.js";
import type { ResolvedProviderAuth } from "../../agents/model-auth.js";
import { resolveDefaultModelForAgent } from "../../agents/model-selection.js";
import { prepareSimpleCompletionModel } from "../../agents/simple-completion-runtime.js";
import { loadSoulPresetContent } from "../../agents/soul-preset.js";
import type { KaijiBotConfig } from "../../config/config.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import {
  DEFAULT_COGNITIVE_LOCALE,
  detectCognitiveLocale,
  L,
  pickLocalized,
  type CognitiveLocale,
  type LocalizableString,
} from "../cognitive-locale.js";
import { pickPromptVariant } from "../feedback/preference-learner.js";
import type { DomainNode, InsightCategory, PersonaTree } from "../types.js";
import { isDuplicateBySemanticOverlap, extractContentThemes } from "./content-similarity.js";
import {
  CONTRASTIVE_INSTRUCTION,
  diversityInstructionFor,
  DIVERSE_FEW_SHOT_SETS,
  selectEmotionalStance,
} from "./llm-engine-data.js";

export { CONTRASTIVE_INSTRUCTION };
import type { Fragment } from "./fragment-types.js";
import { inferSearchStrategy, type InterestInferenceDeps } from "./interest-inference.js";
import type {
  InsightCandidate,
  InsightEngineInput,
  LlmCritiqueResult,
  PromptBuildResult,
  VerificationResult,
} from "./types.js";

const log = createSubsystemLogger("cognitive/insight-llm");

const EXCLUDED_INSIGHT_CATEGORIES: ReadonlySet<InsightCategory> = new Set(["ephemeral"]);

export function getFilteredInsights(
  domain: DomainNode,
  exclude: ReadonlySet<InsightCategory> = EXCLUDED_INSIGHT_CATEGORIES,
): string[] {
  if (domain.insights && domain.insights.length > 0) {
    return domain.insights
      .filter((i) => !exclude.has(i.category))
      .toSorted((a, b) => b.confidence * b.evidenceCount - a.confidence * a.evidenceCount)
      .map((i) => i.text);
  }
  return domain.keyInsights;
}

const SEARCH_PROVIDER_DOMAINS = new Set([
  "exa.ai",
  "tavily.com",
  "search.brave.com",
  "api.exa.ai",
  "api.tavily.com",
]);

function isSearchProviderUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return (
      SEARCH_PROVIDER_DOMAINS.has(host) ||
      [...SEARCH_PROVIDER_DOMAINS].some((d) => host.endsWith(`.${d}`) || host === d)
    );
  } catch {
    return false;
  }
}

const FRAGMENT_KINDS_FOR_PROMPT: ReadonlySet<string> = new Set([
  "knowledge_gap",
  "assumption",
  "implicit_priority",
]);

type RhetoricalMove = "事实开头" | "提问式" | "悖论式" | "推荐式" | "类比式" | "观察式";

function classifyRhetoricalMove(text: string): RhetoricalMove {
  const t = text.trim();
  if (/(是否|难道|有没有|会不会)/.test(t.slice(0, 20))) {
    return "提问式";
  }
  if (/(其实|但.*实际上|表面上.*实际上|看似.*实则)/.test(t.slice(0, 30))) {
    return "悖论式";
  }
  if (/(建议|推荐|试试|用.*做|直接用)/.test(t.slice(0, 30))) {
    return "推荐式";
  }
  if (/(就像|好比|类似于|跟.*一样|本质上.*就是)/.test(t.slice(0, 30))) {
    return "类比式";
  }
  if (/^(你|你的)/.test(t)) {
    return "观察式";
  }
  return "事实开头";
}

function buildBannedOpeningsSection(recentInsightContents: string[]): string {
  if (recentInsightContents.length === 0) {
    return "";
  }

  const charBans = recentInsightContents
    .slice(-5)
    .map((c) => c.trim().slice(0, 8))
    .filter((o) => o.length >= 4)
    .map((o) => `不要以"${o}"开头`)
    .join("；");

  const moves = [...new Set(recentInsightContents.slice(-5).map(classifyRhetoricalMove))];
  const moveBans = moves.length > 0 ? `不要使用以下修辞手法作为开头：${moves.join("、")}` : "";

  return [charBans, moveBans].filter(Boolean).join("\n");
}

function buildFragmentSection(fragments: Fragment[]): string {
  const relevant = fragments.filter((f) => FRAGMENT_KINDS_FOR_PROMPT.has(f.kind));
  if (relevant.length === 0) {
    return "";
  }
  return [...relevant]
    .toSorted((a, b) => b.strength - a.strength)
    .slice(0, 6)
    .map((f) => `- [${f.kind}] ${f.evidence}`)
    .join("\n");
}

export function buildVoiceSection(_persona: PersonaTree): string {
  return "";
}

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
  ) => Promise<{ model: Model<Api>; auth: ResolvedProviderAuth } | { error: string }>;
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
      const explicit = modelRef ?? extractionModel;
      if (explicit) {
        const [provider, ...modelParts] = explicit.split("/");
        const modelId = modelParts.join("/") || DEFAULT_MODEL;
        return prepareSimpleCompletionModel({ cfg, provider, modelId });
      }
      const resolved = resolveDefaultModelForAgent({ cfg });
      return prepareSimpleCompletionModel({
        cfg,
        provider: resolved.provider,
        modelId: resolved.model,
      });
    },
    inferenceDeps: {
      complete,
      prepareModel: async (cfg, modelRef) => {
        const extractionModel = cfg.cognitive?.persona?.extractionModel;
        const explicit = modelRef ?? extractionModel;
        if (explicit) {
          const [provider, ...modelParts] = explicit.split("/");
          const modelId = modelParts.join("/") || DEFAULT_MODEL;
          return prepareSimpleCompletionModel({ cfg, provider, modelId });
        }
        const resolved = resolveDefaultModelForAgent({ cfg });
        return prepareSimpleCompletionModel({
          cfg,
          provider: resolved.provider,
          modelId: resolved.model,
        });
      },
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
  const mode = input.mode ?? "extend";
  const outputLanguage = config.cognitive?.insight?.outputLanguage ?? detectOutputLanguage(persona);
  const locale: CognitiveLocale = outputLanguage === "en" ? "en" : DEFAULT_COGNITIVE_LOCALE;

  if (mode === "pattern") {
    const { prompt, variant } = buildPatternInsightPrompt(
      persona,
      input,
      input.recentInsightContents,
      locale,
      input.soulContent,
      input.identityContext,
    );
    try {
      const modelRef = options?.modelRef ?? config.cognitive?.persona?.extractionModel;
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
        .filter((block): block is { type: "text"; text: string } => block.type === "text")
        .map((block) => block.text)
        .join("")
        .trim();

      if (!text) {
        log.warn("LLM returned empty response for pattern mode, skipping insight");
        return [];
      }

      const candidates = parseLLMInsights(text, maxCandidates);
      if (candidates.length === 0) {
        log.warn("LLM response could not be parsed as insights (pattern mode)", {
          raw: text.slice(0, 300),
        });
        return [];
      }
      log.info(`Pattern-mode LLM generated ${candidates.length} insight candidate(s)`);

      const recentContents = input.recentInsightContents;
      const filtered =
        recentContents.length > 0
          ? candidates.filter(
              (c) =>
                !isDuplicateBySemanticOverlap(c.content, recentContents, {
                  trigramThreshold: 0.85,
                  contentWordThreshold: 0.5,
                }),
            )
          : candidates;

      if (filtered.length < candidates.length) {
        log.info("pattern-mode trigram dedup filtered candidates", {
          before: candidates.length,
          after: filtered.length,
        });
      }

      return filtered.map((c) => {
        const inputDomains = input.targetDomains;
        const llmDomains = c.targetDomains;
        const hasOverlap = llmDomains.some((d) =>
          inputDomains.some((id) => id.toLowerCase() === d.toLowerCase()),
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
      log.warn(
        `Pattern-mode LLM insight generation ${isTimeout ? "timed out" : "failed"}: ${String(err)}, skipping insight`,
      );
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
          const raw = await cachedWebSearch(deps.webSearch, searchStrategy.searchQuery);
          webResults = raw.filter((r) => !isSearchProviderUrl(r.url));
          log.info("surprise-mode web search completed", {
            query: searchStrategy.searchQuery,
            resultCount: webResults.length,
          });
        } catch (err) {
          log.warn("surprise-mode web search failed", {
            query: searchStrategy.searchQuery,
            error: String(err),
          });
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
          const inferenceResult = await inferSearchStrategy(
            persona,
            input,
            config,
            deps.inferenceDeps,
            "extend",
          );
          if (inferenceResult.ok && inferenceResult.strategy.searchQuery) {
            query = inferenceResult.strategy.searchQuery;
            log.info("extend-mode LLM query generated", { query });
          }
        } catch (err) {
          log.warn("extend-mode inference failed, falling back to rule-based query", {
            error: String(err),
          });
        }
      }
      // Fallback to rule-based query
      if (!query) {
        query = buildSearchQuery(input) || undefined;
      }
      queryUsed = query;
      if (query) {
        try {
          const raw = await cachedWebSearch(deps.webSearch, query);
          webResults = raw.filter((r) => !isSearchProviderUrl(r.url));
          log.info("web search completed", { query, resultCount: webResults.length });
        } catch (err) {
          log.warn("web search failed, proceeding without web results", {
            query,
            error: String(err),
          });
          webResults = [];
        }
      } else {
        log.info("web search skipped: empty query");
      }
    } else {
      log.info("web search skipped: no webSearch dep provided");
    }
  }

  let webSnippetByDomain: Map<string, string[]> | undefined;
  if (webResults.length > 0) {
    const keywordMap = buildDomainKeywordMap(persona.domains);
    for (const td of input.targetDomains) {
      if (!keywordMap.has(td)) {
        const keywords = new Set<string>();
        keywords.add(td.toLowerCase());
        for (const part of td.split(/[/+]/)) {
          const trimmed = part.trim().toLowerCase();
          if (trimmed.length >= 2) {
            keywords.add(trimmed);
          }
        }
        keywordMap.set(td, keywords);
      }
    }
    webSnippetByDomain = matchWebResultsToDomains(webResults, keywordMap);
  }

  const { prompt, variant } =
    mode === "surprise" && searchStrategy
      ? buildSurpriseInsightPrompt(
          persona,
          input,
          webResults,
          input.recentInsightContents,
          searchStrategy,
          outputLanguage,
          webSnippetByDomain,
          input.soulContent,
          input.identityContext,
        )
      : buildInsightPrompt(
          persona,
          input,
          webResults,
          input.recentInsightContents,
          locale,
          webSnippetByDomain,
          input.soulContent,
          input.identityContext,
        );

  try {
    const modelRef = options?.modelRef ?? config.cognitive?.persona?.extractionModel;
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
      .filter((block): block is { type: "text"; text: string } => block.type === "text")
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
    const filtered =
      recentContents.length > 0
        ? candidates.filter(
            (c) =>
              !isDuplicateBySemanticOverlap(c.content, recentContents, {
                trigramThreshold: 0.85,
                contentWordThreshold: 0.5,
              }),
          )
        : candidates;

    if (filtered.length < candidates.length) {
      log.info("trigram dedup filtered candidates", {
        before: candidates.length,
        after: filtered.length,
      });
    }

    return filtered
      .map((c) => {
        // Force-align targetDomains: LLM often deviates from the requested domains.
        // If LLM output domains share no overlap with input.targetDomains, override
        // with the input domains to prevent domain-overlap dedup from killing the insight.
        const inputDomains = input.targetDomains;
        const llmDomains = c.targetDomains;
        const hasOverlap = llmDomains.some((d) =>
          inputDomains.some((id) => id.toLowerCase() === d.toLowerCase()),
        );
        if (!hasOverlap && inputDomains.length > 0) {
          log.info("force-aligned LLM output domains to input targetDomains", {
            llmDomains,
            inputDomains,
          });
          c.targetDomains = [...inputDomains];
        }
        const enriched = resolveCitedSources(c, webResults);
        if (queryUsed) {
          enriched.searchQueryUsed = queryUsed;
        }
        enriched.promptVariant = variant;
        if (looksLikeImperativeInjection(enriched.content)) {
          log.warn("rejected insight candidate: matched imperative-injection pattern", {
            contentPreview: enriched.content.slice(0, 120),
          });
          return null;
        }
        return enriched;
      })
      .filter((c: InsightCandidate | null): c is InsightCandidate => c !== null);
  } catch (err) {
    const isTimeout = err instanceof DOMException && err.name === "TimeoutError";
    log.warn(
      `LLM insight generation ${isTimeout ? "timed out" : "failed"}: ${String(err)}, skipping insight`,
    );
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
  return generateInsightCandidatesLLM(persona, extendInput, config, deps, {
    ...options,
    maxCandidates,
  });
}

function detectOutputLanguage(persona: PersonaTree): string {
  return detectCognitiveLocale(persona);
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

  if (!cleaned) {
    return [];
  }

  const segments = cleaned.split(/[，,？?；;、—–]+|(?:的?时候|之前|之后|还是)/).flatMap((s) => {
    const trimmed = s.trim();
    if (!trimmed) {
      return [];
    }
    if (trimmed.length <= 30 && trimmed.length >= 2) {
      return [trimmed];
    }
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
      if (now - v.fetchedAt >= SEARCH_CACHE_TTL_MS) {
        staleKeys.push(k);
      }
    }
    if (staleKeys.length > 0) {
      for (const k of staleKeys) {
        searchCache.delete(k);
      }
    } else {
      const firstKey = searchCache.keys().next().value;
      if (firstKey !== undefined) {
        searchCache.delete(firstKey);
      }
    }
  }
  return webSearch(query).then((results) => {
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
      if (word.length >= 2) {
        historyTerms.add(word.toLowerCase());
      }
    }
  }

  for (const domain of input.targetDomains) {
    const terms = domain.split(/[/+\-\s]+/).filter((p) => p.length > 0);
    const domainMatchesHistory =
      terms.length > 0 && terms.every((t) => historyTerms.has(t.toLowerCase()));
    if (domainMatchesHistory && input.targetDomains.length > 1) {
      continue;
    }

    for (const term of terms) {
      const lower = term.toLowerCase();
      if (!seen.has(lower)) {
        parts.push(term);
        seen.add(lower);
      }
    }
    if (parts.length >= 3) {
      break;
    }
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
        if (parts.length >= 4) {
          break;
        }
      }
    }
  }

  if (parts.length === 0) {
    return "";
  }

  const suffixIndex = parts.length <= 2 ? history.length % SUFFIXES.length : -1;
  const suffix = suffixIndex >= 0 ? SUFFIXES[suffixIndex]! : "";

  const currentYear = new Date().getFullYear().toString();
  const baseQuery = parts.join(" ") + suffix;
  // Only append year if not already present in the query
  const queryWithYear = baseQuery.includes(currentYear) ? baseQuery : `${baseQuery} ${currentYear}`;
  return queryWithYear.slice(0, 120);
}

function resolveCitedSources(
  candidate: InsightCandidate,
  webResults: WebSearchResult[],
): InsightCandidate {
  const indices = candidate.citedSourceIndices ?? [];
  if (webResults.length === 0 || indices.length === 0) {
    return candidate;
  }
  const validIndices = indices.filter((i) => i >= 0 && i < webResults.length);
  if (validIndices.length === 0) {
    return candidate;
  }
  const citedSources = validIndices.map((i) => ({
    url: webResults[i]!.url,
    title: webResults[i]!.title,
    credibility: computeSourceCredibility(candidate.content, webResults[i]!.snippet),
  }));
  return { ...candidate, sources: citedSources };
}

function computeSourceCredibility(insightContent: string, snippet: string): number {
  const tokens = insightContent
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 2);
  const snippetTokens = new Set(
    snippet
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 2),
  );
  if (tokens.length === 0 || snippetTokens.size === 0) {
    return 0.3;
  }
  const overlap = tokens.filter((t) => snippetTokens.has(t)).length;
  const jaccard = overlap / (tokens.length + snippetTokens.size - overlap);
  if (jaccard < 0.15) {
    return 0.3;
  }
  return Math.min(0.5 + jaccard, 0.9);
}

export function buildSurpriseInsightPrompt(
  persona: PersonaTree,
  input: InsightEngineInput,
  webResults: WebSearchResult[] = [],
  recentInsightContents: string[] = [],
  strategy: import("./types.js").SearchStrategy,
  outputLanguage: string = "zh",
  webSnippetByDomain?: Map<string, string[]>,
  soulContent?: string,
  identityContext?: string,
): PromptBuildResult {
  void webSnippetByDomain;
  const locale: CognitiveLocale = outputLanguage === "en" ? "en" : DEFAULT_COGNITIVE_LOCALE;
  const sortedDomainEntries = Object.entries(persona.domains).toSorted(
    ([, a], [, b]) => b.lastMentioned - a.lastMentioned,
  );

  const anchorFacts = sortedDomainEntries
    .flatMap(([name, d]) =>
      getFilteredInsights(d)
        .slice(0, 2)
        .map((ki) => `${name}: ${ki}`),
    )
    .slice(0, 6);
  const anchorBlock =
    anchorFacts.length > 0
      ? anchorFacts.map((f, i) => `${i + 1}. ${f}`).join("\n")
      : "  (not yet established)";

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

  const pastInsightBlock =
    recentInsightContents.length > 0
      ? recentInsightContents
          .slice(-5)
          .map((c, i) => `${i + 1}. ${truncate(c, 120)}`)
          .join("\n")
      : "";

  const bannedSection = buildBannedOpeningsSection(recentInsightContents);

  const langInstruction = outputLanguage === "en" ? "Output in English." : "用中文输出。";

  const fewShotIdx = input.feedbackProfile
    ? pickPromptVariant(
        input.feedbackProfile,
        DIVERSE_FEW_SHOT_SETS.map((_, i) => `fewShot:${i}`),
      )
    : Math.floor(Math.random() * DIVERSE_FEW_SHOT_SETS.length);
  const fewShotBlock = DIVERSE_FEW_SHOT_SETS[fewShotIdx]!.examples.map(
    (e) => `Context: ${e.context}\n中文: ${e.chinese}\nEnglish: ${e.english}`,
  ).join("\n\n");

  const stance = selectEmotionalStance(fewShotIdx, input.recentEmotionalStances, locale);
  const indexedWebFindings = buildIndexedWebFindings(webResults);

  return {
    prompt: `${identityContext ? `${identityContext}\n` : ""}

EXAMPLES of ideal insights (match this quality and specificity):
${fewShotBlock}

${diversityInstructionFor(locale)}

${
  indexedWebFindings
    ? `RECENT WEB FINDINGS (PRIMARY material — pick ONE and connect it to THIS user):
${indexedWebFindings}`
    : ""
}

${identityBlock ? `USER:\n${identityBlock}` : ""}

INFERRED LATENT INTEREST:
  Interest: ${strategy.inferredInterest}
  Bridge: ${strategy.bridgeReasoning}
  Why surprising: This area is adjacent to what the user knows but explores a direction they haven't considered.

SPECIFIC FACTS YOU KNOW ABOUT THIS USER:
${anchorBlock}

${pastInsightBlock ? `\nPAST INSIGHTS (your insight must be CONTRASTIVELY different — see CONTRASTIVE FRAMEWORK below):\n${pastInsightBlock}\n\n${CONTRASTIVE_INSTRUCTION}` : ""}
${recentInsightContents.length > 0 ? `\nRECENTLY USED CONTENT THEMES (DO NOT reuse these concepts even for different domains):\n${extractContentThemes(recentInsightContents).join("、")}` : ""}
${
  (input.recentInsightDomains?.length ?? 0) > 0
    ? `\nRECENTLY COVERED DOMAIN COMBINATIONS (insight MUST explore NEW territory, NOT repeat these):\n${input
        .recentInsightDomains!.slice(-5)
        .map((domains, i) => `${i + 1}. ${domains.join(" + ")}`)
        .join("\n")}`
    : ""
}

YOUR TASK: Generate a proactive insight that connects to ${userName}'s specific interests. The insight will be relayed by a conversational agent, so focus on substance — concrete facts, connections, and recommendations.

PERSONALIZATION TEST: The insight MUST reference at least one specific fact from the "SPECIFIC FACTS YOU KNOW ABOUT THIS USER" section above. Generic insights that could apply to anyone will be rejected.

Constraints:
- 1-3 sentences, ${langInstruction}
- Questions, lists, and varied structures are ALLOWED when they serve the insight
- Forbidden phrases: "值得关注", "挺有意思", "不得不说", "你有没有想过", "最近在关注", "有趣的是", "值得注意的是"
- Start with a concrete fact, counter-intuitive observation, or specific case — never with "关于", "在...领域", "结合你", "作为"
- ${bannedSection}
${webResults.length > 0 ? `- You MAY naturally reference the source (e.g., "according to [0]", "看到[2]提到")` : ""}

Good surprise insight traits (hit at least one):
- Frontier bridge: connects user's existing knowledge to a genuinely new development
- Unexpected connection: reveals a hidden link the user wouldn't have noticed
- Paradigm shift: challenges an assumption the user likely holds

Respond with ONLY a JSON array (no markdown, no code fences):
IMPORTANT: In the "content" field, escape any inner quotes as \\" or use Chinese curly quotes (""). Do NOT use unescaped ASCII quotes inside string values.
[
  {
    "content": "Your insight",
    "rationale": "Why this is relevant to this user SPECIFICALLY",
    "targetDomains": ["inferred-domain"],
    "sourceDomains": ["user-known-domain"],
    "relevanceScore": 0.8,
    "surpriseScore": 0.7,
    "sourceIndices": [0],
    "webGroundedness": 0.7
  }
]`,
    variant: { fewShotSet: fewShotIdx, frameIndex: 0, emotionalStance: stance.index },
  };
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

type PromptFrameFn = (topic: string, extra: PromptFrameExtra, locale: CognitiveLocale) => string;

/** Prompt framework variants — each anchors on specific persona data to avoid generic output. */
const PROMPT_FRAMES: readonly PromptFrameFn[] = [
  // 0: Extend a known keyInsight
  (topic, extra, locale) => {
    const insight = pickRandom(extra.keyInsights);
    if (insight) {
      return pickLocalized(
        L(
          `你了解到用户对"${insight}"有独到理解。从这个具体的认知出发，说出一个被大多数人忽略的延伸方向或实际应用场景。不要解释这个认知本身，直接说延伸的部分。`,
          `You know the user has a unique understanding of "${insight}". Starting from this specific insight, state an extension direction or practical application scenario that most people overlook. Don't explain the insight itself — go straight to the extension.`,
        ),
        locale,
      );
    }
    return pickLocalized(
      L(
        `针对${topic}，你有一个具体的观察，能直接指导下一步行动。直接说出来。`,
        `For ${topic}, you have a specific observation that can directly guide the next action. State it directly.`,
      ),
      locale,
    );
  },
  // 1: Cross-domain with concrete anchor
  (topic, extra, locale) => {
    if (extra.domains.length >= 2 && extra.keyInsights.length >= 2) {
      const otherDomain = extra.domains[extra.domains.length - 1]!;
      return pickLocalized(
        L(
          `用户同时在${topic}和${otherDomain}两个方向有积累。你看到了一条具体的关联线索，实际的、可操作的交集。直接把这条线索说出来。`,
          `The user has built depth in both ${topic} and ${otherDomain}. You see a specific connecting thread — a practical, actionable intersection. State the thread directly.`,
        ),
        locale,
      );
    }
    return pickLocalized(
      L(
        `在${topic}方向上，用户目前的理解里有一个盲区。你看到了，直接指出来，不要铺垫。`,
        `In the ${topic} direction, the user's current understanding has a blind spot. You see it — point it out directly without preamble.`,
      ),
      locale,
    );
  },
  // 2: Concrete change or case related to user's focus
  (topic, _extra, locale) => {
    return pickLocalized(
      L(
        `你刚注意到${topic}领域一个具体的变化或案例，直接关系到用户之前提到的关注点。简洁地说出来。`,
        `You just noticed a specific change or case in the ${topic} field, directly relevant to what the user mentioned caring about. State it concisely.`,
      ),
      locale,
    );
  },
  // 3: Challenge assumption using a keyInsight
  (topic, extra, locale) => {
    const insight = pickRandom(extra.keyInsights);
    if (insight) {
      return pickLocalized(
        L(
          `基于"${insight}"这个认知，常见的做法里有一个效率或思路上的问题。你有一个更好的替代方案——说出来，说清楚为什么更好。`,
          `Based on the insight "${insight}", there's an efficiency or reasoning problem in the common approach. You have a better alternative — state it and explain why it's better.`,
        ),
        locale,
      );
    }
    return pickLocalized(
      L(
        `关于${topic}，你有一个来自实践的具体经验，跟大多数人的做法不一样。分享这个经验。`,
        `Regarding ${topic}, you have a specific experience from practice that differs from what most people do. Share it.`,
      ),
      locale,
    );
  },
  // 4: Practical recommendation tied to recentFocus
  (topic, extra, locale) => {
    const focus = extra.recentFocus.length > 0 ? pickRandom(extra.recentFocus)! : topic;
    return pickLocalized(
      L(
        `用户最近在看${focus}相关的东西。你恰好知道一个具体的工具、方法或资源能直接帮上忙。推荐它，说清楚为什么适合现在的阶段。`,
        `The user has been looking at ${focus}-related things recently. You happen to know a specific tool, method, or resource that can directly help. Recommend it and explain why it fits their current stage.`,
      ),
      locale,
    );
  },
  // 5: Counter-intuitive fact
  (topic, extra, locale) => {
    const insight = pickRandom(extra.keyInsights);
    if (insight) {
      return pickLocalized(
        L(
          `关于"${insight}"，有一个反直觉的事实。你把它说出来，用事实本身说话，不要加"有趣的是"之类的评论。`,
          `About "${insight}", there's a counter-intuitive fact. State it and let the fact speak for itself — don't add "interestingly" or similar commentary.`,
        ),
        locale,
      );
    }
    return pickLocalized(
      L(
        `在${topic}领域，你发现了一条被低估的技术路径或思路。说出它是什么，以及为什么被低估。`,
        `In the ${topic} field, you've found an underappreciated technical path or idea. State what it is and why it's underappreciated.`,
      ),
      locale,
    );
  },
  // 6: Hidden connection between topic and recentFocus
  (topic, extra, locale) => {
    if (extra.recentFocus.length >= 1) {
      const focus = extra.recentFocus[Math.min(extra.recentFocus.length - 1, 1)]!;
      return pickLocalized(
        L(
          `${topic}和${focus}之间有一条暗线，具体的工程方案或技术选型上有共通之处。直接说出这条暗线是什么。`,
          `There's a hidden thread between ${topic} and ${focus} — a concrete commonality in engineering approach or technology choice. State this thread directly.`,
        ),
        locale,
      );
    }
    return pickLocalized(
      L(
        `你注意到${topic}领域有一个正在发生但还没被广泛讨论的变化。说出它是什么。`,
        `You've noticed a change happening in the ${topic} field that isn't widely discussed yet. State what it is.`,
      ),
      locale,
    );
  },
  // 7: Cross-domain method transfer
  (topic, extra, locale) => {
    if (extra.domains.length >= 2) {
      const otherDomain = extra.domains[extra.domains.length - 1]!;
      return pickLocalized(
        L(
          `把${otherDomain}里的一个成熟做法，迁移到${topic}的场景中。说出具体的迁移方案和预期效果。`,
          `Take a mature practice from ${otherDomain} and transfer it to the ${topic} context. State the specific transfer plan and expected effect.`,
        ),
        locale,
      );
    }
    return pickLocalized(
      L(
        `给${topic}方向一个具体的、可以直接执行的下一步建议。`,
        `Give a specific, directly actionable next-step suggestion for the ${topic} direction.`,
      ),
      locale,
    );
  },
];

function pickPromptFrame(
  topics: string[],
  domainNames: string[],
  keyInsights: string[],
  recentFocus: string[],
  userName: string,
  feedbackProfile: InsightEngineInput["feedbackProfile"] | undefined,
  locale: CognitiveLocale = DEFAULT_COGNITIVE_LOCALE,
): { text: string; frameIndex: number } {
  const defaultTopic = pickLocalized(L("你的兴趣领域", "your area of interest"), locale);
  const topic = topics.length > 0 ? topics[0]! : defaultTopic;
  const frameIdx = feedbackProfile
    ? pickPromptVariant(
        feedbackProfile,
        PROMPT_FRAMES.map((_, i) => `frame:${i}`),
      )
    : Math.floor(Math.random() * PROMPT_FRAMES.length);
  const frame = PROMPT_FRAMES[frameIdx]!;
  return {
    text: frame(topic, { domains: domainNames, keyInsights, recentFocus, userName }, locale),
    frameIndex: frameIdx,
  };
}

const STRUCTURE_SEEDS: readonly LocalizableString[] = [
  L(
    "这次用一个具体的事实或数据点开头，不要用观点开头。",
    "This time open with a concrete fact or data point, not an opinion.",
  ),
  L(
    "这次先说结论或判断，再说原因，不要反过来。",
    "This time state the conclusion or judgment first, then the reasoning — not the reverse.",
  ),
  L(
    "这次直接给一个可执行的建议，不要做分析。",
    "This time give a directly actionable suggestion, no analysis.",
  ),
  L(
    "这次说一个具体的案例或例子，不要抽象概括。",
    "This time state a concrete case or example, no abstract generalization.",
  ),
  L("这次用一个反直觉的陈述开头。", "This time open with a counter-intuitive statement."),
  L(
    "这次提出一个具体的技术选择或方案，说明为什么选它。",
    "This time propose a specific technology choice or approach, and explain why you picked it.",
  ),
  L(
    "这次指出一个常见的误区或错误做法，然后给出正确的方式。",
    "This time point out a common misconception or wrong practice, then give the correct approach.",
  ),
  L(
    "这次说一个具体的、可以直接执行的方法或方案。",
    "This time state a specific, directly actionable method or plan.",
  ),
];

function getTimeTag(lastMentioned: number): string {
  const hoursAgo = (Date.now() - lastMentioned) / (60 * 60 * 1000);
  if (hoursAgo < 24) {
    return "active-today";
  }
  if (hoursAgo < 72) {
    return "recent";
  }
  if (hoursAgo < 168) {
    return "this-week";
  }
  return "inactive";
}

function truncate(s: string, maxLen: number): string {
  return s.length > maxLen ? s.slice(0, maxLen) + "…" : s;
}

function buildIndexedWebFindings(webResults: WebSearchResult[]): string {
  if (webResults.length === 0) {
    return "";
  }
  return webResults
    .slice(0, 6)
    .map(
      (r, i) =>
        `[${i}] <untrusted_source url="${r.url}">${escapeUntrustedSource(r.title)} | ${escapeUntrustedSource(truncate(r.snippet, 150))}</untrusted_source>`,
    )
    .join("\n");
}

function escapeUntrustedSource(value: string): string {
  return value.replaceAll(/[<>]/g, (ch) => (ch === "<" ? "&lt;" : "&gt;"));
}

const IMPERATIVE_INJECTION_PATTERNS: ReadonlyArray<RegExp> = [
  /\b(?:send|transfer|wire)\s+(?:money|funds?|crypto)\b/i,
  /\b(?:click|tap|open)\s+(?:the\s+)?(?:link|url|attachment)\s*:/i,
  /\b(?:download|install|run)\s+(?:this\s+)?(?:file|app|program|script)\b/i,
  /\b(?:buy|purchase|order)\s+(?:now|this|it)\b/i,
  /\b(?:visit|go\s+to)\s+https?:\/\//i,
  /\b(?:call|text|email|contact)\s+(?:this\s+)?(?:number|address|phone)\s*:/i,
  /\bshare\s+(?:your|this)\s+(?:api\s+key|password|token|credit\s+card)\b/i,
  // Chinese imperative variants — the primary user base writes insights in
  // Chinese, so English-only patterns leave the whole surface open. The
  // demonstrative or imperative marker is REQUIRED: these patterns gate a
  // drop path, and subject-anchored behavioral observations ("你倾向于立即
  // 购买") must not match — only direct commands to the reader may.
  /(?:转账|汇款|打款)(?:到|至)(?:以下|下列|这个|指定|该)/,
  /(?:请|务必|快|赶紧)(?:立即|马上)?(?:购买|下单|订阅|付款|转账|汇款)/,
  /点击(?:一下)?(?:此|这个|下方|上述|下面的|右边的)(?:链接|网址|按钮|附件)/,
  /(?:下载|安装|运行)(?:此|这个|下列|以下|上述)(?:文件|程序|脚本|软件|应用|附件)/,
  /访问(?:此|以下|下方|上述)(?:网址|链接|页面)\s*[:：]?\s*(?:https?:\/\/|www\.)/,
  /(?:打开|访问|前往)\s*https?:\/\//,
  /(?:拨打|致电|联系|发短信|发邮件)(?:至|到)(?:此|以下|这个|下列)(?:号码|电话|账户|邮箱|地址)/,
  /(?:发给我|告诉我|提供给我|分享给我)(?:你的)?\s*(?:api\s*密钥|密码|令牌|口令|验证码|信用卡|银行卡)/i,
];

export function looksLikeImperativeInjection(text: string): boolean {
  for (const re of IMPERATIVE_INJECTION_PATTERNS) {
    if (re.test(text)) {
      return true;
    }
  }
  return false;
}

function buildDomainKeywordMap(
  domains: Record<string, import("../types.js").DomainNode>,
): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const [name, domain] of Object.entries(domains)) {
    const keywords = new Set<string>();
    keywords.add(name.toLowerCase());
    // Split compound names: "AI/机器学习" → "ai", "机器学习"
    for (const part of name.split(/[/+]/)) {
      const trimmed = part.trim().toLowerCase();
      if (trimmed.length >= 2) {
        keywords.add(trimmed);
      }
    }
    for (const insight of getFilteredInsights(domain).slice(0, 3)) {
      const lower = insight.toLowerCase();
      keywords.add(lower);
      for (const word of lower.split(/\s+/)) {
        if (word.length >= 3) {
          keywords.add(word);
        }
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
        if (titleLower.includes(kw) || snippetLower.includes(kw)) {
          return true;
        }
        // Bigram similarity for fuzzy matching
        if (kw.length >= 4) {
          const kwBigrams = extractBigrams(kw);
          const textBigrams = extractBigrams(titleLower + " " + snippetLower);
          const overlap = [...kwBigrams].filter((b) => textBigrams.has(b)).length;
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
  if (webResults.length === 0) {
    return new Map();
  }

  const domainEntries: Array<{ name: string; hints: string[] }> = [];
  const seen = new Set<string>();
  for (const [name, domain] of Object.entries(persona.domains)) {
    if (!seen.has(name)) {
      seen.add(name);
      domainEntries.push({
        name,
        hints: getFilteredInsights(domain).slice(0, 2),
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

  const resultLines = webResults.map((r, i) => `${i + 1}. [${r.title}] ${r.snippet}`).join("\n");

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
      if (idx < 0 || idx >= webResults.length || !Array.isArray(domains)) {
        continue;
      }
      const snippet = webResults[idx]!.snippet;
      for (const domain of domains) {
        if (typeof domain !== "string") {
          continue;
        }
        const list = domainMap.get(domain) ?? [];
        list.push(snippet);
        domainMap.set(domain, list);
      }
    }

    return domainMap;
  } catch (err) {
    log.warn("LLM domain matching failed, falling back to keyword matching", {
      error: String(err),
    });
    const keywordMap = buildDomainKeywordMap(persona.domains);
    for (const td of extraTargetDomains) {
      if (!keywordMap.has(td)) {
        const keywords = new Set<string>();
        keywords.add(td.toLowerCase());
        for (const part of td.split(/[/+]/)) {
          const trimmed = part.trim().toLowerCase();
          if (trimmed.length >= 2) {
            keywords.add(trimmed);
          }
        }
        keywordMap.set(td, keywords);
      }
    }
    return matchWebResultsToDomains(webResults, keywordMap);
  }
}

const PATTERN_PROMPT_FRAMES = [
  (_topic: string, _extra: PromptFrameExtra) =>
    "Ask the user a direct, provocative question about a recurring pattern you've noticed. The question should make them reflect, not defend.",
  (_topic: string, _extra: PromptFrameExtra) =>
    "Point to one specific instance where the user's default approach produced a measurable outcome. State the outcome, let them draw the conclusion.",
  (_topic: string, _extra: PromptFrameExtra) =>
    "What would change if the user broke this pattern just once? Describe the counterfactual scenario concretely.",
  (_topic: string, _extra: PromptFrameExtra) =>
    "This same thinking pattern shows up in a completely different domain. Name the domain and describe the parallel.",
] as const;

export function buildPatternInsightPrompt(
  persona: PersonaTree,
  input: InsightEngineInput,
  recentInsightContents: string[],
  locale: CognitiveLocale = DEFAULT_COGNITIVE_LOCALE,
  soulContent?: string,
  identityContext?: string,
): PromptBuildResult {
  const fewShotIdx = input.feedbackProfile
    ? pickPromptVariant(
        input.feedbackProfile,
        DIVERSE_FEW_SHOT_SETS.map((_, i) => `fewShot:${i}`),
      )
    : Math.floor(Math.random() * DIVERSE_FEW_SHOT_SETS.length);
  const fewShotBlock = DIVERSE_FEW_SHOT_SETS[fewShotIdx]!.examples.map(
    (e) => `Context: ${e.context}\n中文: ${e.chinese}\nEnglish: ${e.english}`,
  ).join("\n\n");

  const fragments = input.fragments ?? [];
  const sortedFragments = [...fragments].toSorted((a, b) => b.strength - a.strength).slice(0, 8);
  const fragmentBlock =
    sortedFragments.length > 0
      ? sortedFragments
          .map(
            (f) =>
              `[${f.kind}] ${f.structuralTag}: "${truncate(f.evidence, 120)}" (strength: ${f.strength.toFixed(2)}, domains: ${f.domains.join(", ")})`,
          )
          .join("\n")
      : "(no fragments collected yet)";

  const sortedDomainEntries = Object.entries(persona.domains).toSorted(
    ([, a], [, b]) => b.lastMentioned - a.lastMentioned,
  );

  const anchorFacts = sortedDomainEntries
    .flatMap(([name, d]) =>
      getFilteredInsights(d)
        .slice(0, 2)
        .map((ki) => `${name}: ${ki}`),
    )
    .slice(0, 6);
  const anchorBlock =
    anchorFacts.length > 0
      ? anchorFacts.map((f, i) => `${i + 1}. ${f}`).join("\n")
      : "  (not yet established)";

  const pastInsightBlock =
    recentInsightContents.length > 0
      ? recentInsightContents
          .slice(-5)
          .map((c, i) => `${i + 1}. ${truncate(c, 120)}`)
          .join("\n")
      : "";

  const bannedSection = buildBannedOpeningsSection(recentInsightContents);

  const patternUserName = persona.identity?.displayName || "";
  const stance = selectEmotionalStance(fewShotIdx, input.recentEmotionalStances, locale);

  const patternFrameIdx = input.feedbackProfile
    ? pickPromptVariant(
        input.feedbackProfile,
        PATTERN_PROMPT_FRAMES.map((_, i) => `pattern:${i}`),
      )
    : Math.floor(Math.random() * PATTERN_PROMPT_FRAMES.length);
  const frame = PATTERN_PROMPT_FRAMES[patternFrameIdx]!;
  const taskInstruction = frame(input.targetDomains.join(", "), {
    domains: input.targetDomains,
    keyInsights: anchorFacts,
    recentFocus: input.recentFocus,
    userName: patternUserName,
  });

  return {
    prompt: `${identityContext ? `${identityContext}\n` : ""}

EXAMPLES of ideal behavioral observations (match this quality and depth):
${fewShotBlock}

${diversityInstructionFor(locale)}

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
- Questions and varied structures are allowed when they serve the insight
- Forbidden phrases: "值得关注", "挺有意思", "不得不说", "你有没有想过", "最近在关注", "有趣的是", "值得注意的是"
- Start with a concrete observation — never with "关于", "在...领域", "结合你", "作为"
- ${bannedSection}
- Do NOT mention "patterns", "blind spots", "cognitive biases", or use meta-analytical language.
- Content must reference AT LEAST ONE specific fragment from the OBSERVED THINKING PATTERNS section above
- Content must be a specific, honest observation — not vague encouragement or generic advice

Respond with ONLY a JSON array (no markdown, no code fences):
重要提示：在 "content" 字段中，请用 \\" 转义内部引号，或使用中文弯引号（""）。不要在字符串值中使用未转义的 ASCII 引号。
[
  {
    "content": "Your behavioral observation, in Chinese",
    "rationale": "Which fragments and persona data led to this observation",
    "targetDomains": ["domain-from-fragments"],
    "sourceDomains": ["observed-pattern"],
    "relevanceScore": 0.8,
    "surpriseScore": 0.7
  }
]

Keep insights concise (1-3 sentences). Quality over quantity.`,
    variant: {
      fewShotSet: fewShotIdx,
      frameIndex: patternFrameIdx,
      patternFrame: patternFrameIdx,
      emotionalStance: stance.index,
    },
  };
}

export function buildInsightPrompt(
  persona: PersonaTree,
  input: InsightEngineInput,
  webResults: WebSearchResult[] = [],
  recentInsightContents: string[] = [],
  locale: CognitiveLocale = DEFAULT_COGNITIVE_LOCALE,
  webSnippetByDomain?: Map<string, string[]>,
  soulContent?: string,
  identityContext?: string,
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
        for (const part of td.split(/[/+]/)) {
          const trimmed = part.trim().toLowerCase();
          if (trimmed.length >= 2) {
            keywords.add(trimmed);
          }
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
        if (snippets.some((s) => s === result.snippet)) {
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
    if (matchedDomains.length === 0) {
      log.warn(
        "web search domain matching: no domains matched, LLM generation will proceed without domain-grounded evidence",
      );
    }
  }

  const sortedDomainEntries = Object.entries(persona.domains).toSorted(
    ([, a], [, b]) => b.lastMentioned - a.lastMentioned,
  );

  const userDomains = sortedDomainEntries
    .slice(0, 8)
    .map(([name, d]) => {
      const recencyTag = getTimeTag(d.lastMentioned);
      const parts: string[] = [`${name} [${recencyTag}, depth: ${d.depth}]`];
      const filtered = getFilteredInsights(d);
      if (filtered.length > 0) {
        parts.push(`known: ${filtered.slice(0, 3).join("; ")}`);
      }
      return parts.join(" | ");
    })
    .join("\n");

  const anchorFacts = sortedDomainEntries
    .flatMap(([name, d]) =>
      getFilteredInsights(d)
        .slice(0, 2)
        .map((ki) => `${name}: ${ki}`),
    )
    .slice(0, 6);
  const anchorBlock =
    anchorFacts.length > 0
      ? anchorFacts.map((f, i) => `${i + 1}. ${f}`).join("\n")
      : "  (not yet established)";

  const indexedWebFindings = buildIndexedWebFindings(webResults);

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

  const pastInsightBlock =
    recentInsightContents.length > 0
      ? recentInsightContents
          .slice(-5)
          .map((c, i) => `${i + 1}. ${truncate(c, 120)}`)
          .join("\n")
      : "";

  const bannedSection = buildBannedOpeningsSection(recentInsightContents);

  const coOccurrenceBlock = "";

  const domainNames = sortedDomainEntries.map(([name]) => name);
  const flatKeyInsights = sortedDomainEntries.flatMap(([, d]) =>
    getFilteredInsights(d).slice(0, 2),
  );
  const { text: promptFrame, frameIndex } = pickPromptFrame(
    input.targetDomains,
    domainNames,
    flatKeyInsights,
    persona.recentFocus,
    userName,
    input.feedbackProfile,
    locale,
  );

  const structureSeedIdx = input.feedbackProfile
    ? pickPromptVariant(
        input.feedbackProfile,
        STRUCTURE_SEEDS.map((_, i) => `seed:${i}`),
      )
    : Math.floor(Math.random() * STRUCTURE_SEEDS.length);
  const structureSeed = pickLocalized(STRUCTURE_SEEDS[structureSeedIdx]!, locale);

  const fewShotIdx = input.feedbackProfile
    ? pickPromptVariant(
        input.feedbackProfile,
        DIVERSE_FEW_SHOT_SETS.map((_, i) => `fewShot:${i}`),
      )
    : Math.floor(Math.random() * DIVERSE_FEW_SHOT_SETS.length);
  const fewShotBlock = DIVERSE_FEW_SHOT_SETS[fewShotIdx]!.examples.map(
    (e) => `Context: ${e.context}\n中文: ${e.chinese}\nEnglish: ${e.english}`,
  ).join("\n\n");

  const fragments = input.fragments ?? [];
  const fragmentSection = buildFragmentSection(fragments);

  const stance = selectEmotionalStance(fewShotIdx, input.recentEmotionalStances, locale);
  return {
    prompt: `${identityContext ? `${identityContext}\n` : ""}

EXAMPLES of ideal insights (match this quality and specificity):
${fewShotBlock}

${diversityInstructionFor(locale)}

${
  indexedWebFindings
    ? `RECENT WEB FINDINGS (PRIMARY material — pick ONE and connect it to THIS user):
${indexedWebFindings}`
    : ""
}

${identityBlock ? `USER:\n${identityBlock}` : ""}

USER'S DOMAINS (sorted by recency — most active first):
${userDomains || "Not yet established"}
 ${coOccurrenceBlock ? `\nCROSS-DOMAIN CONNECTIONS:\n${coOccurrenceBlock}` : ""}

SPECIFIC FACTS YOU KNOW ABOUT THIS USER (your insight MUST reference at least one):
${anchorBlock}
${fragmentSection ? `\nUSER CONVERSATION FRAGMENTS (what the user has been discussing recently):\n${fragmentSection}` : ""}

 Recent focus: ${recentFocus || "None"}
  Trust: ${persona.rapport.trustScore.toFixed(2)} / 1.0
  Delivered insight IDs: ${recentInsightIds || "None"}
${pastInsightBlock ? `\nPAST INSIGHTS (your insight must be CONTRASTIVELY different — see CONTRASTIVE FRAMEWORK below):\n${pastInsightBlock}\n\n${CONTRASTIVE_INSTRUCTION}` : ""}
${recentInsightContents.length > 0 ? `\nRECENTLY USED CONTENT THEMES (DO NOT reuse these concepts even for different domains):\n${extractContentThemes(recentInsightContents).join("、")}` : ""}
${
  (input.recentInsightDomains?.length ?? 0) > 0
    ? `\nRECENTLY COVERED DOMAIN COMBINATIONS (insight MUST explore NEW territory, NOT repeat these domain angles):\n${input
        .recentInsightDomains!.slice(-5)
        .map((domains, i) => `${i + 1}. ${domains.join(" + ")}`)
        .join("\n")}`
    : ""
}

  TARGET DOMAINS (insight MUST be about these domains):
${input.targetDomains.join(", ")}

 TASK:
${promptFrame}

 STRUCTURE CONSTRAINT:
${structureSeed}

 硬性要求（必须全部满足，否则拒绝输出）：
- 洞察内容必须围绕上面的"TARGET DOMAINS"展开，targetDomains字段必须包含这些域中的至少一个
- 必须引用上面"SPECIFIC FACTS"列表中的至少一条具体事实——不能只提领域名称，要说出用户在这个领域的具体认知或关注点
- 1-3句话，中文
- 允许使用问号和多样的句式结构，只要服务于洞察内容
- 禁止以下句式：
  · "值得关注"、"挺有意思"、"不得不说"
  · "你有没有想过"、"最近在关注"
  · "有趣的是"、"值得注意的是"
${bannedSection ? `  · ${bannedSection}` : ""}
${webResults.length > 0 ? "- 可以自然引用来源（如「根据[0]」、「看到[2]提到」）" : ""}

 好的洞察（满足至少一条）：
 - 跨域连接：把用户不同兴趣领域的具体知识关联起来
 - 实用建议：给一个明确的、可直接执行的行动方向
 - 反常识观点：挑战一个可能的错误认知，用事实反驳

Respond with ONLY a JSON array (no markdown, no code fences):
重要提示：在 "content" 字段中，请用 \\" 转义内部引号，或使用中文弯引号（""）。不要在字符串值中使用未转义的 ASCII 引号。
[
  {
    "content": "Your insight, in Chinese",
    "rationale": "Why this is relevant to this user SPECIFICALLY (reference persona data)",
    "targetDomains": ["${input.targetDomains[0] ?? "domain1"}"],
    "sourceDomains": ["domain2"],
    "relevanceScore": 0.8,
    "surpriseScore": 0.6,
    "sourceIndices": [0],
    "webGroundedness": 0.7
  }
]
CRITICAL: targetDomains MUST include at least one of: ${input.targetDomains.join(", ")}. Do NOT substitute other domains.

Keep insights concise (1-3 sentences). Quality over quantity.`,
    variant: {
      fewShotSet: fewShotIdx,
      frameIndex,
      structureSeed: structureSeedIdx,
      emotionalStance: stance.index,
    },
  };
}

function parseLLMInsights(text: string, maxCandidates: number): InsightCandidate[] {
  try {
    const cleaned = text
      .replace(/^```(?:json)?\s*/m, "")
      .replace(/\s*```$/m, "")
      .trim();

    let jsonStr = extractJsonArray(cleaned);
    if (!jsonStr) {
      log.warn("parseLLMInsights: no JSON array found in LLM response", {
        raw: cleaned.slice(0, 200),
      });
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
          log.warn("parseLLMInsights: JSON repair failed", {
            error: String(repairErr),
            raw: jsonStr.slice(0, 200),
          });
          return [];
        }
      }
    }

    const items = Array.isArray(parsed) ? parsed : [];
    return items
      .slice(0, maxCandidates)
      .map((item: Record<string, unknown>) => ({
        id: randomUUID(),
        content: String(item.content ?? "").replace(/\[\d+\]/g, ""),
        rationale: String(item.rationale ?? ""),
        targetDomains: Array.isArray(item.targetDomains) ? item.targetDomains.map(String) : [],
        sourceDomains: Array.isArray(item.sourceDomains) ? item.sourceDomains.map(String) : [],
        relevanceScore: clamp01(Number(item.relevanceScore ?? 0.5)),
        surpriseScore: clamp01(Number(item.surpriseScore ?? 0.5)),
        compositeScore:
          (clamp01(Number(item.relevanceScore ?? 0.5)) +
            clamp01(Number(item.surpriseScore ?? 0.5))) /
          2,
        sources: [],
        verificationStatus: "unverified" as const,
        source: "knowledge" as const,
        citedSourceIndices: Array.isArray(item.sourceIndices)
          ? (item.sourceIndices as unknown[]).map((n) => Number(n)).filter((n) => !isNaN(n))
          : [],
        webGroundedness: clamp01(Number(item.webGroundedness ?? 0)),
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
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }
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
      if (esc) {
        normalized += ch;
        esc = false;
        continue;
      }
      if (ch === "\\") {
        normalized += ch;
        esc = true;
        continue;
      }
      if (ch === '"') {
        inStr = !inStr;
        normalized += ch;
        continue;
      }
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
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (ch === "[") {
      openBrackets++;
    } else if (ch === "]") {
      openBrackets--;
    } else if (ch === "{") {
      openBraces++;
    } else if (ch === "}") {
      openBraces--;
    }
  }
  while (openBraces > 0) {
    s += "}";
    openBraces--;
  }
  while (openBrackets > 0) {
    s += "]";
    openBrackets--;
  }
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
    if (next === " " || next === "\t" || next === "\n" || next === "\r") {
      continue;
    }
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
  if (trimmed.length < 10) {
    return false;
  }
  for (const pattern of GENERIC_INSIGHT_PATTERNS) {
    if (pattern.test(trimmed)) {
      return false;
    }
  }
  return true;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

const PERSONA_WORKSPACE_FILES = ["SOUL.md", "IDENTITY.md", "USER.md"] as const;

export async function loadWorkspacePersonaContext(workspaceDir?: string): Promise<string> {
  const dir = workspaceDir ?? path.join(os.homedir(), ".kaijibot", "workspace");
  const parts: string[] = [];
  for (const filename of PERSONA_WORKSPACE_FILES) {
    try {
      const content = await fs.readFile(path.join(dir, filename), "utf-8");
      const trimmed = content.trim();
      if (trimmed) {
        parts.push(`## ${filename}\n${trimmed}`);
      }
    } catch {}
  }
  return parts.join("\n\n");
}

/**
 * Resolve SOUL.md content to prepend to insight prompts. Resolution order:
 *   1. Configured soul preset (e.g. `soul.preset: "intj"`) — honours per-agent,
 *      then default, then top-level config.
 *   2. Workspace SOUL.md at the agent's workspace dir.
 *   3. `undefined` (prompt stays backward compatible).
 */
export async function loadSoulContentForInsight(params: {
  config?: KaijiBotConfig;
  agentId?: string;
  workspaceDir?: string;
}): Promise<string | undefined> {
  const { config, agentId, workspaceDir } = params;

  if (config) {
    try {
      const preset = resolveSoulPreset(config, agentId);
      if (preset) {
        return loadSoulPresetContent(preset);
      }
    } catch (err) {
      log.warn("loadSoulContentForInsight: soul preset resolution failed", {
        error: String(err),
      });
    }
  }

  const dir =
    workspaceDir ?? (config && agentId ? resolveAgentWorkspaceDir(config, agentId) : undefined);
  if (dir) {
    try {
      const content = await fs.readFile(path.join(dir, "SOUL.md"), "utf-8");
      const trimmed = content.trim();
      if (trimmed) {
        return trimmed;
      }
    } catch {}
  }

  return undefined;
}

export async function loadIdentityContextForInsight(
  workspaceDir?: string,
): Promise<string | undefined> {
  const dir = workspaceDir ?? path.join(os.homedir(), ".kaijibot", "workspace");
  const parts: string[] = [];
  for (const filename of ["IDENTITY.md", "USER.md"] as const) {
    try {
      const content = await fs.readFile(path.join(dir, filename), "utf-8");
      const trimmed = content.trim();
      if (trimmed) {
        parts.push(`## ${filename.replace(".md", "")}\n${trimmed}`);
      }
    } catch {}
  }
  return parts.length > 0 ? parts.join("\n\n") : undefined;
}

export function buildCritiquePrompt(candidate: InsightCandidate, persona: PersonaTree): string {
  const sortedDomainEntries = Object.entries(persona.domains).toSorted(
    ([, a], [, b]) => b.lastMentioned - a.lastMentioned,
  );

  const anchorFacts = sortedDomainEntries
    .flatMap(([name, d]) =>
      getFilteredInsights(d)
        .slice(0, 2)
        .map((ki) => `${name}: ${ki}`),
    )
    .slice(0, 6);
  const anchorBlock =
    anchorFacts.length > 0
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

1. SPECIFICITY: Does the insight reference concrete, real details about THIS user's work/interests? Casual language is fine — what matters is whether it's grounded in specifics, not whether it sounds formal.
2. PERSONA RELEVANCE: Does it reference known facts about THIS user? Or generic advice anyone could receive?
3. ACTIONABILITY: Does the insight give the user something worth thinking about or acting on? This includes questions, provocations, and observations — not just direct action items.
4. SURPRISE: Is this genuinely new information the user likely doesn't know? Or obvious/common knowledge?
5. VOICE MATCH: Does it sound like it comes from a specific personality with a point of view? Or is it stiff/formal/generic-system-notification-like? Diverse tones (provocative, questioning, playful, contemplative) should score HIGH if they match the agent's personality, not low.

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
  _persona: PersonaTree,
): string {
  const suggestions = critique.improvementSuggestions.map((s, i) => `${i + 1}. ${s}`).join("\n");

  return `ORIGINAL GENERATION PROMPT:
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
- Forbidden phrases: "值得关注", "挺有意思", "不得不说", "你有没有想过", "最近在关注", "有趣的是", "值得注意的是"
- Start with a concrete fact, observation, or judgment — never with "关于", "在...领域", "结合你", "作为"
- Questions, lists, and varied sentence structures are ALLOWED if they serve the insight

Respond with ONLY a JSON array (no markdown, no code fences):
[
  {
    "content": "Your revised insight, in Chinese",
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
        maxTokens: options?.maxTokens ?? 4096,
        temperature: 0.3,
        signal: AbortSignal.timeout(options?.timeout ?? 8_000),
      },
    );

    const text = result.content
      .filter((block): block is { type: "text"; text: string } => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();

    if (!text) {
      return null;
    }

    const objStart = text.indexOf("{");
    const objEnd = text.lastIndexOf("}");
    if (objStart === -1 || objEnd === -1 || objEnd <= objStart) {
      return null;
    }

    const parsed: Record<string, unknown> = JSON.parse(text.slice(objStart, objEnd + 1));

    const requiredFields = [
      "specificity",
      "personaRelevance",
      "actionability",
      "surprise",
      "voiceMatch",
      "overallScore",
      "critique",
      "improvementSuggestions",
    ];
    for (const field of requiredFields) {
      if (!(field in parsed)) {
        return null;
      }
    }

    const improvementSuggestions = parsed.improvementSuggestions;
    if (!Array.isArray(improvementSuggestions)) {
      return null;
    }

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
        maxTokens: options?.maxTokens ?? 4096,
        temperature: 0.85,
        signal: AbortSignal.timeout(options?.timeout ?? 8_000),
      },
    );

    const text = result.content
      .filter((block): block is { type: "text"; text: string } => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();

    if (!text) {
      return null;
    }

    const candidates = parseLLMInsights(text, 1);
    if (candidates.length === 0) {
      return null;
    }

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

export function buildVerificationPrompt(candidate: InsightCandidate, persona: PersonaTree): string {
  const sortedDomainEntries = Object.entries(persona.domains).toSorted(
    ([, a], [, b]) => b.lastMentioned - a.lastMentioned,
  );

  const anchorFacts = sortedDomainEntries
    .flatMap(([name, d]) =>
      getFilteredInsights(d)
        .slice(0, 2)
        .map((ki) => `${name}: ${ki}`),
    )
    .slice(0, 6);
  const anchorBlock =
    anchorFacts.length > 0
      ? anchorFacts.map((f, i) => `${i + 1}. ${f}`).join("\n")
      : "(not yet established)";

  const sourceBlock =
    candidate.sources.length > 0
      ? candidate.sources
          .map((s, i) => `${i + 1}. [${s.title}](${s.url}) (credibility: ${s.credibility})`)
          .join("\n")
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

Score each dimension 0.0-1.0:
- sourceGroundingScore: How well does the insight content actually reflect what the sources say? (0 if no sources claimed, 1 if perfectly grounded)
- personalizationScore: Does the insight reference THIS user's specific facts, interests, or knowledge? (0 = generic, 1 = deeply personalized)
- sourceRelevanceScore: Are the cited sources actually relevant to the insight's claim? (0 = irrelevant, 1 = directly supports)

CRITICAL CHECKS:
- isNewsSummary: Is this insight just summarizing a news article WITHOUT connecting it to the user? If true → REJECT immediately.
- The insight must connect external information to the USER's specific context, not just report facts.

Criteria for each status:
- "verified": High quality — specific, relevant to THIS user, sources are relevant and grounded, NOT a news summary
- "partial": Decent quality but missing some elements — still acceptable for delivery
- "unverified": Generic, vague, not relevant enough to this specific user, OR just a news summary without personalization
- "contradicted": Contains factual errors or contradicts known information about the user

Respond with ONLY a JSON object (no markdown, no code fences):
{
  "approved": true/false,
  "confidence": 0.0-1.0,
  "status": "verified" | "partial" | "unverified" | "contradicted",
  "sourceGroundingScore": 0.0-1.0,
  "personalizationScore": 0.0-1.0,
  "sourceRelevanceScore": 0.0-1.0,
  "isNewsSummary": true/false,
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
        maxTokens: options?.maxTokens ?? 4096,
        temperature: 0.2,
        signal: AbortSignal.timeout(options?.timeout ?? 8_000),
      },
    );

    const text = result.content
      .filter((block): block is { type: "text"; text: string } => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();

    if (!text) {
      return unverified;
    }

    const objStart = text.indexOf("{");
    const objEnd = text.lastIndexOf("}");
    if (objStart === -1 || objEnd === -1 || objEnd <= objStart) {
      return unverified;
    }

    const parsed: Record<string, unknown> = JSON.parse(text.slice(objStart, objEnd + 1));

    const confidence = clamp01(Number(parsed.confidence) || 0);
    const llmStatus = String(parsed.status ?? "");
    const isNewsSummary = Boolean(parsed.isNewsSummary);

    let status: VerificationResult["status"];
    if (isNewsSummary) {
      status = "unverified";
    } else if (llmStatus === "contradicted") {
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
      sourceGroundingScore: clamp01(Number(parsed.sourceGroundingScore) || 0),
      personalizationScore: clamp01(Number(parsed.personalizationScore) || 0),
      sourceRelevanceScore: clamp01(Number(parsed.sourceRelevanceScore) || 0),
      isNewsSummary,
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
    .map(
      (text, i) =>
        `${i + 1}. ${text.length > MAX_PER_INSIGHT ? text.slice(0, MAX_PER_INSIGHT) : text}`,
    )
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
        maxTokens: options?.maxTokens ?? 4096,
        temperature: 0.2,
        signal: AbortSignal.timeout(options?.timeout ?? 6_000),
      },
    );

    const text = result.content
      .filter((block): block is { type: "text"; text: string } => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();

    if (!text) {
      return { isNovel: true, reason: "LLM freshness check unavailable" };
    }

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
