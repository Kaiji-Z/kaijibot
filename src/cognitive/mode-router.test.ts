import { describe, expect, it } from "vitest";
import type { CognitiveMode, ModeClassification } from "./types.js";
import { classifyMode, buildModePromptSection } from "./mode-router.js";

describe("classifyMode", () => {
  describe("proactive mode", () => {
    it("classifies heartbeat as proactive", () => {
      const result = classifyMode("check pending tasks", {
        isHeartbeat: true,
      });
      expect(result.mode).toBe("proactive");
      expect(result.confidence).toBe(1.0);
      expect(result.signals).toContain("system-initiated");
    });

    it("classifies cron as proactive", () => {
      const result = classifyMode("daily digest", { isCron: true });
      expect(result.mode).toBe("proactive");
    });
  });

  describe("task mode", () => {
    it("classifies slash commands as task", () => {
      const result = classifyMode("/status");
      expect(result.mode).toBe("task");
      expect(result.confidence).toBeGreaterThanOrEqual(0.99);
    });

    it("classifies imperative + file path as task", () => {
      const result = classifyMode("帮我打开 /home/user/doc.txt 文件");
      expect(result.mode).toBe("task");
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it("classifies English imperative + URL as task", () => {
      const result = classifyMode("Send this to https://example.com");
      expect(result.mode).toBe("task");
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it("classifies Chinese imperative as task", () => {
      const result = classifyMode("帮我发个消息给张三");
      expect(result.mode).toBe("task");
    });

    it("classifies execution commands as task", () => {
      const result = classifyMode("运行 test.sh 脚本");
      expect(result.mode).toBe("task");
    });

    it("classifies English task commands as task", () => {
      const result = classifyMode("Create a new file called config.json");
      expect(result.mode).toBe("task");
    });

    it("classifies 'list' commands as task", () => {
      const result = classifyMode("列出所有文件");
      expect(result.mode).toBe("task");
    });
  });

  describe("insight mode", () => {
    it("classifies philosophical Chinese questions as insight", () => {
      const result = classifyMode("你怎么看待 AI 的未来？");
      expect(result.mode).toBe("insight");
    });

    it("classifies 'what do you think' as insight", () => {
      const result = classifyMode("What do you think about microservices?");
      expect(result.mode).toBe("insight");
    });

    it("classifies exploratory Chinese as insight", () => {
      const result = classifyMode("聊聊你对 RAG 架构的看法");
      expect(result.mode).toBe("insight");
    });

    it("classifies 'what if' as insight", () => {
      const result = classifyMode("What if we used event sourcing here?");
      expect(result.mode).toBe("insight");
    });

    it("classifies 'I wonder' as insight", () => {
      const result = classifyMode("I wonder whether monorepos are worth it");
      expect(result.mode).toBe("insight");
    });

    it("classifies Chinese thinking markers as insight", () => {
      const result = classifyMode("最近在思考分布式系统的思路");
      expect(result.mode).toBe("insight");
    });

    it("classifies '分析一下' as insight", () => {
      const result = classifyMode("分析一下这两个方案的优劣");
      expect(result.mode).toBe("insight");
    });
  });

  describe("hybrid mode", () => {
    it("defaults to hybrid for ambiguous input", () => {
      const result = classifyMode("hello");
      expect(result.mode).toBe("hybrid");
    });

    it("returns hybrid for imperative + exploratory mix", () => {
      const result = classifyMode("帮我看看这个架构方案，你觉得有什么改进空间？");
      expect(result.mode).toBe("hybrid");
    });
  });

  describe("context-aware classification", () => {
    it("continues task streak from context", () => {
      const result = classifyMode("then update the config", {
        recentModes: ["task", "task", "task"],
      });
      expect(result.mode).toBe("task");
    });

    it("continues insight streak from context", () => {
      const result = classifyMode("and what about the data layer", {
        recentModes: ["insight", "insight", "insight"],
      });
      expect(result.mode).toBe("insight");
    });
  });

  describe("edge cases", () => {
    it("handles empty message", () => {
      const result = classifyMode("");
      expect(result.mode).toBe("hybrid");
    });

    it("handles whitespace-only message", () => {
      const result = classifyMode("   ");
      expect(result.mode).toBe("hybrid");
    });

    it("always returns signals", () => {
      const result = classifyMode("anything");
      expect(result.signals.length).toBeGreaterThan(0);
    });

    it("confidence is always between 0 and 1", () => {
      const messages = [
        "帮我发消息",
        "What do you think?",
        "/status",
        "hello",
        "创建 /tmp/test.txt",
        "聊聊你对未来的想法",
      ];
      for (const msg of messages) {
        const result = classifyMode(msg);
        expect(result.confidence).toBeGreaterThanOrEqual(0);
        expect(result.confidence).toBeLessThanOrEqual(1);
      }
    });
  });
});

describe("buildModePromptSection", () => {
  const modes: CognitiveMode[] = ["task", "insight", "hybrid", "proactive"];

  it("returns non-empty string for all modes", () => {
    for (const mode of modes) {
      const section = buildModePromptSection(mode);
      expect(section.length).toBeGreaterThan(0);
      expect(section).toContain("Mode:");
    }
  });

  it("task mode mentions execution", () => {
    const section = buildModePromptSection("task");
    expect(section).toMatch(/execute|task/i);
  });

  it("insight mode mentions thinking partner", () => {
    const section = buildModePromptSection("insight");
    expect(section).toMatch(/thinking|partner|insight/i);
  });

  it("proactive mode mentions proactive", () => {
    const section = buildModePromptSection("proactive");
    expect(section).toMatch(/proactive/i);
  });
});
