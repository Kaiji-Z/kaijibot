/**
 * Live pipeline evaluation — full search→identify→resolve with real LLM + web search.
 *
 * Run: KAIJIBOT_LIVE_TEST=1 ZAI_API_KEY=$ZAI_API_KEY TAVILY_API_KEY=$TAVILY_API_KEY \
 *     pnpm test src/cognitive/insight/insight-pipeline-live-eval.test.ts
 */

import { describe, it, expect } from "vitest";
import type { Api, AssistantMessage, Model } from "@mariozechner/pi-ai";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ProactiveScheduler, type InsightGeneratorFn } from "../scheduler/proactive-scheduler.js";
import {
  generateInsightCandidatesLLM,
  GENERIC_INSIGHT_PATTERNS,
  type LlmInsightDeps,
  type WebSearchResult,
} from "./llm-engine.js";
import {
  InsightV2Pipeline,
  createPipelineDeps,
  createV2InsightGenerator,
  createDualInsightGenerator,
} from "./pipeline.js";
import { FragmentStore } from "./fragment-store.js";
import type { Fragment } from "./fragment-types.js";
import type { PersonaTree } from "../types.js";
import type { InsightCandidate, InsightEngineInput } from "./types.js";
import type { SchedulerConfig, SchedulerEvent } from "../scheduler/types.js";
import type { KaijiBotConfig } from "../../config/config.js";
import { resolveConfigDir } from "../../utils.js";

// ─── Constants ───

const isLive = process.env.KAIJIBOT_LIVE_TEST === "1" || process.env.LIVE === "1";
const ZAI_API_KEY = process.env.ZAI_API_KEY;
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;
const ZAI_URL = "https://api.z.ai/api/coding/paas/v4/chat/completions";
const MODEL = "glm-5-turbo";
const ROUNDS = 5;

// ─── Helpers: assistantMessage ───

function assistantMessage(text: string): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text" as const, text }],
    api: "openai-completions",
    provider: "zai",
    model: MODEL,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
}

// ─── Helpers: Model + Auth ───

const TEST_MODEL: Model<Api> = {
  id: MODEL,
  name: "GLM-5 Turbo",
  api: "openai-completions",
  provider: "zai",
  baseUrl: ZAI_URL,
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128000,
  maxTokens: 4096,
};

const TEST_AUTH = { apiKey: ZAI_API_KEY ?? "", source: "zai", mode: "api-key" as const };

// ─── Helpers: real LLM deps ───

function makeRealLlmDeps(): LlmInsightDeps {
  return {
    complete: async (_model, context, options) => {
      const messages = context.messages.map((m) => ({
        role: m.role === "user" ? "user" : "assistant",
        content:
          typeof m.content === "string"
            ? m.content
            : m.content
                .filter((c): c is { type: "text"; text: string } => c.type === "text")
                .map((c) => c.text)
                .join("\n"),
      }));
      const res = await fetch(ZAI_URL, {
        method: "POST",
        signal: AbortSignal.timeout(30_000),
        headers: {
          Authorization: `Bearer ${ZAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: MODEL,
          messages,
          temperature: 0.85,
          max_tokens: options?.maxTokens ?? 2000,
        }),
      });
      const data = (await res.json()) as {
        error?: { message: string };
        choices?: Array<{ message: { content: string } }>;
      };
      if (data.error) throw new Error(data.error.message);
      const text = data.choices?.[0]?.message?.content ?? "";
      return assistantMessage(text);
    },
    prepareModel: async () => ({ model: TEST_MODEL, auth: TEST_AUTH }),
    webSearch: TAVILY_API_KEY
      ? async (query: string): Promise<WebSearchResult[]> => {
          const res = await fetch("https://api.tavily.com/search", {
            method: "POST",
            signal: AbortSignal.timeout(15_000),
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
      : undefined,
    inferenceDeps: {
      complete: async (_model, context, options) => {
        const messages = context.messages.map((m) => ({
          role: m.role === "user" ? "user" : "assistant",
          content:
            typeof m.content === "string"
              ? m.content
              : m.content
                  .filter((c): c is { type: "text"; text: string } => c.type === "text")
                  .map((c) => c.text)
                  .join("\n"),
        }));
        const res = await fetch(ZAI_URL, {
          method: "POST",
          signal: AbortSignal.timeout(30_000),
          headers: {
            Authorization: `Bearer ${ZAI_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: MODEL,
            messages,
            temperature: 0.7,
            max_tokens: options?.maxTokens ?? 1000,
          }),
        });
        const data = (await res.json()) as {
          error?: { message: string };
          choices?: Array<{ message: { content: string } }>;
        };
        if (data.error) throw new Error(data.error.message);
        const text = data.choices?.[0]?.message?.content ?? "";
        return assistantMessage(text);
      },
      prepareModel: async () => ({ model: TEST_MODEL, auth: TEST_AUTH }),
    },
  };
}

// ─── Helpers: load real persona ───

function loadRealPersona(): PersonaTree {
  const configDir = resolveConfigDir();
  const personaDir = path.join(configDir, "cognitive", "persona", "main");
  const files = fs
    .readdirSync(personaDir)
    .filter((f) => f.startsWith("ou_") && f.endsWith(".json"));
  if (files.length === 0) throw new Error("No user persona found in " + personaDir);
  const personaPath = path.join(personaDir, files[0]!);
  return JSON.parse(fs.readFileSync(personaPath, "utf8")) as PersonaTree;
}

// ─── Helpers: seed fragments for v2 ───

async function seedFragments(userId: string, store: FragmentStore): Promise<void> {
  const now = Date.now();
  const fragments: Fragment[] = [
    {
      id: randomUUID(),
      userId,
      createdAt: now - 3_600_000,
      expiresAt: now + 13 * 24 * 3_600_000,
      kind: "assumption",
      evidence:
        "假设所有问题都可以通过添加更多抽象层来解决，但实际系统复杂度存在非线性拐点",
      domains: ["AI/认知架构", "软件架构"],
      structuralTag: "layering-bias",
      strength: 0.7,
    },
    {
      id: randomUUID(),
      userId,
      createdAt: now - 2_700_000,
      expiresAt: now + 13 * 24 * 3_600_000,
      kind: "methodological_habit",
      evidence:
        "习惯用 prompt engineering 替代真正的系统设计思考，导致架构决策被推迟到 prompt 层",
      domains: ["AI/认知架构", "产品思维"],
      structuralTag: "prompt-as-architecture",
      strength: 0.65,
    },
    {
      id: randomUUID(),
      userId,
      createdAt: now - 2_400_000,
      expiresAt: now + 13 * 24 * 3_600_000,
      kind: "unresolved_tension",
      evidence:
        "对系统可靠性的追求与快速迭代的渴望之间存在矛盾——验证 pipeline 越复杂，迭代越慢",
      domains: ["软件架构", "AI/机器学习"],
      structuralTag: "reliability-vs-velocity",
      strength: 0.75,
    },
    {
      id: randomUUID(),
      userId,
      createdAt: now - 1_800_000,
      expiresAt: now + 13 * 24 * 3_600_000,
      kind: "implicit_priority",
      evidence:
        "隐含地优先选择自建方案而非使用现有工具，即使现有工具更成熟",
      domains: ["软件架构", "云/基础设施"],
      structuralTag: "build-vs-buy-bias",
      strength: 0.6,
    },
    {
      id: randomUUID(),
      userId,
      createdAt: now - 1_200_000,
      expiresAt: now + 13 * 24 * 3_600_000,
      kind: "assumption",
      evidence:
        "假设主动推送越频繁用户越满意，但实际存在信息疲劳的阈值效应",
      domains: ["AI产品/主动型Agent设计", "心理学/亲密关系"],
      structuralTag: "frequency-satisfaction-linear",
      strength: 0.7,
    },
    {
      id: randomUUID(),
      userId,
      createdAt: now - 900_000,
      expiresAt: now + 13 * 24 * 3_600_000,
      kind: "knowledge_gap",
      evidence:
        "对 Rust 所有权模型在嵌入式系统中的应用场景了解有限，但频繁表达兴趣",
      domains: ["编程语言", "AI/机器学习"],
      structuralTag: "rust-embedded-gap",
      strength: 0.55,
    },
    {
      id: randomUUID(),
      userId,
      createdAt: now - 600_000,
      expiresAt: now + 13 * 24 * 3_600_000,
      kind: "implicit_priority",
      evidence:
        "在讨论 AI 伦理时倾向关注技术实现可行性而非哲学基础，可能忽略了规范性维度",
      domains: ["哲学/伦理学", "AI/认知架构"],
      structuralTag: "tech-over-ethics-priority",
      strength: 0.65,
    },
    {
      id: randomUUID(),
      userId,
      createdAt: now - 300_000,
      expiresAt: now + 13 * 24 * 3_600_000,
      kind: "methodological_habit",
      evidence:
        "习惯从架构层面思考问题，但很少从用户心智模型出发反向验证设计假设",
      domains: ["产品思维", "创业/商业"],
      structuralTag: "architecture-first-blindspot",
      strength: 0.7,
    },
  ];

  for (const frag of fragments) {
    await store.addFragment(userId, frag);
  }
}

// ─── Helpers: config ───

function makeSchedulerConfig(): SchedulerConfig {
  return {
    minIntervalHours: 0, // Bypass time gate
    minTrustScore: 0, // Bypass trust gate
    costFalseNegative: 100, // Make gate very permissive
    costFalseAlarm: 1,
  };
}

function makeMinimalConfig(): KaijiBotConfig {
  return {
    cognitive: { insight: { sources: { webSearchProvider: "zai" } } },
  } as KaijiBotConfig;
}

// ─── Result types ───

interface RoundResult {
  round: number;
  opportunityTypes: string[];
  selected: {
    type: string;
    targetDomains: string[];
    pAct: number;
  } | null;
  insight: {
    id: string;
    content: string;
    source: string;
    targetDomains: string[];
    hasWebSources: boolean;
  } | null;
}

// ─── Evaluation ───

function evaluateResults(results: RoundResult[], persona: PersonaTree): void {
  const resolved = results.filter((r) => r.insight !== null);
  const withSelection = results.filter((r) => r.selected !== null);
  const failed = results.filter((r) => r.selected !== null && r.insight === null);
  const noSelection = results.filter((r) => r.selected === null);

  // 1. JSON parse / resolve success rate
  const resolveRate = withSelection.length > 0 ? resolved.length / withSelection.length : 0;
  console.log(`\n  ═══ Pipeline Evaluation Report ═══`);
  console.log(
    `  Resolve 成功率: ${(resolveRate * 100).toFixed(0)}% (${resolved.length}/${withSelection.length})`,
  );
  console.log(`  无选择: ${noSelection.length}, Resolve 失败: ${failed.length}`);

  // 2. Type diversity
  const typeCounts: Record<string, number> = {};
  for (const r of resolved) {
    if (r.selected) {
      typeCounts[r.selected.type] = (typeCounts[r.selected.type] ?? 0) + 1;
    }
  }
  console.log(`  类型分布: ${JSON.stringify(typeCounts)}`);

  // 3. Domain diversity
  const allDomains = resolved.flatMap((r) => r.insight?.targetDomains ?? []);
  const uniqueDomains = new Set(allDomains);
  console.log(
    `  域分布: ${uniqueDomains.size} unique domains: ${[...uniqueDomains].join(", ")}`,
  );

  // 4. V2 activation
  const v2Count = resolved.filter((r) => r.insight?.source === "v2").length;
  console.log(`  V2 洞察: ${v2Count}/${resolved.length}`);

  // 5. Content quality — banned pattern check
  const allKeyInsights = Object.values(persona.domains).flatMap((d) => d.keyInsights);
  const bannedHits = resolved.map((r) => {
    if (!r.insight) return 0;
    return GENERIC_INSIGHT_PATTERNS.filter((p) => p.test(r.insight!.content)).length;
  });
  const cleanRate = bannedHits.length > 0 ? bannedHits.filter((h) => h === 0).length / bannedHits.length : 1;
  const keyInsightRate =
    resolved.length > 0
      ? resolved.filter(
          (r) => r.insight && allKeyInsights.some((k) => r.insight!.content.includes(k)),
        ).length / resolved.length
      : 0;
  console.log(`  无模板句式: ${(cleanRate * 100).toFixed(0)}%`);
  console.log(`  引用 keyInsight: ${(keyInsightRate * 100).toFixed(0)}%`);

  // 6. Content dedup check
  const contents = resolved.map((r) => r.insight?.content ?? "");
  const openings = contents.map((c) => c.slice(0, 8));
  const uniqueOpenings = new Set(openings);
  console.log(`  开头多样性: ${uniqueOpenings.size}/${contents.length}`);

  // 7. 2-hop cross-domain
  const userDomainSet = new Set(Object.keys(persona.domains));
  const nonUserDomainInsights = resolved.filter((r) => {
    if (!r.insight) return false;
    return r.insight.targetDomains.some((d) => !userDomainSet.has(d));
  });
  console.log(
    `  非用户域洞察 (2-hop): ${nonUserDomainInsights.length}/${resolved.length}`,
  );

  console.log(`  ═════════════════════════════════\n`);

  // Assertions
  // Resolve rate threshold is set conservatively since real LLM calls can
  // timeout or produce unparseable output; the diversification fix ensures
  // different opportunity types are tried across rounds.
  expect(resolveRate).toBeGreaterThanOrEqual(0.4);
  expect(resolved.length).toBeGreaterThanOrEqual(2);
  expect(cleanRate).toBeGreaterThanOrEqual(0.5);
}

// ═══════════════════════════════════════════════════════════════════════════════

describe
  .skipIf(!isLive || !ZAI_API_KEY)
  ("live pipeline evaluation — real persona + real LLM + web search", () => {
    it(`runs ${ROUNDS} rounds of search→identify→resolve and evaluates`, async () => {
      const persona = loadRealPersona();
      const domainCount = Object.keys(persona.domains).length;
      const trust = persona.rapport.trustScore;
      console.log(`\n  Persona: ${domainCount} domains, trust=${trust.toFixed(2)}`);
      console.log(`  Domains: ${Object.keys(persona.domains).join(", ")}`);

      // 2. Seed fragments for v2
      const userId = persona.identity?.userId ?? "test-user";
      const configDir = resolveConfigDir();
      const fragmentStore = new FragmentStore(configDir);
      await seedFragments(userId, fragmentStore);
      console.log(`  Seeded fragments for userId=${userId}`);

      // 3. Build dual pipeline
      const llmDeps = makeRealLlmDeps();
      const config = makeMinimalConfig();

      // v1 generator: LLM-based insight generation
      const v1Generator: InsightGeneratorFn = (p, input, options) => {
        return generateInsightCandidatesLLM(p, input, config, llmDeps, {
          maxCandidates: options?.maxCandidates,
        });
      };

      // v2 generator: fragment crystallization pipeline
      const pipelineDeps = createPipelineDeps(configDir, fragmentStore);
      const v2Pipeline = new InsightV2Pipeline(pipelineDeps, v1Generator);
      const v2Generator = createV2InsightGenerator(v2Pipeline, config);

      // Dual: v1 + v2 in parallel with dedup
      const dualGenerator = createDualInsightGenerator(v1Generator, v2Generator);

      // 4. Create scheduler with dual pipeline
      const scheduler = new ProactiveScheduler(
        makeSchedulerConfig(),
        {
          loadPersona: async () => persona,
          onInsightReady: async () => {},
          savePersona: async () => {},
        },
        { insightGenerator: dualGenerator },
      );

      // 5. Run 5 rounds
      const results: RoundResult[] = [];

      for (let round = 0; round < ROUNDS; round++) {
        const event: SchedulerEvent = {
          type: "timer",
          timestamp: Date.now() + round * 3_600_000, // 1 hour apart for seeded shuffle variety
        };

        // search → identify (bypass gate)
        const opportunities = scheduler.search(persona, event);
        const selectedPool = scheduler.identify(opportunities, persona);

        if (selectedPool.length === 0) {
          console.log(`  [Round ${round + 1}] identify returned empty (${opportunities.length} opportunities)`);
          results.push({
            round: round + 1,
            opportunityTypes: opportunities.map((o) => o.type),
            selected: null,
            insight: null,
          });
          continue;
        }

        const selected = selectedPool[0]!;
        console.log(
          `  [Round ${round + 1}] identify → ${selected.type} | domains: ${selected.targetDomains.join(",")} | pAct: ${selected.pAct.toFixed(3)}`,
        );

        // resolve (real LLM call)
        const insight = await scheduler.resolve(persona, selected);

        if (insight) {
          persona.feedbackProfile.recentInsightIds = [
            ...(persona.feedbackProfile.recentInsightIds ?? []),
            insight.id,
          ].slice(-20);
          persona.feedbackProfile.recentInsightContents = [
            ...(persona.feedbackProfile.recentInsightContents ?? []),
            insight.content,
          ].slice(-5);
          persona.feedbackProfile.recentInsightDomains = [
            ...(persona.feedbackProfile.recentInsightDomains ?? []),
            insight.targetDomains,
          ].slice(-5);
          persona.feedbackProfile.recentInsightTypes = [
            ...(persona.feedbackProfile.recentInsightTypes ?? []),
            selected.type,
          ].slice(-5);
          if (insight.searchQueryUsed) {
            persona.feedbackProfile.recentInsightQueryHistory = [
              ...(persona.feedbackProfile.recentInsightQueryHistory ?? []),
              insight.searchQueryUsed,
            ].slice(-10);
          }

          console.log(
            `    洞察 (${insight.source ?? "v1"}): ${insight.content.slice(0, 120)}...`,
          );
          console.log(`    Web sources: ${insight.sources.length}`);
        } else {
          // Track failed attempt so identify() cooldown can diversify next round
          persona.feedbackProfile.recentInsightDomains = [
            ...(persona.feedbackProfile.recentInsightDomains ?? []),
            selected.targetDomains,
          ].slice(-5);
          persona.feedbackProfile.recentInsightTypes = [
            ...(persona.feedbackProfile.recentInsightTypes ?? []),
            selected.type,
          ].slice(-5);
          console.log(`    resolve 返回 null`);
        }

        results.push({
          round: round + 1,
          opportunityTypes: opportunities.map((o) => o.type),
          selected: {
            type: selected.type,
            targetDomains: selected.targetDomains,
            pAct: selected.pAct,
          },
          insight: insight
            ? {
                id: insight.id,
                content: insight.content,
                source: insight.source ?? "v1",
                targetDomains: insight.targetDomains,
                hasWebSources: insight.sources.length > 0,
              }
            : null,
        });
      }

      // 6. Evaluate and report
      evaluateResults(results, persona);
    }, 20 * 60 * 1000);
  });
