/**
 * Live consolidation quality test — real LLM extraction from session transcripts.
 *
 * Validates that the consolidation prompt produces valid, high-quality structured
 * output from real session transcripts via the ZAI API.
 *
 * Run: KAIJIBOT_LIVE_TEST=1 ZAI_API_KEY=$ZAI_API_KEY pnpm test extensions/memory-core/src/consolidation-live-quality.test.ts
 */

import { describe, it, expect } from "vitest";
import { extractFromBatch } from "./consolidation-extract.js";
import type { TranscriptBatch } from "./consolidation-types.js";

const isLive = process.env.KAIJIBOT_LIVE_TEST === "1" || process.env.LIVE === "1";
const ZAI_API_KEY = process.env.ZAI_API_KEY;
const ZAI_URL = "https://api.z.ai/api/coding/paas/v4/chat/completions";
const MODEL = "glm-5-turbo";

async function callLLM(prompt: string): Promise<string> {
  const res = await fetch(ZAI_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${ZAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
      max_tokens: 3000,
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

function makeBatch(files: Array<{ path: string; content: string }>): TranscriptBatch {
  return { agentId: "test-agent", userId: "ou_test123", files };
}

const VALID_CATEGORIES = new Set([
  "domain_knowledge",
  "behavioral_pattern",
  "stated_preference",
  "goal_or_aspiration",
]);

// ---------------------------------------------------------------------------
// Transcripts
// ---------------------------------------------------------------------------

const CHINESE_TECHNICAL_TRANSCRIPT = [
  "User: 我最近在用 TypeScript 重构后端服务，感觉类型检查帮了很大忙",
  "Assistant: TypeScript 的类型系统确实能帮助减少运行时错误。你用了哪些特性？",
  "User: 主要是泛型和联合类型，还有 zod 做运行时验证",
  "Assistant: 泛型 + zod 是很好的组合，编译时和运行时都有了保障",
].join("\n");

const ENGLISH_CODING_TRANSCRIPT = [
  "User: I'm trying to decide between PostgreSQL and MongoDB for my new project",
  "Assistant: What kind of data are you working with? Relational or document-based?",
  "User: Mostly relational data with some JSON blobs. I need ACID compliance.",
  "Assistant: PostgreSQL sounds like a good fit - it handles JSON well with jsonb columns",
  "User: Yeah, that's what I was thinking. I've been using Postgres for 5 years now",
].join("\n");

const MULTI_TOPIC_TRANSCRIPT = [
  "User: 明天要去爬山，但是天气预报说有雨",
  "Assistant: 可以看看室内活动备选方案。你平时喜欢什么运动？",
  "User: 我其实更喜欢游泳，每周游三次",
  "Assistant: 游泳是非常好的有氧运动。对了，你上次说的那个项目进度怎么样了？",
  "User: 项目下周要交付，我今晚还得加班赶文档",
  "Assistant: 注意休息，赶工容易出错",
  "User: 我的目标是今年内把微服务架构全部迁移完",
  "Assistant: 那是个大工程，有明确的里程碑吗？",
].join("\n");

const SHORT_TRANSCRIPT = "User: 今天天气不错\nAssistant: 是的，适合出去走走";

const GIBBERISH_TRANSCRIPT = "xkcd 42 asdf qwer zxcv nmnb poiu lkjh gfds";

const FACT_BASED_TRANSCRIPT = [
  "User: 我在阿里云上部署了三个 Kubernetes 集群，分别在北京、上海和深圳",
  "Assistant: 跨区域部署能提高容灾能力。用的什么网络方案？",
  "User: 用的 CCE 的 Terway 网络插件，配合 PrivateZone 做服务发现",
  "Assistant: Terway 支持原生 VPC 网络，性能不错。有没有遇到跨集群通信的问题？",
  "User: 有的，后来用 Istio 搞定了多集群服务网格",
  "Assistant: Istio 的多集群模式确实能统一流量管理。建议关注一下 1.20 版本的 ambient mode",
].join("\n");

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe.skipIf(!isLive || !ZAI_API_KEY)("live consolidation quality — real LLM extraction", () => {
  it("extracts valid structured items from Chinese conversation transcript", async () => {
    const batch = makeBatch([
      { path: "memory/2025-05-25.md", content: CHINESE_TECHNICAL_TRANSCRIPT },
    ]);
    const items = await extractFromBatch(batch, callLLM);

    console.log(`\n  ═══ Chinese Technical Transcript ═══`);
    console.log(`  Extracted ${items.length} items`);
    for (const item of items) {
      console.log(`  [${item.category}] conf=${item.confidence} "${item.content}"`);
      console.log(`    evidence: "${item.evidence}"`);
    }
    console.log(`  ═══════════════════\n`);

    expect(items.length).toBeGreaterThan(0);

    for (const item of items) {
      expect(VALID_CATEGORIES.has(item.category)).toBe(true);
      expect(item.confidence).toBeGreaterThanOrEqual(0.5);
      expect(item.confidence).toBeLessThanOrEqual(1);
      expect(item.content.length).toBeGreaterThan(0);
      expect(item.evidence.length).toBeGreaterThan(0);
      expect(item.source).toBe("transcript");
    }
  }, 60_000);

  it("extracts valid structured items from English conversation transcript", async () => {
    const batch = makeBatch([{ path: "memory/2025-05-25.md", content: ENGLISH_CODING_TRANSCRIPT }]);
    const items = await extractFromBatch(batch, callLLM);

    console.log(`\n  ═══ English Coding Transcript ═══`);
    console.log(`  Extracted ${items.length} items`);
    for (const item of items) {
      console.log(`  [${item.category}] conf=${item.confidence} "${item.content}"`);
      console.log(`    evidence: "${item.evidence}"`);
    }
    console.log(`  ═══════════════════\n`);

    expect(items.length).toBeGreaterThan(0);

    for (const item of items) {
      expect(VALID_CATEGORIES.has(item.category)).toBe(true);
      expect(item.confidence).toBeGreaterThanOrEqual(0.5);
      expect(item.confidence).toBeLessThanOrEqual(1);
      expect(item.content.length).toBeGreaterThan(0);
      expect(item.evidence.length).toBeGreaterThan(0);
      expect(item.source).toBe("transcript");
    }
  }, 60_000);

  it("extracts diverse categories from multi-topic conversation", async () => {
    const batch = makeBatch([{ path: "memory/2025-05-25.md", content: MULTI_TOPIC_TRANSCRIPT }]);
    const items = await extractFromBatch(batch, callLLM);

    console.log(`\n  ═══ Multi-Topic Transcript ═══`);
    console.log(`  Extracted ${items.length} items`);
    const categories = new Set(items.map((i) => i.category));
    console.log(`  Categories: ${[...categories].join(", ")}`);
    for (const item of items) {
      console.log(`  [${item.category}] conf=${item.confidence} "${item.content}"`);
    }
    console.log(`  ═══════════════════\n`);

    expect(items.length).toBeGreaterThan(0);

    const categoriesFound = new Set(items.map((i) => i.category));
    expect(categoriesFound.size).toBeGreaterThanOrEqual(2);

    for (const item of items) {
      expect(VALID_CATEGORIES.has(item.category)).toBe(true);
      expect(item.source).toBe("transcript");
    }
  }, 60_000);

  it("handles edge case: very short transcript", async () => {
    const batch = makeBatch([{ path: "memory/2025-05-25.md", content: SHORT_TRANSCRIPT }]);
    const items = await extractFromBatch(batch, callLLM);

    console.log(`\n  ═══ Short Transcript ═══`);
    console.log(`  Extracted ${items.length} items`);
    for (const item of items) {
      console.log(`  [${item.category}] conf=${item.confidence} "${item.content}"`);
    }
    console.log(`  ═══════════════════\n`);

    // Should return an array (possibly empty or with few items) without errors
    expect(Array.isArray(items)).toBe(true);

    for (const item of items) {
      expect(VALID_CATEGORIES.has(item.category)).toBe(true);
      expect(item.confidence).toBeGreaterThanOrEqual(0.5);
      expect(item.confidence).toBeLessThanOrEqual(1);
    }
  }, 60_000);

  it("handles edge case: non-sensical/random text", async () => {
    const batch = makeBatch([{ path: "memory/2025-05-25.md", content: GIBBERISH_TRANSCRIPT }]);
    const items = await extractFromBatch(batch, callLLM);

    console.log(`\n  ═══ Gibberish Transcript ═══`);
    console.log(`  Extracted ${items.length} items from gibberish`);
    for (const item of items) {
      console.log(`  [${item.category}] conf=${item.confidence} "${item.content}"`);
    }
    console.log(`  ═══════════════════\n`);

    // Should return empty array or items — the parsing handles both gracefully
    expect(Array.isArray(items)).toBe(true);

    // If items are returned despite gibberish, they should still pass validation
    for (const item of items) {
      expect(VALID_CATEGORIES.has(item.category)).toBe(true);
      expect(item.confidence).toBeGreaterThanOrEqual(0.5);
      expect(item.confidence).toBeLessThanOrEqual(1);
    }
  }, 60_000);

  it("quality check: evidence relates to transcript content", async () => {
    const batch = makeBatch([{ path: "memory/2025-05-25.md", content: FACT_BASED_TRANSCRIPT }]);
    const items = await extractFromBatch(batch, callLLM);

    console.log(`\n  ═══ Evidence Quality Check ═══`);
    console.log(`  Extracted ${items.length} items from fact-based transcript`);
    for (const item of items) {
      console.log(`  [${item.category}] "${item.content}"`);
      console.log(`    evidence: "${item.evidence}"`);
    }
    console.log(`  ═══════════════════\n`);

    expect(items.length).toBeGreaterThan(0);

    // Check that at least some evidence strings contain keywords from the transcript
    const transcriptLower = FACT_BASED_TRANSCRIPT.toLowerCase();
    const keywords = [
      "kubernetes",
      "k8s",
      "集群",
      "阿里云",
      "terway",
      "istio",
      "cce",
      "北京",
      "上海",
      "深圳",
    ];

    let evidenceWithKeywordCount = 0;
    for (const item of items) {
      expect(item.evidence.length).toBeGreaterThan(0);
      // Evidence should contain at least some recognizable words, not pure hallucination
      const evidenceLower = item.evidence.toLowerCase();
      const hasKeyword = keywords.some(
        (kw) =>
          transcriptLower.includes(kw.toLowerCase()) && evidenceLower.includes(kw.toLowerCase()),
      );
      if (hasKeyword) {
        evidenceWithKeywordCount++;
      }
    }

    // At least half the items should have evidence that relates to the transcript
    expect(evidenceWithKeywordCount).toBeGreaterThanOrEqual(
      Math.max(1, Math.floor(items.length / 2)),
    );

    for (const item of items) {
      expect(item.source).toBe("transcript");
    }
  }, 60_000);
});
