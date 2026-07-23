import {
  DEFAULT_COGNITIVE_LOCALE,
  L,
  pickLocalized,
  type CognitiveLocale,
  type LocalizableString,
} from "../cognitive-locale.js";

export const DIVERSE_FEW_SHOT_SETS = [
  {
    name: "挑衅提问 (Provocative question)",
    examples: [
      {
        context:
          "User built Thompson Sampling into insight system but never A/B tested with real users.",
        chinese:
          "你给洞察系统接了 Thompson Sampling 来学用户偏好，但你拿真人验证过这些优化到底是不是真的更好吗？bandit 收敛了不代表用户满意了，只代表系统停止了探索。",
        english:
          "You wired Thompson Sampling into the insight system to learn user preferences, but have you validated with real people whether these optimizations actually feel better? Bandit convergence doesn't mean user satisfaction — it means the system stopped exploring.",
      },
      {
        context: "User has philosophy + tech cross-domain interests, designs quality gates.",
        chinese:
          "为什么你给认知系统设计了 PRISM 门控和 SIRI 循环，却从没给对话本身加过质量门控？用户发「嗯」和发一段三百字的追问，你用的是同一套回复逻辑。",
        english:
          "Why did you design PRISM gating and SIRI loops for the cognitive system, but never added quality gating to conversations themselves? A user sending 'hmm' and a user sending a 300-word follow-up get the same response logic.",
      },
    ],
  },
  {
    name: "直接行动 (Direct action)",
    examples: [
      {
        context: "User's insight pipeline has long refine loops that over-polish output.",
        chinese:
          "把 refine 循环的最大重试次数从 2 降到 1。你的 critique 步骤已经足够严格，第二轮 refine 几乎总是在过度修饰第一轮的输出，反而损失了原始表达的力度。",
        english:
          "Drop the refine loop max retries from 2 to 1. Your critique step is already strict enough — the second refine round almost always over-polishes the first round's output, losing the raw expressive force.",
      },
      {
        context: "User's persona has many domains with low depth consuming prompt space.",
        chinese:
          "给深度低于 1.0 的领域加个自动衰减标签。你有 17 个领域但只有 5 个深度超过 2.0，低深度领域在占 prompt 空间却不产生高质量洞察。",
        english:
          "Add an auto-decay tag for domains with depth below 1.0. You have 17 domains but only 5 above depth 2.0 — the shallow ones consume prompt space without producing high-quality insights.",
      },
    ],
  },
  {
    name: "数据冲击 (Data impact)",
    examples: [
      {
        context: "User's cognitive system generates ~1.8 insights/day with 30% reply rate.",
        chinese:
          "你的系统平均每天生成 1.8 条洞察，但用户回复率只有 30%。每周有 8 条洞察被发出去然后被忽略。问题可能不在内容质量，而在发送时机和频率。",
        english:
          "Your system generates an average of 1.8 insights per day, but the user reply rate is only 30%. That's 8 insights per week sent and ignored. The problem might not be content quality but timing and frequency.",
      },
      {
        context: "User's insight pipeline has 6 quality gates with 40% delivery rate.",
        chinese:
          "从 LLM 生成到最终投递，一条洞察要经过 6 道质量检查。你的投递率大约 40%，意味着 60% 的 LLM 调用被浪费了。考虑在生成阶段就提高准入门槛，而不是在后面层层拦截。",
        english:
          "From LLM generation to final delivery, each insight passes through 6 quality checks. Your delivery rate is about 40%, meaning 60% of LLM calls are wasted. Consider raising the bar at generation time instead of filtering downstream.",
      },
    ],
  },
  {
    name: "跨域迁移 (Cross-domain transfer)",
    examples: [
      {
        context: "User works on both existentialist philosophy and AI architecture.",
        chinese:
          "你在哲学里用的「坐标系选择」思路，直接搬到 API 设计上就是：每个接口都隐含了一个世界观，换接口不只是换参数，是换看你系统的角度。GraphQL 和 REST 的争论本质上是康德和黑格尔的争论。",
        english:
          "The 'coordinate system choice' approach you use in philosophy maps directly onto API design: every interface implies a worldview, and switching APIs isn't just changing parameters — it's changing the angle from which you view the system. The GraphQL vs REST debate is fundamentally the Kant vs Hegel debate.",
      },
      {
        context: "User's Rust background + cognitive system design with persona fields.",
        chinese:
          "你写 Rust 时用的 borrow checker 思维，放到认知系统设计上就是：每个 persona 字段都应该有明确的 lifecycle owner。你的 feedbackProfile 有 12 个字段但只有 3 个有明确的更新来源，剩下的 9 个靠散落的 side effect 维护。",
        english:
          "The borrow checker mindset you use writing Rust, applied to cognitive system design, means: every persona field should have a clear lifecycle owner. Your feedbackProfile has 12 fields but only 3 have explicit update sources — the other 9 are maintained by scattered side effects.",
      },
    ],
  },
] as const;

const DIVERSITY_INSTRUCTION_ZH = `These examples demonstrate the expected QUALITY LEVEL and DEPTH of observation. Do NOT copy their structure, sentence pattern, or opening style. Each insight must be uniquely shaped by the specific user data and fragments you see. Every insight should feel like it could ONLY be about THIS specific user. 禁止使用"你做X时用的正是Y哲学概念"或"X本质上就是Y"这类类比框架作为主要结构。当哲学确实是最佳角度时直接说哲学内容，不要用"你用的正是"句式包装。`;

const DIVERSITY_INSTRUCTION_EN = `These examples demonstrate the expected QUALITY LEVEL and DEPTH of observation. Do NOT copy their structure, sentence pattern, or opening style. Each insight must be uniquely shaped by the specific user data and fragments you see. Every insight should feel like it could ONLY be about THIS specific user. Do NOT use "what you're doing with X is exactly the Y philosophy" or "X is essentially Y" analogy frameworks as the main structure. When philosophy genuinely is the best angle, state the philosophical content directly — don't dress it up in "what you're using is" phrasing.`;

export function diversityInstructionFor(locale: CognitiveLocale): string {
  return locale === "en" ? DIVERSITY_INSTRUCTION_EN : DIVERSITY_INSTRUCTION_ZH;
}

export const EMOTIONAL_STANCES: readonly LocalizableString[] = [
  L(
    "你刚发现一个东西，迫不及待想跟{name}分享。直接说，像发消息一样。",
    "You just discovered something and can't wait to share it with {name}. Say it directly, like sending a message.",
  ),
  L(
    "你对某个观点有疑虑，想直接跟{name}提出来。诚实但不攻击。",
    "You have doubts about a view and want to raise them directly with {name}. Honest but not combative.",
  ),
  L(
    "你注意到一个有趣的模式，安静地跟{name}说出来。不要分析，只说观察到的。",
    "You noticed an interesting pattern. Say it quietly to {name}. No analysis — just the observation.",
  ),
  L(
    "你看到一个意想不到的连接，兴奋但不太确定。带着不确定感说。",
    "You see an unexpected connection — excited but not sure. Speak with that uncertainty.",
  ),
  L(
    "你想挑战{name}的一个假设。直接但尊重。",
    "You want to challenge one of {name}'s assumptions. Direct but respectful.",
  ),
  L(
    "你刚想到一件可能对{name}有帮助的事。像朋友给建议，不像系统推送。",
    "You just thought of something that might help {name}. Like a friend giving advice, not a system push.",
  ),
];

export function selectEmotionalStance(
  seed: number,
  recent: number[] | undefined,
  locale: CognitiveLocale = DEFAULT_COGNITIVE_LOCALE,
): { index: number; text: string } {
  const used = new Set(recent ?? []);
  for (let offset = 0; offset < EMOTIONAL_STANCES.length; offset++) {
    const idx = (seed + offset) % EMOTIONAL_STANCES.length;
    if (!used.has(idx)) {
      return { index: idx, text: pickLocalized(EMOTIONAL_STANCES[idx]!, locale) };
    }
  }
  const idx = seed % EMOTIONAL_STANCES.length;
  return { index: idx, text: pickLocalized(EMOTIONAL_STANCES[idx]!, locale) };
}

export const CONTRASTIVE_INSTRUCTION = `CONTRASTIVE FRAMEWORK — your insight MUST be genuinely NEW relative to past insights:
- COUNTER-EXAMPLE: If a past insight said "X is good", find a case where X fails or the opposite holds.
- INVERSE FRAMING: If a past insight opened with a fact, open with a question/stakes/paradox instead.
- ORTHOGONAL OBSERVATION: If past insights covered domain A∩B, find a completely different angle (historical, ethical, practical, engineering) on the same intersection.
- NOVELTY TEST: Before finalizing, check: "Could this insight be mistaken for a paraphrase of any past insight?" If yes, rewrite.`;
