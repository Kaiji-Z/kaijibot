import { describe, expect, it } from "vitest";
import { buildCognitiveModePrompt } from "./context-writer.js";
import type { CorrectionRecord } from "./correction/types.js";
import type { InsightCandidate } from "./insight/types.js";
import { createDefaultPersona } from "./persona/store.js";
import type { PersonaTree } from "./types.js";

describe("buildCognitiveModePrompt", () => {
  it("includes Skill Evolution hint when evolutionEnabled is true", () => {
    const { prompt } = buildCognitiveModePrompt({
      message: "帮我整理文档",
      cognitiveEnabled: true,
      evolutionEnabled: true,
    });
    expect(prompt).toContain("Skill Evolution");
    expect(prompt).toContain("evaluate_skill_evolution");
    expect(prompt).toContain("[Evolution Signal]");
    expect(prompt).toContain("patch_skill");
    expect(prompt).toContain("自主判断");
    expect(prompt).toContain("自主进化");
    expect(prompt).toContain("绝不能静默处理");
    expect(prompt).not.toContain("技能草稿");
    expect(prompt).not.toContain("让用户审核");
  });

  it("includes Skill Evolution hint when evolutionEnabled is undefined (default)", () => {
    const { prompt } = buildCognitiveModePrompt({
      message: "帮我整理文档",
      cognitiveEnabled: true,
    });
    expect(prompt).toContain("Skill Evolution");
  });

  it("omits Skill Evolution hint when evolutionEnabled is false", () => {
    const { prompt } = buildCognitiveModePrompt({
      message: "帮我整理文档",
      cognitiveEnabled: true,
      evolutionEnabled: false,
    });
    expect(prompt).not.toContain("Skill Evolution");
  });

  it("omits Skill Evolution hint when cognitiveEnabled is false", () => {
    const { prompt } = buildCognitiveModePrompt({
      message: "帮我整理文档",
      cognitiveEnabled: false,
      evolutionEnabled: true,
    });
    expect(prompt).toBe("");
  });

  it("returns classification with correct mode", () => {
    const { classification } = buildCognitiveModePrompt({
      message: "帮我整理文档",
    });
    expect(classification.mode).toBe("task");
    expect(classification.confidence).toBeGreaterThan(0);
  });

  it("includes correction section when corrections provided", () => {
    const corrections: CorrectionRecord[] = [
      {
        id: "test",
        domain: "test",
        trigger: "创建飞书文档",
        mistake: "只传标题",
        correction: "要写入正文",
        provenance: "user",
        reinforcedCount: 1,
        createdAt: Date.now(),
        lastReinforced: Date.now(),
      },
    ];
    const { prompt } = buildCognitiveModePrompt({
      message: "test",
      corrections,
    });
    expect(prompt).toContain("Known Corrections");
    expect(prompt).toContain("创建飞书文档");
  });

  it("omits correction section when corrections array is empty", () => {
    const { prompt } = buildCognitiveModePrompt({
      message: "test",
      corrections: [],
    });
    expect(prompt).not.toContain("Known Corrections");
  });

  it("places stable sections (evolution, corrections) before dynamic mode section for cache stability", () => {
    const corrections: CorrectionRecord[] = [
      {
        id: "test",
        domain: "test",
        trigger: "test trigger",
        mistake: "test mistake",
        correction: "test correction",
        provenance: "user",
        reinforcedCount: 1,
        createdAt: Date.now(),
        lastReinforced: Date.now(),
      },
    ];
    const { prompt } = buildCognitiveModePrompt({
      message: "帮我整理文档",
      cognitiveEnabled: true,
      evolutionEnabled: true,
      corrections,
    });

    const evolutionIdx = prompt.indexOf("## Skill Evolution");
    const correctionsIdx = prompt.indexOf("## Known Corrections");
    const modeIdx = prompt.indexOf("## Current Mode:");

    expect(evolutionIdx).toBeGreaterThan(-1);
    expect(correctionsIdx).toBeGreaterThan(-1);
    expect(modeIdx).toBeGreaterThan(-1);
    expect(evolutionIdx).toBeLessThan(modeIdx);
    expect(correctionsIdx).toBeLessThan(modeIdx);
  });
});

describe("Continuity Handshake", () => {
  const HR = 3600_000;

  function makePersonaWithGap(hoursAgo: number): PersonaTree {
    const persona = createDefaultPersona();
    persona.lifecycle.lastActiveAt = Date.now() - hoursAgo * HR;
    persona.identity.displayName = "小明";
    persona.recentFocus = ["Rust 异步", "飞书机器人"];
    return persona;
  }

  it("injects handshake section when gap >= default minGapHours (6)", () => {
    const persona = makePersonaWithGap(8);
    const { prompt } = buildCognitiveModePrompt({
      message: "你好",
      persona,
    });
    expect(prompt).toContain("## Continuity Handshake");
    expect(prompt).toContain("小明");
    expect(prompt).toContain("Rust 异步");
  });

  it("omits handshake when gap < minGapHours", () => {
    const persona = makePersonaWithGap(2);
    const { prompt } = buildCognitiveModePrompt({
      message: "你好",
      persona,
    });
    expect(prompt).not.toContain("## Continuity Handshake");
  });

  it("omits handshake when handshakeConfig.enabled is false", () => {
    const persona = makePersonaWithGap(48);
    const { prompt } = buildCognitiveModePrompt({
      message: "你好",
      persona,
      handshakeConfig: { enabled: false },
    });
    expect(prompt).not.toContain("## Continuity Handshake");
  });

  it("respects custom minGapHours", () => {
    const persona = makePersonaWithGap(3);
    const { prompt } = buildCognitiveModePrompt({
      message: "你好",
      persona,
      handshakeConfig: { minGapHours: 2 },
    });
    expect(prompt).toContain("## Continuity Handshake");
  });

  it("includes undelivered insight as a cue when pendingInsightDelivery provided", () => {
    const persona = makePersonaWithGap(12);
    const candidate: InsightCandidate = {
      id: "insight-1",
      content: "你在 Rust 异步和飞书机器人之间找到了有趣的连接",
      rationale: "cross-domain link",
      targetDomains: ["AI"],
      sourceDomains: [],
      relevanceScore: 0.8,
      surpriseScore: 0.7,
      compositeScore: 0.75,
      sources: [],
      verificationStatus: "verified",
      resolvedMode: "surprise",
    };
    const { prompt } = buildCognitiveModePrompt({
      message: "你好",
      persona,
      pendingInsightDelivery: {
        candidate,
        generatedAt: Date.now() - 2 * 24 * HR,
        opportunityType: "cross_domain",
      },
    });
    expect(prompt).toContain("未送达");
    expect(prompt).toContain("Rust 异步和飞书机器人");
  });

  it("omits insight cue when pendingInsightDelivery is null", () => {
    const persona = makePersonaWithGap(12);
    const { prompt } = buildCognitiveModePrompt({
      message: "你好",
      persona,
      pendingInsightDelivery: null,
    });
    expect(prompt).toContain("## Continuity Handshake");
    expect(prompt).not.toContain("未送达");
    expect(prompt).not.toContain("洞察");
  });

  it("omits handshake when persona.lifecycle.lastActiveAt is 0", () => {
    const persona = createDefaultPersona();
    persona.lifecycle.lastActiveAt = 0;
    const { prompt } = buildCognitiveModePrompt({
      message: "你好",
      persona,
    });
    expect(prompt).not.toContain("## Continuity Handshake");
  });

  it("places handshake after persona context but before mode section", () => {
    const persona = makePersonaWithGap(8);
    const { prompt } = buildCognitiveModePrompt({
      message: "帮我整理文档",
      cognitiveEnabled: true,
      evolutionEnabled: true,
      persona,
    });
    const personaIdx = prompt.indexOf("## User Cognitive Profile");
    const handshakeIdx = prompt.indexOf("## Continuity Handshake");
    const modeIdx = prompt.indexOf("## Current Mode:");
    expect(personaIdx).toBeGreaterThan(-1);
    expect(handshakeIdx).toBeGreaterThan(personaIdx);
    expect(modeIdx).toBeGreaterThan(handshakeIdx);
  });
});
