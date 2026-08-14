import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it, expect, vi } from "vitest";
import type { KaijiBotConfig } from "../config/config.js";
import type { ReplyDispatcher } from "./reply/reply-dispatcher.js";
import { buildTestCtx } from "./reply/test-ctx.js";

function textToBigrams(text: string): Set<string> {
  const clean = text.toLowerCase().replace(/[^\w\u4e00-\u9fff]/g, "");
  const result = new Set<string>();
  for (let i = 0; i < clean.length - 1; i++) {
    result.add(clean.slice(i, i + 2));
  }
  return result;
}

function bigramSimilarity(a: string, b: string): number {
  const setA = textToBigrams(a);
  const setB = textToBigrams(b);
  if (setA.size === 0 || setB.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const gram of setA) {
    if (setB.has(gram)) {
      intersection++;
    }
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

const FOLLOWUP_PATTERNS = [
  "展开",
  "详细",
  "具体",
  "深入",
  "解释",
  "说明",
  "什么意思",
  "举例",
  "例子",
  "比如",
  "怎么理解",
  "怎么看",
  "继续",
  "然后呢",
  "接着说",
  "为什么",
  "你是说",
  "你的意思是",
  "讲讲",
  "多说点",
  "tell me more",
  "elaborate",
  "explain",
  "what do you mean",
  "how so",
  "example",
  "go on",
  "continue",
  "interesting",
];

function matchesFollowUp(text: string): boolean {
  const lower = text.toLowerCase();
  return FOLLOWUP_PATTERNS.some((p) => lower.includes(p));
}

describe("bigramSimilarity", () => {
  it("returns 1.0 for identical strings", () => {
    expect(bigramSimilarity("空间思维", "空间思维")).toBeCloseTo(1.0, 5);
  });

  it("returns 0 for completely different strings", () => {
    expect(bigramSimilarity("abcdefgh", "xyzwvuts")).toBe(0);
  });

  it("returns 0 for empty strings", () => {
    expect(bigramSimilarity("", "hello")).toBe(0);
    expect(bigramSimilarity("hello", "")).toBe(0);
  });

  it("detects Chinese content overlap — discussing insight", () => {
    const insight = "从建筑设计的承重路径到AI agent的文件系统探路，结构墙必须画在图纸上";
    const userReply = "空间思维确实能用到代码架构上，建筑的承重路径和代码的依赖结构很像";
    expect(bigramSimilarity(userReply, insight)).toBeGreaterThan(0.05);
  });

  it("rejects unrelated Chinese messages", () => {
    const insight = "从建筑设计到AI coding，跨学科生命轨迹的底层逻辑";
    const userReply = "帮我查一下明天北京的天气";
    expect(bigramSimilarity(userReply, insight)).toBeLessThan(0.05);
  });

  it("detects English content overlap", () => {
    const insight = "WebGPU is turning the browser into a local AI runtime";
    const userReply = "WebGPU compute shader performance is impressive for local inference";
    expect(bigramSimilarity(userReply, insight)).toBeGreaterThan(0.12);
  });

  it("handles mixed Chinese-English text", () => {
    const insight = "LookatStudy用Propose→Apply构筑安全沙盒，AI的本质仅作建议";
    const userReply = "LookatStudy的Propose Apply机制确实安全，但GitHub直灌SRS击穿了底线";
    expect(bigramSimilarity(userReply, insight)).toBeGreaterThan(0.15);
  });
});

describe("FOLLOWUP_PATTERNS", () => {
  it("matches Chinese followup requests", () => {
    expect(matchesFollowUp("展开解释一下")).toBe(true);
    expect(matchesFollowUp("详细说说")).toBe(true);
    expect(matchesFollowUp("举个例子？")).toBe(true);
    expect(matchesFollowUp("这个怎么理解")).toBe(true);
    expect(matchesFollowUp("继续")).toBe(true);
    expect(matchesFollowUp("你是说建筑和编程有关系？")).toBe(true);
  });

  it("matches English followup requests", () => {
    expect(matchesFollowUp("tell me more about this")).toBe(true);
    expect(matchesFollowUp("elaborate please")).toBe(true);
    expect(matchesFollowUp("can you explain?")).toBe(true);
    expect(matchesFollowUp("interesting, go on")).toBe(true);
  });

  it("does not match unrelated messages", () => {
    expect(matchesFollowUp("帮我查天气")).toBe(false);
    expect(matchesFollowUp("what time is it")).toBe(false);
    expect(matchesFollowUp("你好")).toBe(false);
  });

  it("does not match empty message", () => {
    expect(matchesFollowUp("")).toBe(false);
  });
});

describe("feedback classification logic", () => {
  const insight = "从建筑设计的承重路径到AI agent的文件系统探路，结构诚实与可读性的张力";

  it("classifies content-discussion as engaged", () => {
    const userMsg = "建筑的承重路径和代码结构确实很像，AI agent的探路也是结构问题";
    const isDiscussing = bigramSimilarity(userMsg, insight) >= 0.08;
    const isFollowUp = matchesFollowUp(userMsg);
    expect(isDiscussing).toBe(true);
    expect(isFollowUp).toBe(false);
    const sentiment = isDiscussing ? "engaged" : "positive";
    expect(sentiment).toBe("engaged");
  });

  it("classifies followup-request as positive", () => {
    const userMsg = "展开解释一下";
    const isDiscussing = bigramSimilarity(userMsg, insight) >= 0.08;
    const isFollowUp = matchesFollowUp(userMsg);
    expect(isDiscussing).toBe(false);
    expect(isFollowUp).toBe(true);
    const sentiment = isDiscussing ? "engaged" : "positive";
    expect(sentiment).toBe("positive");
  });

  it("rejects unrelated message entirely", () => {
    const userMsg = "帮我查一下明天的天气";
    const isDiscussing = bigramSimilarity(userMsg, insight) >= 0.08;
    const isFollowUp = matchesFollowUp(userMsg);
    expect(isDiscussing).toBe(false);
    expect(isFollowUp).toBe(false);
  });
});

type DispatchReplyFromConfigFn =
  typeof import("./reply/dispatch-from-config.js").dispatchReplyFromConfig;

const hoisted = vi.hoisted(() => ({
  dispatchReplyFromConfigMock: vi.fn(),
}));

vi.mock("./reply/dispatch-from-config.js", () => ({
  dispatchReplyFromConfig: (...args: Parameters<DispatchReplyFromConfigFn>) =>
    hoisted.dispatchReplyFromConfigMock(...args),
}));

const { dispatchInboundMessage } = await import("./dispatch.js");
const { InsightStore } = await import("../cognitive/insight/store.js");
const { PersonaStore, createDefaultPersona } = await import("../cognitive/persona/store.js");

function createDispatcher(): ReplyDispatcher {
  return {
    sendToolResult: () => true,
    sendBlockReply: () => true,
    sendFinalReply: () => true,
    getQueuedCounts: () => ({ tool: 0, block: 0, final: 0 }),
    getFailedCounts: () => ({ tool: 0, block: 0, final: 0 }),
    markComplete: () => undefined,
    waitForIdle: async () => undefined,
  };
}

async function withFeedbackSandbox<T>(
  fn: (ctx: { stateDir: string; agentId: string; userId: string }) => Promise<T>,
): Promise<T> {
  const stateDir = await fs.mkdtemp(path.join(os.tmpdir(), "kaijibot-feedback-"));
  const previous = process.env.KAIJIBOT_STATE_DIR;
  process.env.KAIJIBOT_STATE_DIR = stateDir;
  try {
    return await fn({ stateDir, agentId: "main", userId: "ou_test123" });
  } finally {
    if (previous === undefined) {
      delete process.env.KAIJIBOT_STATE_DIR;
    } else {
      process.env.KAIJIBOT_STATE_DIR = previous;
    }
    await fs.rm(stateDir, { recursive: true, force: true });
  }
}

async function seedInsightWithDelivery(stateDir: string, deliveredAtMs: number): Promise<string> {
  const store = new InsightStore(stateDir);
  const id = `insight-${deliveredAtMs}`;
  const record = {
    id,
    generatedAt: deliveredAtMs,
    triggerSource: "scheduled" as const,
    targetDomains: ["软件开发"],
    sourceDomains: [],
    content: "从建筑设计的承重路径到AI agent的文件系统探路，结构诚实与可读性的张力",
    rationale: "test",
    sources: [],
    deliveredAt: deliveredAtMs,
  };
  await store.save("main", "ou_test123", record);
  return id;
}

async function seedPersonaWithStaleLastProactive(stateDir: string): Promise<void> {
  const store = new PersonaStore(stateDir);
  const persona = createDefaultPersona();
  persona.identity.userId = "ou_test123";
  // Simulate the bug: lastProactiveAt was advanced by the time-based
  // no-response penalty (proactive-scheduler.ts:823), so it is far in the
  // past even though an insight was delivered recently.
  persona.feedbackProfile.lastProactiveAt = Date.now() - 2 * 60 * 60 * 1000;
  await store.save("main", "ou_test123", persona);
}

async function readFeedback(stateDir: string, insightId: string): Promise<string | undefined> {
  const store = new InsightStore(stateDir);
  const record = await store.load("main", "ou_test123", insightId);
  return record?.feedback;
}

async function readTrust(stateDir: string): Promise<number> {
  const store = new PersonaStore(stateDir);
  const persona = await store.load("main", "ou_test123");
  return persona?.rapport.trustScore ?? -1;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForFeedback(
  stateDir: string,
  insightId: string,
  timeoutMs = 3000,
): Promise<string | undefined> {
  const deadline = Date.now() + timeoutMs;
  let feedback: string | undefined;
  while (Date.now() < deadline) {
    feedback = await readFeedback(stateDir, insightId);
    if (feedback !== undefined) {
      return feedback;
    }
    await sleep(25);
  }
  return feedback;
}

describe("detectInsightFollowupFeedback full pipeline", () => {
  afterEach(() => {
    hoisted.dispatchReplyFromConfigMock.mockReset();
  });

  it("captures feedback when deliveredAt is within the window even if lastProactiveAt is stale", async () => {
    await withFeedbackSandbox(async ({ stateDir }) => {
      const deliveredAt = Date.now() - 5 * 60 * 1000;
      const insightId = await seedInsightWithDelivery(stateDir, deliveredAt);
      await seedPersonaWithStaleLastProactive(stateDir);

      hoisted.dispatchReplyFromConfigMock.mockImplementation(async () => ({ text: "ok" }));

      const ctx = buildTestCtx({
        Body: "建筑的承重路径和代码结构确实很像，AI agent的探路也是结构问题",
        CommandBody: "建筑的承重路径和代码结构确实很像，AI agent的探路也是结构问题",
        SessionKey: "agent:main:feishu:direct:ou_test123",
        Provider: "feishu",
        Surface: "feishu",
        From: "ou_test123",
        To: "bot",
        ChatType: "direct",
      });
      const cfg = { cognitive: { enabled: true } } as unknown as KaijiBotConfig;

      await dispatchInboundMessage({ ctx, cfg, dispatcher: createDispatcher() });

      expect(await waitForFeedback(stateDir, insightId)).toBe("engaged");
      expect(await readTrust(stateDir)).toBeGreaterThan(0.1);
    });
  });

  it("does NOT capture feedback when the delivered insight is outside the window", async () => {
    await withFeedbackSandbox(async ({ stateDir }) => {
      const deliveredAt = Date.now() - 2 * 60 * 60 * 1000;
      const insightId = await seedInsightWithDelivery(stateDir, deliveredAt);
      await seedPersonaWithStaleLastProactive(stateDir);

      hoisted.dispatchReplyFromConfigMock.mockImplementation(async () => ({ text: "ok" }));

      const ctx = buildTestCtx({
        Body: "建筑的承重路径和代码结构确实很像，AI agent的探路也是结构问题",
        CommandBody: "建筑的承重路径和代码结构确实很像，AI agent的探路也是结构问题",
        SessionKey: "agent:main:feishu:direct:ou_test123",
        Provider: "feishu",
        Surface: "feishu",
        From: "ou_test123",
        To: "bot",
        ChatType: "direct",
      });
      const cfg = { cognitive: { enabled: true } } as unknown as KaijiBotConfig;

      await dispatchInboundMessage({ ctx, cfg, dispatcher: createDispatcher() });

      await sleep(150);
      expect(await readFeedback(stateDir, insightId)).toBeUndefined();
    });
  });

  it("does NOT capture unrelated messages even inside the window", async () => {
    await withFeedbackSandbox(async ({ stateDir }) => {
      const deliveredAt = Date.now() - 5 * 60 * 1000;
      const insightId = await seedInsightWithDelivery(stateDir, deliveredAt);
      await seedPersonaWithStaleLastProactive(stateDir);

      hoisted.dispatchReplyFromConfigMock.mockImplementation(async () => ({ text: "ok" }));

      const ctx = buildTestCtx({
        Body: "帮我查一下明天的天气",
        CommandBody: "帮我查一下明天的天气",
        SessionKey: "agent:main:feishu:direct:ou_test123",
        Provider: "feishu",
        Surface: "feishu",
        From: "ou_test123",
        To: "bot",
        ChatType: "direct",
      });
      const cfg = { cognitive: { enabled: true } } as unknown as KaijiBotConfig;

      await dispatchInboundMessage({ ctx, cfg, dispatcher: createDispatcher() });

      await sleep(150);
      expect(await readFeedback(stateDir, insightId)).toBeUndefined();
    });
  });

  it("captures followup-request pattern as positive feedback", async () => {
    await withFeedbackSandbox(async ({ stateDir }) => {
      const deliveredAt = Date.now() - 5 * 60 * 1000;
      const insightId = await seedInsightWithDelivery(stateDir, deliveredAt);
      await seedPersonaWithStaleLastProactive(stateDir);

      hoisted.dispatchReplyFromConfigMock.mockImplementation(async () => ({ text: "ok" }));

      const ctx = buildTestCtx({
        Body: "展开解释一下这个洞察是什么意思",
        CommandBody: "展开解释一下这个洞察是什么意思",
        SessionKey: "agent:main:feishu:direct:ou_test123",
        Provider: "feishu",
        Surface: "feishu",
        From: "ou_test123",
        To: "bot",
        ChatType: "direct",
      });
      const cfg = { cognitive: { enabled: true } } as unknown as KaijiBotConfig;

      await dispatchInboundMessage({ ctx, cfg, dispatcher: createDispatcher() });

      expect(await waitForFeedback(stateDir, insightId)).toBe("positive");
    });
  });

  it("skips when cognitive is disabled", async () => {
    await withFeedbackSandbox(async ({ stateDir }) => {
      const deliveredAt = Date.now() - 5 * 60 * 1000;
      const insightId = await seedInsightWithDelivery(stateDir, deliveredAt);
      await seedPersonaWithStaleLastProactive(stateDir);

      hoisted.dispatchReplyFromConfigMock.mockImplementation(async () => ({ text: "ok" }));

      const ctx = buildTestCtx({
        Body: "建筑的承重路径和代码结构确实很像，AI agent的探路也是结构问题",
        CommandBody: "建筑的承重路径和代码结构确实很像，AI agent的探路也是结构问题",
        SessionKey: "agent:main:feishu:direct:ou_test123",
        Provider: "feishu",
        Surface: "feishu",
        From: "ou_test123",
        To: "bot",
        ChatType: "direct",
      });
      const cfg = { cognitive: { enabled: false } } as unknown as KaijiBotConfig;

      await dispatchInboundMessage({ ctx, cfg, dispatcher: createDispatcher() });

      await sleep(150);
      expect(await readFeedback(stateDir, insightId)).toBeUndefined();
    });
  });
});
