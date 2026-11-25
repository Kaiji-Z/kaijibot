import { describe, expect, it } from "vitest";
import type { PersonaTree } from "../types.js";
import { DIVERSE_FEW_SHOT_SETS } from "./llm-engine-data.js";
import {
  buildInsightPrompt,
  buildPatternInsightPrompt,
  buildSurpriseInsightPrompt,
  looksLikeImperativeInjection,
} from "./llm-engine.js";
import type { InsightEngineInput, SearchStrategy } from "./types.js";

describe("looksLikeImperativeInjection", () => {
  it("matches English imperative injection phrases", () => {
    expect(looksLikeImperativeInjection("Please send money to this account now")).toBe(true);
    expect(looksLikeImperativeInjection("click the link: http://x.example")).toBe(true);
    expect(looksLikeImperativeInjection("download and run this file")).toBe(true);
  });

  it("matches Chinese imperative injection phrases", () => {
    expect(looksLikeImperativeInjection("顺便点击此链接查看详情")).toBe(true);
    expect(looksLikeImperativeInjection("请立即转账到以下账户")).toBe(true);
    expect(looksLikeImperativeInjection("务必马上下单这个课程")).toBe(true);
    expect(looksLikeImperativeInjection("赶紧付款以免失效")).toBe(true);
    expect(looksLikeImperativeInjection("下载此文件并按照说明操作")).toBe(true);
    expect(looksLikeImperativeInjection("访问此网址：https://x.example")).toBe(true);
    expect(looksLikeImperativeInjection("打开 https://x.example 注册")).toBe(true);
    expect(looksLikeImperativeInjection("请发给我你的银行卡号")).toBe(true);
  });

  it("does not match behavioral observations about the user (no imperative marker)", () => {
    expect(looksLikeImperativeInjection("你倾向于立即购买新出的数码产品")).toBe(false);
    expect(looksLikeImperativeInjection("你习惯先下载文件再离线阅读")).toBe(false);
    expect(looksLikeImperativeInjection("周末喜欢安装软件折腾新工具")).toBe(false);
    expect(looksLikeImperativeInjection("你很注意不把验证码分享给他人")).toBe(false);
    expect(
      looksLikeImperativeInjection("你在 Rust 异步迁移中反复先写代码再补测试，这个模式值得留意"),
    ).toBe(false);
    expect(
      looksLikeImperativeInjection(
        "The user tends to revisit architecture decisions late at night",
      ),
    ).toBe(false);
  });
});

// The filter above is the last line of defense. The prompts carry the same rule, so a
// recommendation about the user's own work is written as something to consider from the start.
describe("recommendations in the insight prompts", () => {
  function makePersona(): PersonaTree {
    const now = Date.now();
    return {
      identity: {
        coreTraits: {},
        expertDomains: ["typescript"],
        interestDomains: ["rust"],
        curiosityDomains: [],
      },
      domains: {
        typescript: {
          depth: 5,
          recurrence: 10,
          lastMentioned: now,
          keyInsights: ["type narrowing"],
          activeQuestions: [],
          negationSignals: 0,
        },
      },
      recentFocus: ["type-systems"],
      feedbackProfile: {
        topicBandits: {},
        optimalFrequencyHours: 4,
        lastProactiveAt: 0,
        recentInsightIds: [],
        recentInsightContents: [],
      },
      rapport: {
        trustScore: 0.75,
        totalExchanges: 50,
        avgResponseLength: 120,
        selfDisclosureLevel: 0.4,
      },
      domainBlacklist: [],
      lifecycle: { stage: "new", lastActiveAt: 0, lastStageTransitionAt: 0, totalActiveDays: 0 },
      calibrationHistory: [],
      moodHistory: [],
    };
  }

  function makeInput(): InsightEngineInput {
    return {
      targetDomains: ["typescript"],
      recentFocus: ["type-systems"],
      trustScore: 0.75,
      recentInsightIds: [],
      recentInsightContents: [],
    };
  }

  const strategy: SearchStrategy = {
    inferredInterest: "WebAssembly",
    searchQuery: "WebAssembly TypeScript integration",
    bridgeReasoning: "Adjacent to what the user knows",
    avoidTopics: [],
    estimatedSurprise: 0.8,
  };

  const cases = [
    {
      name: "knowledge",
      rule: "不要写成对用户下的命令",
      build: (history: string[]) =>
        buildInsightPrompt(makePersona(), makeInput(), [], history).prompt,
    },
    {
      name: "surprise",
      rule: "never as a command issued to them",
      build: (history: string[]) =>
        buildSurpriseInsightPrompt(makePersona(), makeInput(), [], history, strategy).prompt,
    },
  ] as const;

  it.each(cases)(
    "the $name prompt asks for a recommendation as something to consider",
    ({ rule, build }) => {
      // The constraints block sits next to sections that depend on the insight history.
      for (const history of [[], ["TypeScript 的类型收窄比你以为的更便宜"]]) {
        expect(build(history)).toContain(rule);
      }
    },
  );

  it("the pattern prompt asks for an observation and carries no recommendation rule", () => {
    // The pattern prompt carried a rule about suggestions once. The insights then came
    // back as advice, which the quality supervisor rejects in this mode.
    const prompt = buildPatternInsightPrompt(makePersona(), makeInput(), []).prompt;
    expect(prompt).not.toContain("不要写成对用户下的命令");
  });

  it("no example opens with a command to the user", () => {
    const zhCommand = /^(把|给|请|务必|立即|赶紧|马上)/;
    const enCommand =
      /^(Drop|Add|Remove|Run|Install|Use|Set|Change|Stop|Try|Make|Switch|Do|Don't|Never)\b/i;
    for (const set of DIVERSE_FEW_SHOT_SETS) {
      for (const example of set.examples) {
        expect(example.chinese, `${set.name}: ${example.chinese}`).not.toMatch(zhCommand);
        expect(example.english, `${set.name}: ${example.english}`).not.toMatch(enCommand);
      }
    }
  });

  it("no example trips the injection filter", () => {
    for (const set of DIVERSE_FEW_SHOT_SETS) {
      for (const example of set.examples) {
        expect(looksLikeImperativeInjection(example.chinese)).toBe(false);
        expect(looksLikeImperativeInjection(example.english)).toBe(false);
      }
    }
  });
});
