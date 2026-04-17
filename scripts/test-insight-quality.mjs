#!/usr/bin/env node
/**
 * KaijiBot Cognitive Insight Quality Tester
 *
 * Tests insight generation with different persona scenarios.
 * Mirrors the production prompt from llm-engine.ts.
 * Evaluates output on 6 dimensions.
 *
 * Usage: ZAI_API_KEY=xxx node scripts/test-insight-quality.mjs
 */

// ─── Config ──────────────────────────────────────────────────────────────
const API_KEY = process.env.ZAI_API_KEY;
const API_URL = "https://open.bigmodel.cn/api/paas/v4/chat/completions";
const MODEL = "glm-5-turbo";
const ROUNDS = 3;

// ─── Eval Dimensions ─────────────────────────────────────────────────────
const EVAL_CRITERIA = [
  { id: "relevance", name: "用户相关性", desc: "洞察是否跟用户近期工作/兴趣直接相关" },
  { id: "natural", name: "自然度", desc: "读起来像朋友想到什么要跟你分享" },
  { id: "specific", name: "具体性", desc: "包含具体的观察/判断/建议" },
  { id: "personalized", name: "个性化", desc: "利用了用户的 persona 信息" },
  { id: "inspiring", name: "启发性", desc: "让人觉得有道理、没这么想过" },
  { id: "non_template", name: "非模板化", desc: "句式不重复，每条独特" },
];

// ─── Persona Scenarios ──────────────────────────────────────────────────
const SCENARIOS = [
  {
    name: "全栈开发者（近期活跃）",
    persona: {
      identity: {
        displayName: "凯机",
        coreTraits: { technical: { value: "高", confidence: 0.9 }, style: { value: "务实", confidence: 0.8 } },
        expertDomains: ["AI/机器学习", "软件架构"],
        interestDomains: ["认知架构", "产品思维"],
      },
      domains: {
        "认知系统设计": { depth: 5, recurrence: 12, keyInsights: ["PRISM门控", "SIRI循环", "Persona双通道提取"], lastMentioned: Date.now() - 1000 * 60 * 30 },
        "飞书集成": { depth: 4, recurrence: 8, keyInsights: ["WebSocket长连接", "消息卡片"], lastMentioned: Date.now() - 1000 * 60 * 60 },
        "TypeScript": { depth: 5, recurrence: 20, keyInsights: ["Zod验证", "插件SDK类型设计"], lastMentioned: Date.now() - 1000 * 60 * 10 },
        "Prompt工程": { depth: 3, recurrence: 5, keyInsights: ["JSON mode", "anti-repetition"], lastMentioned: Date.now() - 1000 * 60 * 60 * 2 },
      },
      recentFocus: ["认知层洞察质量优化", "Persona提取过滤器", "LLM prompt调试"],
      pendingQuestions: ["如何让洞察更个性化而非模板化？"],
      domainGraph: { edges: [
        { source: "认知系统设计", target: "Prompt工程", observations: 8 },
        { source: "认知系统设计", target: "飞书集成", observations: 5 },
      ] },
      rapport: { trustScore: 0.85, totalExchanges: 362 },
      recentInsightContents: [
        "Python的GIL被人骂了这么多年，但换个角度看它其实做对了一件事...",
        "Rust的借用检查器被骂学习曲线陡，但它其实在做一件很罕见的事...",
        "Go的error处理被人吐槽写起来啰嗦，但它和Rust的Result其实做了同一件事...",
      ],
    },
    input: { targetDomains: ["认知系统设计"], sourceDomains: ["Prompt工程"], recentInsightIds: ["id1", "id2"] },
  },
  {
    name: "数据分析师（近期活跃）",
    persona: {
      identity: {
        displayName: "小林",
        coreTraits: { technical: { value: "中", confidence: 0.7 }, domain: { value: "金融数据", confidence: 0.9 } },
        expertDomains: ["数据分析", "SQL"],
        interestDomains: ["可视化", "机器学习入门"],
      },
      domains: {
        "SQL优化": { depth: 4, recurrence: 10, keyInsights: ["窗口函数性能", "CTE可读性"], lastMentioned: Date.now() - 1000 * 60 * 60 },
        "数据可视化": { depth: 3, recurrence: 6, keyInsights: ["ECharts交互", "Dashboard设计原则"], lastMentioned: Date.now() - 1000 * 60 * 30 },
        "Python数据处理": { depth: 4, recurrence: 15, keyInsights: ["pandas链式调用", "内存优化"], lastMentioned: Date.now() - 1000 * 60 * 10 },
      },
      recentFocus: ["Q1报表自动化", "异常检测模型调参", "Tableau vs ECharts对比"],
      pendingQuestions: ["如何减少报表生成时间？"],
      domainGraph: { edges: [
        { source: "SQL优化", target: "Python数据处理", observations: 12 },
        { source: "数据分析", target: "可视化", observations: 7 },
      ] },
      rapport: { trustScore: 0.7, totalExchanges: 150 },
      recentInsightContents: [
        "pandas的query方法比布尔索引慢30%，但可读性好得多...",
      ],
    },
    input: { targetDomains: ["数据可视化"], sourceDomains: ["SQL优化"], recentInsightIds: ["id3"] },
  },
  {
    name: "产品经理（非技术）",
    persona: {
      identity: {
        displayName: "Amy",
        coreTraits: { communication: { value: "强", confidence: 0.9 }, style: { value: "用户导向", confidence: 0.85 } },
        expertDomains: ["用户研究", "需求分析"],
        interestDomains: ["AI产品", "增长策略"],
      },
      domains: {
        "用户研究": { depth: 5, recurrence: 20, keyInsights: ["NPS方法论", "用户旅程地图", "A/B测试设计"], lastMentioned: Date.now() - 1000 * 60 * 60 },
        "AI产品设计": { depth: 3, recurrence: 5, keyInsights: ["对话式UI", "信任建立"], lastMentioned: Date.now() - 1000 * 60 * 30 },
        "增长策略": { depth: 2, recurrence: 3, keyInsights: ["PLG模式"], lastMentioned: Date.now() - 1000 * 60 * 60 * 24 },
      },
      recentFocus: ["AI助手用户留存分析", "新功能上线反馈收集", "竞品调研报告"],
      pendingQuestions: ["AI产品的用户信任如何量化？"],
      domainGraph: { edges: [
        { source: "用户研究", target: "AI产品设计", observations: 6 },
      ] },
      rapport: { trustScore: 0.6, totalExchanges: 80 },
      recentInsightContents: [],
    },
    input: { targetDomains: ["AI产品设计"], sourceDomains: ["用户研究"], recentInsightIds: [] },
  },
];

// ─── Helpers (mirroring llm-engine.ts) ────────────────────────────────────
function pickRandom(arr) {
  return arr.length > 0 ? arr[Math.floor(Math.random() * arr.length)] : undefined;
}

function getTimeTag(lastMentioned) {
  const hoursAgo = (Date.now() - lastMentioned) / (60 * 60 * 1000);
  if (hoursAgo < 24) return "active-today";
  if (hoursAgo < 72) return "recent";
  if (hoursAgo < 168) return "this-week";
  return "inactive";
}

function truncate(s, maxLen) {
  return s.length > maxLen ? s.slice(0, maxLen) + "…" : s;
}

const STRUCTURE_SEEDS = [
  "这次用一个具体的事实或数据点开头，不要用观点开头。",
  "这次先说结论或判断，再说原因，不要反过来。",
  "这次直接给一个可执行的建议，不要做分析。",
  "这次说一个具体的案例或例子，不要抽象概括。",
  "这次用一个反直觉的陈述开头。",
  "这次提出一个具体的技术选择或方案，说明为什么选它。",
  "这次指出一个常见的误区或错误做法，然后给出正确的方式。",
  "这次说一条暗线——两个看似无关的东西之间的隐藏联系。",
];

const PROMPT_FRAMES = [
  (topic, extra) => {
    const insight = pickRandom(extra.keyInsights);
    if (insight) {
      return `你了解到用户对"${insight}"有独到理解。从这个具体的认知出发，说出一个被大多数人忽略的延伸方向或实际应用场景。不要解释这个认知本身，直接说延伸的部分。`;
    }
    return `针对${topic}，你有一个具体的观察——不是泛泛的感受，而是能直接指导下一步行动的判断。直接说出来。`;
  },
  (topic, extra) => {
    if (extra.domains.length >= 2 && extra.keyInsights.length >= 2) {
      return `用户同时在${topic}和${extra.domains[extra.domains.length - 1]}两个方向有积累。你看到了一条具体的关联线索——不是概念上的相似，而是实际的、可操作的交集。直接把这条线索说出来。`;
    }
    return `在${topic}方向上，用户目前的理解里有一个盲区。你看到了，直接指出来，不要铺垫。`;
  },
  (topic, extra) => {
    if (extra.pendingQuestions.length > 0) {
      return `之前的问题是"${extra.pendingQuestions[0]}"。你现在的理解有了进展——不要复述问题，直接给出你最新的判断或发现。`;
    }
    return `你刚注意到${topic}领域一个具体的变化或案例，直接关系到用户之前提到的关注点。简洁地说出来。`;
  },
  (topic, extra) => {
    const insight = pickRandom(extra.keyInsights);
    if (insight) {
      return `基于"${insight}"这个认知，常见的做法里有一个效率或思路上的问题。你有一个更好的替代方案——说出来，说清楚为什么更好。`;
    }
    return `关于${topic}，你有一个来自实践的具体经验，跟大多数人的做法不一样。分享这个经验。`;
  },
  (topic, extra) => {
    const focus = extra.recentFocus.length > 0 ? pickRandom(extra.recentFocus) : topic;
    return `用户最近在看${focus}相关的东西。你恰好知道一个具体的工具、方法或资源能直接帮上忙。推荐它，说清楚为什么适合现在的阶段。`;
  },
  (topic, extra) => {
    const insight = pickRandom(extra.keyInsights);
    if (insight) {
      return `关于"${insight}"，有一个反直觉的事实。你把它说出来，用事实本身说话，不要加"有趣的是"之类的评论。`;
    }
    return `在${topic}领域，你发现了一条被低估的技术路径或思路。说出它是什么，以及为什么被低估。`;
  },
  (topic, extra) => {
    if (extra.recentFocus.length >= 1) {
      const focus = extra.recentFocus[Math.min(extra.recentFocus.length - 1, 1)];
      return `${topic}和${focus}之间有一条暗线——不是表面的关联，而是底层逻辑或设计理念的共通之处。直接说出这条暗线是什么。`;
    }
    return `你注意到${topic}领域有一个正在发生但还没被广泛讨论的变化。说出它是什么。`;
  },
  (topic, extra) => {
    if (extra.domains.length >= 2) {
      return `把${extra.domains[extra.domains.length - 1]}里的一个成熟做法，迁移到${topic}的场景中。说出具体的迁移方案和预期效果。`;
    }
    return `给${topic}方向一个具体的下一步建议——不是方向性的，而是可以直接执行的那种。`;
  },
];

function buildInsightPrompt(persona, input, recentInsightContents = []) {
  const sortedDomainEntries = Object.entries(persona.domains)
    .sort(([, a], [, b]) => b.lastMentioned - a.lastMentioned);

  const userDomains = sortedDomainEntries
    .slice(0, 8)
    .map(([name, d]) => {
      const recencyTag = getTimeTag(d.lastMentioned);
      const parts = [`${name} [${recencyTag}, depth: ${d.depth}]`];
      if (d.keyInsights.length > 0) {
        parts.push(`known: ${d.keyInsights.slice(0, 3).join("; ")}`);
      }
      return parts.join(" | ");
    })
    .join("\n");

  const anchorFacts = sortedDomainEntries
    .flatMap(([name, d]) => d.keyInsights.slice(0, 2).map((ki) => `${name}: ${ki}`))
    .slice(0, 6);
  const anchorBlock = anchorFacts.length > 0
    ? anchorFacts.map((f, i) => `${i + 1}. ${f}`).join("\n")
    : "  (not yet established)";

  const recentFocus = persona.recentFocus.slice(0, 5).join(", ");
  const pendingQuestions = persona.pendingQuestions.slice(0, 3).join("; ");
  const recentInsightIds = input.recentInsightIds.slice(0, 5).join(", ");

  const userName = persona.identity?.displayName || "";
  const identityBlock = persona.identity
    ? [
        userName ? `Name: ${userName}` : "",
        persona.identity.coreTraits
          ? `Traits: ${Object.entries(persona.identity.coreTraits)
              .filter(([, v]) => v.confidence >= 0.5)
              .map(([k, v]) => `${k}: ${v.value}`)
              .join(", ")}`
          : "",
        persona.identity.expertDomains?.length
          ? `Expert in: ${persona.identity.expertDomains.join(", ")}`
          : "",
        persona.identity.interestDomains?.length
          ? `Interested in: ${persona.identity.interestDomains.join(", ")}`
          : "",
      ].filter(Boolean).join("\n")
    : "";

  const pastInsightBlock = recentInsightContents.length > 0
    ? recentInsightContents.slice(-3).map((c, i) => `${i + 1}. ${truncate(c, 80)}`).join("\n")
    : "";

  const bannedOpenings = recentInsightContents
    .slice(-3)
    .map((c) => c.trim().slice(0, 8))
    .filter((o) => o.length >= 4);

  const coOccurrenceBlock = persona.domainGraph?.edges?.length > 0
    ? persona.domainGraph.edges
        .filter(e => e.observations >= 3)
        .sort((a, b) => b.observations - a.observations)
        .slice(0, 5)
        .map(e => `${e.source} ↔ ${e.target} (${e.observations}次共现)`)
        .join("\n")
    : "";

  const domainNames = sortedDomainEntries.map(([name]) => name);
  const flatKeyInsights = sortedDomainEntries.flatMap(([, d]) => d.keyInsights.slice(0, 2));
  const topic = input.targetDomains.length > 0 ? input.targetDomains[0] : "你的兴趣领域";
  const frame = PROMPT_FRAMES[Math.floor(Math.random() * PROMPT_FRAMES.length)];
  const promptFrame = frame(topic, {
    pendingQuestions: persona.pendingQuestions,
    domains: domainNames,
    keyInsights: flatKeyInsights,
    recentFocus: persona.recentFocus,
    userName,
  });

  const structureSeed = STRUCTURE_SEEDS[Math.floor(Math.random() * STRUCTURE_SEEDS.length)];
  const openingBans = bannedOpenings.length > 0
    ? bannedOpenings.map((o) => `不要以"${o}"开头`).join("；")
    : "";

  return `You are the AI assistant speaking in your own voice and personality. You are proactively reaching out to share something that crossed your mind — genuinely useful or surprising for THIS specific user.

${identityBlock ? `USER:\n${identityBlock}` : ""}

USER'S DOMAINS (sorted by recency — most active first):
${userDomains || "Not yet established"}
${coOccurrenceBlock ? `\nCROSS-DOMAIN CONNECTIONS:\n${coOccurrenceBlock}` : ""}

SPECIFIC FACTS YOU KNOW ABOUT THIS USER (your insight MUST reference at least one):
${anchorBlock}

Recent focus: ${recentFocus || "None"}
Pending questions: ${pendingQuestions || "None"}
Trust: ${persona.rapport.trustScore.toFixed(2)} / 1.0
Delivered insight IDs: ${recentInsightIds || "None"}
${pastInsightBlock ? `\nPAST INSIGHTS (content AND sentence structure must be completely different):\n${pastInsightBlock}` : ""}

TASK:
${promptFrame}

STRUCTURE CONSTRAINT:
${structureSeed}

硬性要求（必须全部满足，否则拒绝输出）：
- 必须引用上面"SPECIFIC FACTS"列表中的至少一条具体事实——不能只提领域名称，要说出用户在这个领域的具体认知或关注点
- 1-3句话，中文，语气像突然想到什么要跟朋友说
- 不用问号结尾，不用列表或编号
- 禁止以下句式和短语：
  · "被人X但换个角度"或"虽然X但Y"的对比模板
  · "值得关注"、"挺有意思"、"不得不说"
  · "你有没有想过"、"最近在关注"、"你发现没有"
  · "其实...也是"、"背后的原因是"
  · "换个角度来看"、"有没有可能"
  · "有趣的是"、"值得注意的是"
  · "说到"、"关于"、"在...领域"作为开头
  · "结合你..."、"作为..."作为开头
${openingBans ? `  · ${openingBans}` : ""}
- 内容必须是一个具体的判断、观察或建议，不是泛泛的感受

好的洞察（满足至少一条）：
- 跨域连接：把用户不同兴趣领域的具体知识关联起来
- 解答悬问：对用户之前问过但没答案的问题给出新判断
- 实用建议：给一个明确的、可直接执行的行动方向
- 反常识观点：挑战一个可能的错误认知，用事实反驳

CRITICAL: Output in your own voice — the same personality the user knows from regular conversations. NOT a formal report, NOT a system notification.

Respond with ONLY a JSON array (no markdown, no code fences):
[
  {
    "content": "Your insight in your own voice, in Chinese",
    "rationale": "Why this is relevant to this user SPECIFICALLY (reference persona data)",
    "targetDomains": ["domain1"],
    "sourceDomains": ["domain2"],
    "relevanceScore": 0.8,
    "surpriseScore": 0.6
  }
]

Keep insights concise (1-3 sentences). Quality over quantity.`;
}

// ─── LLM Call ────────────────────────────────────────────────────────────
async function callLLM(prompt) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Authorization": `Bearer ${API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.85,
      max_tokens: 500,
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.choices[0].message.content;
}

function parseInsights(text) {
  try {
    const cleaned = text.replace(/^```(?:json)?\s*/m, "").replace(/\s*```$/m, "").trim();
    const parsed = JSON.parse(cleaned);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// ─── Quality Evaluator ───────────────────────────────────────────────────
function evaluateInsight(insight, scenario) {
  const content = insight.content || "";
  const scores = {};
  const issues = [];

  const recentKeywords = [...scenario.persona.recentFocus, ...Object.keys(scenario.persona.domains)];
  const mentionedRecent = recentKeywords.some(k => content.includes(k));
  scores.relevance = mentionedRecent ? 8 : (content.length > 20 ? 4 : 2);
  if (!mentionedRecent) issues.push("未提及用户近期工作/领域");

  const templatePatterns = [
    /被人(骂|吐槽|批评)/, /换个角度看/, /其实做对了一件事/, /其实在做一件/,
    /值得注意的是/, /值得关注/, /挺有意思的/, /最近在关注/,
    /你有没有想过/, /有一个有趣的/, /有趣的是/, /不得不说/,
    /换个角度来看/, /有没有可能/, /值得注意的是/,
  ];
  const templateHits = templatePatterns.filter(p => p.test(content)).length;
  scores.natural = Math.max(2, 10 - templateHits * 3);
  if (templateHits > 0) issues.push(`检测到 ${templateHits} 个模板句式`);

  const allKeyInsights = Object.values(scenario.persona.domains).flatMap(d => d.keyInsights);
  const hasConcreteDetail = /[\d%]|具体|明确|实际上|本质上/.test(content) ||
    allKeyInsights.some(k => content.includes(k));
  scores.specific = hasConcreteDetail ? 8 : 4;
  if (!hasConcreteDetail) issues.push("缺乏具体细节");

  const usesPersonaInfo = allKeyInsights.some(k => content.includes(k)) ||
    (scenario.persona.identity?.expertDomains?.some(d => content.includes(d)) ?? false);
  scores.personalized = usesPersonaInfo ? 9 : 3;
  if (!usesPersonaInfo) issues.push("未利用用户 persona 中的具体信息");

  const hasDepth = content.length > 40 && !/^(但是|不过|其实|所以)/.test(content.trim());
  scores.inspiring = hasDepth ? 7 : 4;
  if (!hasDepth) issues.push("洞察不够深入");

  const startsWithSubject = /^(这|那|它|这个|Python|Rust|Go|TypeScript|React|AI|ML)/.test(content.trim());
  scores.non_template = startsWithSubject ? 5 : 8;

  const avg = Object.values(scores).reduce((a, b) => a + b, 0) / Object.values(scores).length;
  return { scores, issues, avg: Math.round(avg * 10) / 10 };
}

// ─── Main Test Runner ────────────────────────────────────────────────────
async function main() {
  if (!API_KEY) {
    console.error("❌ ZAI_API_KEY env var required");
    process.exit(1);
  }

  console.log("═══════════════════════════════════════════════════");
  console.log("  KaijiBot 洞察质量测试 v2");
  console.log("═══════════════════════════════════════════════════\n");

  const allResults = [];

  for (const scenario of SCENARIOS) {
    console.log(`\n▸ 场景: ${scenario.name}`);
    console.log(`  目标域: ${scenario.input.targetDomains.join(", ")}`);
    console.log(`  近期关注: ${scenario.persona.recentFocus.join(", ")}`);
    console.log(`  待答问题: ${scenario.persona.pendingQuestions.join("; ") || "无"}\n`);

    for (let round = 1; round <= ROUNDS; round++) {
      const prompt = buildInsightPrompt(scenario.persona, scenario.input, scenario.persona.recentInsightContents);

      try {
        process.stdout.write(`  Round ${round}: 调用 LLM...`);
        const raw = await callLLM(prompt);
        const insights = parseInsights(raw);
        process.stdout.write(` 收到 ${insights.length} 条洞察\n`);

        if (insights.length === 0) {
          console.log(`    ⚠️ 无法解析洞察。Raw: ${raw.slice(0, 200)}`);
          continue;
        }

        for (let i = 0; i < insights.length; i++) {
          const eval_ = evaluateInsight(insights[i], scenario);
          allResults.push({ scenario: scenario.name, round, insight: insights[i], eval: eval_ });

          console.log(`\n    ┌─ Insight ${i + 1} (平均分: ${eval_.avg}/10) ──────────────`);
          console.log(`    │ ${insights[i].content}`);
          console.log(`    │ targetDomains: ${JSON.stringify(insights[i].targetDomains)}`);
          console.log(`    │ rationale: ${insights[i].rationale || "无"}`);
          if (eval_.issues.length > 0) {
            console.log(`    │ ⚠️ ${eval_.issues.join("; ")}`);
          }
          const scoreLine = EVAL_CRITERIA.map(c => `${c.name}: ${eval_.scores[c.id]}/10`).join(" | ");
          console.log(`    │ ${scoreLine}`);
          console.log(`    └──────────────────────────────────`);
        }
      } catch (err) {
        console.log(` ❌ ${err.message}`);
        continue;
      }
    }
  }

  // ─── Summary ────────────────────────────────────────────────────────
  console.log("\n\n═══════════════════════════════════════════════════");
  console.log("  测试总结");
  console.log("═══════════════════════════════════════════════════\n");

  const byScenario = {};
  for (const r of allResults) {
    if (!byScenario[r.scenario]) byScenario[r.scenario] = [];
    byScenario[r.scenario].push(r.eval.avg);
  }

  for (const [name, avgs] of Object.entries(byScenario)) {
    const mean = (avgs.reduce((a, b) => a + b, 0) / avgs.length).toFixed(1);
    console.log(`  ${name}: 平均 ${mean}/10 (${avgs.length} 条洞察)`);
  }

  const overallAvg = allResults.length > 0
    ? (allResults.reduce((a, r) => a + r.eval.avg, 0) / allResults.length).toFixed(1)
    : "N/A";
  console.log(`\n  总体平均分: ${overallAvg}/10`);

  const topIssues = {};
  for (const r of allResults) {
    for (const issue of r.eval.issues) {
      topIssues[issue] = (topIssues[issue] || 0) + 1;
    }
  }
  if (Object.keys(topIssues).length > 0) {
    console.log("\n  高频问题:");
    for (const [issue, count] of Object.entries(topIssues).sort((a, b) => b[1] - a[1])) {
      console.log(`    ×${count} ${issue}`);
    }
  }

  const passRate = allResults.filter(r => r.eval.avg >= 7).length / Math.max(allResults.length, 1);
  console.log(`\n  达标率 (≥7分): ${(passRate * 100).toFixed(0)}%`);
  console.log("\n═══════════════════════════════════════════════════");
}

main().catch(console.error);
