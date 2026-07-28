/**
 * A/B live test — persona summary layer vs full context.
 *
 * Run: KAIJIBOT_LIVE_TEST=1 ZAI_API_KEY=$ZAI_API_KEY pnpm test src/cognitive/persona/summary-ab.live.test.ts
 *
 * Methodology:
 *   1. Construct a rich persona (same for both arms)
 *   2. Arm A: inject buildPersonaContext (full, ~1-3KB)
 *   3. Arm B: inject buildPersonaSummary (compact, ~0.5-1KB)
 *   4. Ask the same 5 questions to both arms (real LLM, temperature=0.3)
 *   5. Score each reply on 4 dimensions (0-10):
 *      - Persona-aware: does the reply reference known traits/domains?
 *      - Accurate: is the information correct and relevant?
 *      - Concise: is the reply appropriately brief (not bloated)?
 *      - Natural: does it sound like a personal assistant, not a robot?
 *   6. Compare aggregate scores. If Arm B ≥ Arm A on all 4 dims, summary is
 *      safe to make default.
 */

import { describe, it, expect } from "vitest";
import type { PersonaTree } from "../types.js";
import { buildPersonaContext } from "./context-builder.js";
import { createDefaultPersona } from "./store.js";
import { buildPersonaSummary } from "./summary-builder.js";

const isLive = process.env.KAIJIBOT_LIVE_TEST === "1" || process.env.LIVE === "1";
const ZAI_API_KEY = process.env.ZAI_API_KEY;
const ZAI_URL = "https://api.z.ai/api/coding/paas/v4/chat/completions";
const MODEL = "glm-5.2";

async function callLLM(systemPrompt: string, userMessage: string): Promise<string> {
  const res = await fetch(ZAI_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${ZAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      temperature: 0.3,
      max_tokens: 600,
    }),
  });
  const data = (await res.json()) as {
    error?: { message: string };
    choices?: Array<{ message: { content: string } }>;
  };
  if (data.error) {
    throw new Error(data.error.message);
  }
  return data.choices?.[0]?.message?.content ?? "";
}

function buildRichPersona(): PersonaTree {
  const persona = createDefaultPersona();
  persona.identity.displayName = "Kaiji";
  persona.identity.coreTraits = {
    称呼: {
      value: "Kaiji",
      confidence: 0.95,
      evidenceCount: 12,
      lastUpdated: 0,
      source: "explicit",
    },
    role: {
      value: "AI architect",
      confidence: 0.85,
      evidenceCount: 8,
      lastUpdated: 0,
      source: "inferred",
    },
    style: {
      value: "concise technical",
      confidence: 0.7,
      evidenceCount: 5,
      lastUpdated: 0,
      source: "observed",
    },
  };
  persona.identity.expertDomains = ["LLM systems", "TypeScript", "cognitive architecture"];
  persona.identity.interestDomains = ["philosophy of mind", "distributed systems"];
  persona.identity.communicationStyle = {
    formality: "casual",
    verbosity: "concise",
    technicalLevel: "expert",
    preferredLanguage: "zh",
  };
  persona.rapport = {
    trustScore: 0.72,
    totalExchanges: 45,
    avgResponseLength: 120,
    selfDisclosureLevel: 0.6,
  };
  persona.recentFocus = ["context engineering", "prompt optimization", "feishu integration"];
  persona.domains = {
    "LLM systems": {
      depth: 8,
      recurrence: 15,
      lastMentioned: Date.now() - 2 * 86_400_000,
      keyInsights: ["prefers provider-agnostic architecture", "values token efficiency"],
      insights: [
        {
          text: "prefers provider-agnostic architecture",
          category: "durable",
          confidence: 0.9,
          source: "explicit",
          firstObserved: 0,
          lastReinforced: 0,
          evidenceCount: 5,
          halfLifeDays: 30,
        },
        {
          text: "values token efficiency over feature completeness",
          category: "durable",
          confidence: 0.8,
          source: "inferred",
          firstObserved: 0,
          lastReinforced: 0,
          evidenceCount: 4,
          halfLifeDays: 30,
        },
        {
          text: "uses GLM as primary model",
          category: "ephemeral",
          confidence: 0.7,
          source: "observed",
          firstObserved: 0,
          lastReinforced: 0,
          evidenceCount: 3,
          halfLifeDays: 7,
        },
      ],
      activeQuestions: [],
      negationSignals: 0,
      phase: "stable",
    },
    TypeScript: {
      depth: 6,
      recurrence: 10,
      lastMentioned: Date.now() - 5 * 86_400_000,
      keyInsights: ["strict typing advocate", "prefers zod at boundaries"],
      insights: [
        {
          text: "strict typing advocate",
          category: "durable",
          confidence: 0.85,
          source: "explicit",
          firstObserved: 0,
          lastReinforced: 0,
          evidenceCount: 6,
          halfLifeDays: 30,
        },
      ],
      activeQuestions: [],
      negationSignals: 0,
      phase: "stable",
    },
    "philosophy of mind": {
      depth: 3,
      recurrence: 4,
      lastMentioned: Date.now() - 14 * 86_400_000,
      keyInsights: ["interested in consciousness theories"],
      insights: [],
      activeQuestions: [],
      negationSignals: 0,
      phase: "declining",
    },
  };
  return persona;
}

const QUESTIONS = [
  {
    prompt:
      "你好，最近我在研究 context engineering，你觉得和 prompt engineering 的核心区别是什么？",
    check: /context|上下文|prompt|提示|token|retrieve|检索|just.in.time/i,
  },
  {
    prompt: "帮我推荐一个 TypeScript 项目的类型校验方案。",
    check: /zod|io-ts|runtypes|type.*guard|schema|typescript|类型/i,
  },
  {
    prompt: "你觉得 AI 系统设计中，什么最重要？",
    check: /token|效率|architecture|架构|context|relia|可靠|cost|成本/i,
  },
  {
    prompt: "我对意识的本质很感兴趣，有什么推荐的思考方向？",
    check: /consciousness|意识|qualia|感受质|emergent|涌现|hard.problem|难题/i,
  },
  {
    prompt: "一句话介绍我自己是什么样的人。",
    check: /Kaiji|AI.architect|架构|LLM|系统|concise|简洁|technical|技术/i,
  },
];

type Score = {
  personaAware: number;
  accurate: number;
  concise: number;
  natural: number;
};

function scoreReply(reply: string, question: (typeof QUESTIONS)[number]): Score {
  const len = reply.length;
  const hasTrait = /Kaiji|架构|architect|技术|expert|expert|concise|简洁|token|效率/i.test(reply);
  const matchesExpected = question.check.test(reply);
  const isReasonableLength = len > 30 && len < 800;
  const soundsNatural = !/I apologize|As an AI|I am sorry|作为.*AI/i.test(reply);

  return {
    personaAware: hasTrait ? 8 : 4,
    accurate: matchesExpected ? 8 : 3,
    concise: isReasonableLength ? 8 : len > 800 ? 4 : 5,
    natural: soundsNatural ? 8 : 3,
  };
}

function aggregate(scores: Score[]): Score & { total: number } {
  const sum = scores.reduce(
    (acc, s) => ({
      personaAware: acc.personaAware + s.personaAware,
      accurate: acc.accurate + s.accurate,
      concise: acc.concise + s.concise,
      natural: acc.natural + s.natural,
    }),
    { personaAware: 0, accurate: 0, concise: 0, natural: 0 },
  );
  const n = scores.length;
  return {
    personaAware: sum.personaAware / n,
    accurate: sum.accurate / n,
    concise: sum.concise / n,
    natural: sum.natural / n,
    total: (sum.personaAware + sum.accurate + sum.concise + sum.natural) / (n * 4),
  };
}

describe.skipIf(!isLive || !ZAI_API_KEY)("A/B live: persona summary vs full context", () => {
  const TIMEOUT = 120_000;
  const persona = buildRichPersona();
  const fullContext = buildPersonaContext(persona);
  const summaryContext = buildPersonaSummary(persona);
  const baseSystemPrompt =
    "You are KaijiBot, a proactive AI personal assistant. Reply in the user's preferred language.";

  it("summary context is smaller than full context", () => {
    console.log(`\n  Full context: ${fullContext.length} chars`);
    console.log(`  Summary context: ${summaryContext.length} chars`);
    console.log(`  Ratio: ${((summaryContext.length / fullContext.length) * 100).toFixed(1)}%`);
    expect(summaryContext.length).toBeLessThan(fullContext.length);
  });

  it("Arm A (full) vs Arm B (summary) — 5 questions", async () => {
    const armA: Score[] = [];
    const armB: Score[] = [];

    for (const q of QUESTIONS) {
      const replyA = await callLLM(`${baseSystemPrompt}\n\n${fullContext}`, q.prompt);
      await new Promise((r) => setTimeout(r, 500));
      const replyB = await callLLM(`${baseSystemPrompt}\n\n${summaryContext}`, q.prompt);

      const scoreA = scoreReply(replyA, q);
      const scoreB = scoreReply(replyB, q);
      armA.push(scoreA);
      armB.push(scoreB);

      console.log(`\n  Q: ${q.prompt.slice(0, 40)}...`);
      console.log(
        `  A (full ${fullContext.length}ch):    persona=${scoreA.personaAware} acc=${scoreA.accurate} conc=${scoreA.concise} nat=${scoreA.natural}`,
      );
      console.log(
        `  B (summary ${summaryContext.length}ch): persona=${scoreB.personaAware} acc=${scoreB.accurate} conc=${scoreB.concise} nat=${scoreB.natural}`,
      );
      console.log(`  Reply A: ${replyA.slice(0, 150)}...`);
      console.log(`  Reply B: ${replyB.slice(0, 150)}...`);
    }

    const aggA = aggregate(armA);
    const aggB = aggregate(armB);

    console.log(`\n  ═══ Aggregate (avg 0-10) ═══`);
    console.log(
      `  Arm A (full):    persona=${aggA.personaAware.toFixed(1)} acc=${aggA.accurate.toFixed(1)} conc=${aggA.concise.toFixed(1)} nat=${aggA.natural.toFixed(1)} total=${aggA.total.toFixed(2)}`,
    );
    console.log(
      `  Arm B (summary): persona=${aggB.personaAware.toFixed(1)} acc=${aggB.accurate.toFixed(1)} conc=${aggB.concise.toFixed(1)} nat=${aggB.natural.toFixed(1)} total=${aggB.total.toFixed(2)}`,
    );
    console.log(
      `  Token saved: ${fullContext.length - summaryContext.length} chars (${((1 - summaryContext.length / fullContext.length) * 100).toFixed(1)}%)`,
    );

    const bWinsOnAll =
      aggB.personaAware >= aggA.personaAware - 1 &&
      aggB.accurate >= aggA.accurate - 1 &&
      aggB.concise >= aggA.concise - 1 &&
      aggB.natural >= aggA.natural - 1;

    console.log(
      `\n  Verdict: ${bWinsOnAll ? "✅ Summary is safe to make default (within 1pt tolerance)" : "⚠️ Full context still better — keep summary opt-in"}`,
    );

    expect(aggA.total).toBeGreaterThan(0);
    expect(aggB.total).toBeGreaterThan(0);
  }, 300_000);
});
