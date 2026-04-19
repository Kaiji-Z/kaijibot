import { complete, type Api, type Model } from "@mariozechner/pi-ai";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ResolvedProviderAuth } from "../../agents/model-auth.js";
import { prepareSimpleCompletionModel } from "../../agents/simple-completion-runtime.js";
import type { KaijiBotConfig } from "../../config/config.js";
import type { PersonaTree } from "../types.js";
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

  const prompt = buildInsightPrompt(persona, input, webResults, input.recentInsightContents);

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
      log.warn(`LLM response could not be parsed as insights (raw: ${text.slice(0, 200)})`);
      return [];
    }
    log.info(`LLM generated ${candidates.length} insight candidate(s)`);
    return candidates.map((c) => enrichWithWebSources(c, webResults));
  } catch (err) {
    const isTimeout = err instanceof DOMException && err.name === "TimeoutError";
    log.warn(`LLM insight generation ${isTimeout ? "timed out" : "failed"}: ${String(err)}, skipping insight`);
    return [];
  }
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
    .replace(/\b(?:ou_)?[0-9a-f]{16,}\s*:?\s*/g, "")
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

/**
 * Build a focused web-search query from the insight pipeline input.
 *
 * Strategy:
 *  1. Try to extract 2-3 key concepts from the first pending question.
 *  2. If no pending question (or extraction yields nothing), fall back to recentFocus.
 *  3. Always prepend the primary target domain as context.
 *  4. Cap at 120 chars and ensure the query is well-formed.
 */
export function buildSearchQuery(input: InsightEngineInput): string {
  const domain = input.targetDomains[0] ?? "";
  const parts: string[] = [];

  // Attempt concept extraction from pending question first (highest signal)
  const questionTerms = input.pendingQuestions.length > 0
    ? extractKeyTerms(input.pendingQuestions[0]!)
    : [];

  // Fall back to recent focus if question extraction yields nothing useful
  const focusTerms = questionTerms.length === 0 && input.recentFocus.length > 0
    ? extractKeyTerms(input.recentFocus[0]!)
    : [];

  const concepts = questionTerms.length > 0 ? questionTerms : focusTerms;

  if (domain) {
    parts.push(domain);
  }

  const seen = new Set<string>();
  const domainLower = domain.toLowerCase();
  for (const term of concepts) {
    const termLower = term.toLowerCase();
    const overlapsDomain = domainLower && (termLower.includes(domainLower) || domainLower.includes(termLower));
    if (!overlapsDomain && !seen.has(termLower)) {
      parts.push(term);
      seen.add(termLower);
    }
    if (parts.length >= 4) break;
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

/** Extended context for prompt frame generation. */
type PromptFrameExtra = {
  pendingQuestions: string[];
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
  // 2: Answer pending question concretely
  (topic: string, extra: PromptFrameExtra) => {
    if (extra.pendingQuestions.length > 0) {
      return `之前的问题是"${extra.pendingQuestions[0]!}"。你现在的理解有了进展——不要复述问题，直接给出你最新的判断或发现。`;
    }
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
  pendingQuestions: string[],
  domainNames: string[],
  keyInsights: string[],
  recentFocus: string[],
  userName: string,
): string {
  const topic = topics.length > 0 ? topics[0]! : "你的兴趣领域";
  const frame = PROMPT_FRAMES[Math.floor(Math.random() * PROMPT_FRAMES.length)];
  return frame(topic, { pendingQuestions, domains: domainNames, keyInsights, recentFocus, userName });
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

function matchWebResultsToDomains(
  webResults: WebSearchResult[],
  keywordMap: Map<string, Set<string>>,
): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const r of webResults) {
    const titleLower = r.title.toLowerCase();
    const snippetLower = r.snippet.toLowerCase();
    for (const [domainName, keywords] of keywordMap) {
      const matched = [...keywords].some(
        (kw) => titleLower.includes(kw) || snippetLower.includes(kw),
      );
      if (matched) {
        const list = result.get(domainName) ?? [];
        list.push(r.snippet);
        result.set(domainName, list);
      }
    }
  }
  return result;
}

export function buildInsightPrompt(
  persona: PersonaTree,
  input: InsightEngineInput,
  webResults: WebSearchResult[] = [],
  recentInsightContents: string[] = [],
): string {
  const keywordMap = buildDomainKeywordMap(persona.domains);
  const webSnippetByDomain = matchWebResultsToDomains(webResults, keywordMap);
  if (webResults.length > 0) {
    const matchedDomains = [...webSnippetByDomain.keys()];
    const unmatched = webResults.length - [...webSnippetByDomain.values()].reduce((s, v) => s + v.length, 0);
    log.info("web search domain matching", {
      totalResults: webResults.length,
      matchedDomains: matchedDomains.length > 0 ? matchedDomains : "(none)",
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

  const externalFacts = buildExternalFactsEntries(webSnippetByDomain);
  const externalFactsBlock = externalFacts.length > 0
    ? externalFacts.map((f, i) => `${i + 1}. ${f}`).join("\n")
    : "";

  const recentFocus = persona.recentFocus.slice(0, 5).join(", ");
  const pendingQuestions = persona.pendingQuestions.slice(0, 3).join("; ");
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
    ? recentInsightContents.slice(-3).map((c, i) => `${i + 1}. ${truncate(c, 80)}`).join("\n")
    : "";

  const bannedOpenings = recentInsightContents
    .slice(-3)
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
  const promptFrame = pickPromptFrame(
    input.targetDomains, persona.pendingQuestions, domainNames,
    flatKeyInsights, persona.recentFocus, userName,
  );

  const structureSeed = STRUCTURE_SEEDS[Math.floor(Math.random() * STRUCTURE_SEEDS.length)]!;
  const openingBans = bannedOpenings.length > 0
    ? bannedOpenings.map((o) => `不要以"${o}"开头`).join("；")
    : "";

  return `You are the AI assistant speaking in your own voice and personality. You are proactively reaching out to share something that crossed your mind — genuinely useful or surprising for THIS specific user.

${identityBlock ? `USER:\n${identityBlock}` : ""}

USER'S DOMAINS (sorted by recency — most active first):
${userDomains || "Not yet established"}
${coOccurrenceBlock ? `\nCROSS-DOMAIN CONNECTIONS:\n${coOccurrenceBlock}` : ""}

SPECIFIC FACTS YOU KNOW ABOUT THIS USER (your insight MUST reference at least one):
${anchorBlock}
${externalFactsBlock ? `\nEXTERNAL_FACTS (recent web findings relevant to user's domains):\n${externalFactsBlock}\n\nIMPORTANT: If EXTERNAL_FACTS contains information relevant to the user's focus areas, prioritize building the insight around those external facts rather than recombining known keyInsights.` : ""}

Recent focus: ${recentFocus || "None"}
Pending questions: ${pendingQuestions || "None"}
Trust: ${persona.rapport.trustScore.toFixed(2)} / 1.0
Delivered insight IDs: ${recentInsightIds || "None"}
${pastInsightBlock ? `\nPAST INSIGHTS (content AND sentence structure must be completely different):\n${pastInsightBlock}` : ""}

TASK:
${promptFrame}

STRUCTURE CONSTRAINT:
${structureSeed}

硬性要求（必须全部满足，否则拒绝输出）：
- 必须引用上面"SPECIFIC FACTS"列表中的至少一条具体事实——不能只提领域名称，要说出用户在这个领域的具体认知或关注点
- 1-3句话，中文，语气像突然想到什么要跟朋友说
- 不用问号结尾，不用列表或编号
- 禁止以下句式和短语：
  · "被人X但换个角度"或"虽然X但Y"的对比模板
  · "值得关注"、"挺有意思"、"不得不说"
  · "你有没有想过"、"最近在关注"、"你发现没有"
  · "其实...也是"、"背后的原因是"
  · "换个角度来看"、"有没有可能"
  · "有趣的是"、"值得注意的是"
  · "说到"、"关于"、"在...领域"作为开头
  · "结合你..."、"作为..."作为开头
${openingBans ? `  · ${openingBans}` : ""}
- 内容必须是一个具体的判断、观察或建议，不是泛泛的感受
${webResults.length > 0 ? "- 外部信息自然融入内容里，不要说'看到'、'读到'、'据说'" : ""}

好的洞察（满足至少一条）：
- 跨域连接：把用户不同兴趣领域的具体知识关联起来
- 解答悬问：对用户之前问过但没答案的问题给出新判断
- 实用建议：给一个明确的、可直接执行的行动方向
- 反常识观点：挑战一个可能的错误认知，用事实反驳

CRITICAL: Output in your own voice — the same personality the user knows from regular conversations. NOT a formal report, NOT a system notification.

Respond with ONLY a JSON array (no markdown, no code fences):
[
  {
    "content": "Your insight in your own voice, in Chinese",
    "rationale": "Why this is relevant to this user SPECIFICALLY (reference persona data)",
    "targetDomains": ["domain1"],
    "sourceDomains": ["domain2"],
    "relevanceScore": 0.8,
    "surpriseScore": 0.6
  }
]

Keep insights concise (1-3 sentences). Quality over quantity.`;
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
      .filter((c: InsightCandidate) => c.content.length > 0 && isSubstantiveContent(c.content));
  } catch {
    return [];
  }
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
