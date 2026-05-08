import { describe, expect, it } from "vitest";
import { buildCognitiveModePrompt } from "./context-writer.js";
import type { CorrectionRecord } from "./correction/types.js";

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
});
