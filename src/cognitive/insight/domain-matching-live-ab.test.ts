/**
 * Live A/B test: keyword domain matching vs LLM domain matching.
 *
 * Purpose: Verify whether replacing matchWebResultsToDomainsLLM with
 * keyword-only matching actually degrades insight quality.
 *
 * Test design:
 *   1. Search real web for each target domain
 *   2. Match web results → domain snippets via BOTH methods
 *   3. Compare EXTERNAL_FACTS coverage (how many domains get snippets)
 *   4. Generate insights using BOTH prompts (keyword vs LLM matched)
 *   5. Evaluate insight quality side-by-side
 *
 * Run: KAIJIBOT_LIVE_TEST=1 ZAI_API_KEY=... TAVILY_API_KEY=... pnpm test src/cognitive/insight/domain-matching-live-ab.test.ts
 */

import { describe, it, expect } from "vitest";
import type { PersonaTree } from "../types.js";
import {
  buildInsightPrompt,
  matchWebResultsToDomainsLLM,
} from "./llm-engine.js";
import type { LlmInsightDeps, WebSearchResult } from "./llm-engine.js";
import type { InsightEngineInput } from "./types.js";

const isLive = process.env.KAIJIBOT_LIVE_TEST === "1" || process.env.LIVE === "1";
const ZAI_API_KEY = process.env.ZAI_API_KEY;
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;
const ZAI_URL = "https://api.z.ai/api/coding/paas/v4/chat/completions";
const MODEL = "glm-5-turbo";

// ─── Persona with semantically distant domains ────────────────────────────

function makePersona(): PersonaTree {
  const now = Date.now();
  return {
    identity: {
      displayName: "凯机",
      coreTraits: {},
      expertDomains: ["可观测性", "系统设计"],
      interestDomains: ["认知架构", "Rust"],
      curiosityDomains: [],
    },
    domains: {
      // Keywords: "可观测性" → exact match. But web might say "Observability", "OpenTelemetry", "distributed tracing"
      可观测性: {
        depth: 4,
        recurrence: 8,
        lastMentioned: now - 1000 * 60 * 30,
        keyInsights: ["分布式追踪", "指标体系设计"],
        activeQuestions: [],
        negationSignals: 0,
      },
      // Keywords: "系统设计" → exact. But web might say "CQRS", "Event Sourcing", "microservices"
      系统设计: {
        depth: 5,
        recurrence: 15,
        lastMentioned: now - 1000 * 60 * 10,
        keyInsights: ["领域驱动设计", "事件驱动架构"],
        activeQuestions: [],
        negationSignals: 0,
      },
      // Keywords: "Rust" → good exact match. But web might say "memory safety", "zero-cost abstractions"
      Rust: {
        depth: 4,
        recurrence: 10,
        lastMentioned: now - 1000 * 60 * 45,
        keyInsights: ["borrow checker", "zero-cost abstractions"],
        activeQuestions: [],
        negationSignals: 0,
      },
      // Keywords: "认知架构" → exact. But web might say "cognitive architecture", "ACT-R", "SOAR"
      认知架构: {
        depth: 3,
        recurrence: 5,
        lastMentioned: now - 1000 * 60 * 60,
        keyInsights: ["记忆整合", "主动推理"],
        activeQuestions: [],
        negationSignals: 0,
      },
    },
    recentFocus: ["可观测性升级", "Rust学习"],
    feedbackProfile: {
      topicBandits: {},
      optimalFrequencyHours: 2,
      lastProactiveAt: 0,
      recentInsightIds: [],
      recentInsightContents: [
        "Python的GIL被人骂了这么多年，但换个角度看它其实做对了一件事...",
      ],
      recentInsightDomains: [],
      recentInsightTypes: [],
    },
    rapport: {
      trustScore: 0.85,
      totalExchanges: 200,
      avgResponseLength: 200,
      selfDisclosureLevel: 1,
    },
    domainGraph: {
      nodes: ["可观测性", "系统设计", "Rust", "认知架构"],
      edges: [
        { source: "系统设计", target: "可观测性", weight: 0.7, lastObserved: now, observations: 5 },
        { source: "Rust", target: "系统设计", weight: 0.5, lastObserved: now, observations: 3 },
      ],
      totalObservations: 8,
    },
    moodHistory: [],
    domainBlacklist: [],
    lifecycle: {
      stage: "active",
      lastActiveAt: now,
      lastStageTransitionAt: now,
      totalActiveDays: 30,
    },
    calibrationHistory: [],
  };
}

function makeInput(targetDomains: string[]): InsightEngineInput {
  return {
    targetDomains,
    recentFocus: ["可观测性升级", "Rust学习"],
    trustScore: 0.85,
    recentInsightIds: [],
    recentInsightContents: [
      "Python的GIL被人骂了这么多年，但换个角度看它其实做对了一件事...",
    ],
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────

async function tavilySearch(query: string): Promise<WebSearchResult[]> {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: TAVILY_API_KEY,
      query,
      max_results: 5,
      include_answer: false,
    }),
  });
  const data = (await res.json()) as {
    results?: Array<{ title: string; url: string; content: string }>;
  };
  return (data.results ?? []).map((r) => ({
    title: r.title,
    url: r.url,
    snippet: r.content.slice(0, 200),
  }));
}

async function callLLM(prompt: string): Promise<string> {
  const res = await fetch(ZAI_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${ZAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.85,
      max_tokens: 2000,
    }),
  });
  const data = (await res.json()) as {
    error?: { message: string };
    choices?: Array<{ message: { content: string } }>;
  };
  if (data.error) throw new Error(data.error.message);
  return data.choices?.[0]?.message?.content ?? "";
}

function parseInsights(text: string): Array<{ content: string; rationale?: string }> {
  try {
    const cleaned = text
      .replace(/^```(?:json)?\s*/m, "")
      .replace(/\s*```$/m, "")
      .trim();
    const parsed = JSON.parse(cleaned);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Keyword matching (current behavior) — reimplemented from the source
function buildDomainKeywordMap(
  domains: Record<string, import("../types.js").DomainNode>,
): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const [name, domain] of Object.entries(domains)) {
    const keywords = new Set<string>();
    keywords.add(name.toLowerCase());
    for (const part of name.split(/[\/\+]/)) {
      const trimmed = part.trim().toLowerCase();
      if (trimmed.length >= 2) keywords.add(trimmed);
    }
    // Add keyInsights as keywords (simulating getFilteredInsights)
    for (const insight of (domain.keyInsights ?? []).slice(0, 3)) {
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

function matchWebResultsToDomainsKeyword(
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

// LLM matching using the actual exported function
function makeLlmDeps(): LlmInsightDeps {
  return {
    prepareModel: async (config, modelRef) => {
      const model = modelRef ?? config.cognitive?.persona?.extractionModel ?? MODEL;
      return {
        model,
        auth: { apiKey: ZAI_API_KEY! },
      };
    },
    complete: async (model, messages, opts) => {
      const content =
        messages.messages[0]?.content ?? messages.messages[0]?.text ?? "";
      const text = typeof content === "string" ? content : JSON.stringify(content);
      const res = await fetch(ZAI_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${opts.apiKey ?? ZAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: model,
          messages: [{ role: "user", content: text }],
          temperature: opts.temperature ?? 0.2,
          max_tokens: opts.maxTokens ?? 500,
        }),
        signal: opts.signal,
      });
      const data = (await res.json()) as {
        error?: { message: string };
        choices?: Array<{ message: { content: string } }>;
      };
      if (data.error) throw new Error(data.error.message);
      const responseText = data.choices?.[0]?.message?.content ?? "";
      return {
        content: [{ type: "text" as const, text: responseText }],
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        finishReason: "stop",
      };
    },
  };
}

function countExternalFacts(prompt: string): number {
  const match = prompt.match(/EXTERNAL_FACTS[\s\S]*?(\n\n|\nTASK)/);
  if (!match) return 0;
  const block = match[1] ?? match[0];
  return (block.match(/^\d+\./gm) || []).length;
}

// ─── Test ─────────────────────────────────────────────────────────────────

describe.skipIf(!isLive || !ZAI_API_KEY || !TAVILY_API_KEY)(
  "Live A/B: keyword vs LLM domain matching",
  () => {
    const TARGET_DOMAINS = ["可观测性", "Rust", "系统设计"];
    const ROUNDS = TARGET_DOMAINS.length;

    it(`compares keyword vs LLM domain matching across ${ROUNDS} domains`, async () => {
      const persona = makePersona();
      const llmDeps = makeLlmDeps();
      const config = {} as any; // eslint-disable-line

      console.log("\n  ══════════════════════════════════════════════════");
      console.log("  Domain Matching A/B Test");
      console.log("  ══════════════════════════════════════════════════\n");

      const abResults: Array<{
        domain: string;
        keywordDomains: number;
        keywordSnippets: number;
        llmDomains: number;
        llmSnippets: number;
        keywordExternalFacts: number;
        llmExternalFacts: number;
        keywordInsight: string;
        llmInsight: string;
        keywordQuality: number;
        llmQuality: number;
      }> = [];

      for (const domain of TARGET_DOMAINS) {
        console.log(`  ── Domain: ${domain} ──`);

        // 1. Search web
        const query = `${domain} 最新进展 2026`;
        const webResults = await tavilySearch(query);
        console.log(`  Web search: ${webResults.length} results for "${query}"`);
        for (const r of webResults) {
          console.log(`    - ${r.title.slice(0, 60)}`);
        }

        // 2. Keyword matching (Group A)
        const keywordMap = buildDomainKeywordMap(persona.domains);
        // Add target domain if not in persona
        if (!keywordMap.has(domain)) {
          const keywords = new Set<string>();
          keywords.add(domain.toLowerCase());
          for (const part of domain.split(/[\/+]/)) {
            const trimmed = part.trim().toLowerCase();
            if (trimmed.length >= 2) keywords.add(trimmed);
          }
          keywordMap.set(domain, keywords);
        }
        const keywordMatched = matchWebResultsToDomainsKeyword(webResults, keywordMap);

        console.log(`  [A] Keyword matched: ${keywordMatched.size} domains`);
        for (const [d, snippets] of keywordMatched) {
          console.log(`    ${d}: ${snippets.length} snippets`);
        }

        // 3. LLM matching (Group B)
        const llmMatched = await matchWebResultsToDomainsLLM(
          webResults,
          persona,
          config,
          llmDeps,
          [domain],
        );

        console.log(`  [B] LLM matched: ${llmMatched.size} domains`);
        for (const [d, snippets] of llmMatched) {
          console.log(`    ${d}: ${snippets.length} snippets`);
        }

        // 4. Compare coverage
        const keywordOnlyDomains = [...llmMatched.keys()].filter(
          (d) => !keywordMatched.has(d),
        );
        const llmOnlyDomains = [...keywordMatched.keys()].filter(
          (d) => !llmMatched.has(d),
        );
        if (keywordOnlyDomains.length > 0) {
          console.log(`  ⚡ LLM found but keyword missed: ${keywordOnlyDomains.join(", ")}`);
        }
        if (llmOnlyDomains.length > 0) {
          console.log(`  ⚡ Keyword found but LLM missed: ${llmOnlyDomains.join(", ")}`);
        }

        // 5. Build prompts with each matching result
        const input = makeInput([domain]);

        const { prompt: keywordPrompt } = buildInsightPrompt(
          persona,
          input,
          webResults,
          persona.feedbackProfile.recentInsightContents,
          keywordMatched, // Group A: keyword-matched domain snippets
        );

        const { prompt: llmPrompt } = buildInsightPrompt(
          persona,
          input,
          webResults,
          persona.feedbackProfile.recentInsightContents,
          llmMatched, // Group B: LLM-matched domain snippets
        );

        const keywordExtFacts = countExternalFacts(keywordPrompt);
        const llmExtFacts = countExternalFacts(llmPrompt);
        console.log(`  [A] EXTERNAL_FACTS entries: ${keywordExtFacts}`);
        console.log(`  [B] EXTERNAL_FACTS entries: ${llmExtFacts}`);

        // 6. Generate insights
        const [keywordRaw, llmRaw] = await Promise.all([
          callLLM(keywordPrompt),
          callLLM(llmPrompt),
        ]);

        const keywordInsights = parseInsights(keywordRaw);
        const llmInsights = parseInsights(llmRaw);

        const keywordContent = keywordInsights[0]?.content ?? "(parse failed)";
        const llmContent = llmInsights[0]?.content ?? "(parse failed)";

        console.log(`\n  [A] Keyword-matched insight:`);
        console.log(`      ${keywordContent.slice(0, 120)}`);
        console.log(`  [B] LLM-matched insight:`);
        console.log(`      ${llmContent.slice(0, 120)}`);

        // 7. Simple quality scoring
        const scoreQuality = (text: string): number => {
          let score = 0;
          if (text.length >= 30) score += 2;
          if (text.length >= 50) score += 1;
          if (/具体|实际|发现|现象|案例/.test(text)) score += 2; // specific/concrete
          if (!/[？?]$/.test(text.trim())) score += 1; // no question mark ending
          if (!/值得关注|挺有意思|不得不说/.test(text)) score += 1; // no banned patterns
          // Check if insight references web information
          const allSnippets = webResults.map((r) => r.snippet).join(" ");
          const overlap = [...text].filter((c) => allSnippets.includes(c)).length / text.length;
          if (overlap > 0.3) score += 3; // incorporates external facts
          return score;
        };

        const keywordQuality = scoreQuality(keywordContent);
        const llmQuality = scoreQuality(llmContent);

        console.log(`  [A] Quality: ${keywordQuality}/10 | [B] Quality: ${llmQuality}/10`);

        abResults.push({
          domain,
          keywordDomains: keywordMatched.size,
          keywordSnippets: [...keywordMatched.values()].reduce((s, v) => s + v.length, 0),
          llmDomains: llmMatched.size,
          llmSnippets: [...llmMatched.values()].reduce((s, v) => s + v.length, 0),
          keywordExternalFacts: keywordExtFacts,
          llmExternalFacts: llmExtFacts,
          keywordInsight: keywordContent,
          llmInsight: llmContent,
          keywordQuality,
          llmQuality,
        });

        console.log("");
      }

      // ─── Summary ──────────────────────────────────────────────────────
      console.log("\n  ══════════════════════════════════════════════════");
      console.log("  SUMMARY");
      console.log("  ══════════════════════════════════════════════════\n");

      const avgKeywordDomains =
        abResults.reduce((s, r) => s + r.keywordDomains, 0) / abResults.length;
      const avgLlmDomains = abResults.reduce((s, r) => s + r.llmDomains, 0) / abResults.length;
      console.log(`  Avg domains matched:  [A] Keyword: ${avgKeywordDomains.toFixed(1)} | [B] LLM: ${avgLlmDomains.toFixed(1)}`);

      const avgKeywordSnippets =
        abResults.reduce((s, r) => s + r.keywordSnippets, 0) / abResults.length;
      const avgLlmSnippets = abResults.reduce((s, r) => s + r.llmSnippets, 0) / abResults.length;
      console.log(`  Avg snippets matched: [A] Keyword: ${avgKeywordSnippets.toFixed(1)} | [B] LLM: ${avgLlmSnippets.toFixed(1)}`);

      const avgKeywordFacts =
        abResults.reduce((s, r) => s + r.keywordExternalFacts, 0) / abResults.length;
      const avgLlmFacts = abResults.reduce((s, r) => s + r.llmExternalFacts, 0) / abResults.length;
      console.log(`  Avg EXTERNAL_FACTS:   [A] Keyword: ${avgKeywordFacts.toFixed(1)} | [B] LLM: ${avgLlmFacts.toFixed(1)}`);

      const avgKeywordQuality =
        abResults.reduce((s, r) => s + r.keywordQuality, 0) / abResults.length;
      const avgLlmQuality = abResults.reduce((s, r) => s + r.llmQuality, 0) / abResults.length;
      console.log(`  Avg insight quality:  [A] Keyword: ${avgKeywordQuality.toFixed(1)}/10 | [B] LLM: ${avgLlmQuality.toFixed(1)}/10`);

      const qualityDelta = avgKeywordQuality - avgLlmQuality;
      console.log(`\n  Quality delta (keyword - LLM): ${qualityDelta > 0 ? "+" : ""}${qualityDelta.toFixed(1)}`);
      if (Math.abs(qualityDelta) <= 1.0) {
        console.log("  ✅ Within noise margin — keyword matching is acceptable");
      } else if (qualityDelta > 1.0) {
        console.log("  ⚠️  Keyword matching is BETTER than LLM (unexpected)");
      } else {
        console.log("  ❌ LLM matching produces significantly better insights");
      }

      console.log("\n  ══════════════════════════════════════════════════\n");

      // Assertions — we expect quality to be within 1.5 points
      expect(abResults.length).toBe(ROUNDS);
      expect(avgKeywordQuality).toBeGreaterThanOrEqual(4.0);
      // If LLM matching is significantly better (>1.5 points), this will fail
      // and we should revert the change
      expect(avgKeywordQuality).toBeGreaterThanOrEqual(avgLlmQuality - 1.5);
    }, 300_000);
  },
);
