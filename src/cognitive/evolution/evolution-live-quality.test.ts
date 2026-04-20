/**
 * Live evolution quality test — real LLM skill draft generation.
 *
 * Run: KAIJIBOT_LIVE_TEST=1 pnpm test src/cognitive/evolution/evolution-live-quality.test.ts
 */

import { describe, it, expect } from "vitest";
import { generateSkillDraftLLM, buildPrompt, validateAndRepair } from "./llm-draft-generator.js";
import { SKILL_CREATOR_SPEC } from "./skill-creator-spec.js";
import type { EvolutionCandidate } from "./types.js";

const isLive = process.env.KAIJIBOT_LIVE_TEST === "1" || process.env.LIVE === "1";
const ZAI_API_KEY = process.env.ZAI_API_KEY;
const ZAI_URL = "https://api.z.ai/api/coding/paas/v4/chat/completions";
const MODEL = "glm-5-turbo";

function makeComplexCandidate(): EvolutionCandidate {
  return {
    taskSummary: "归档产品评审会议纪要到飞书知识库并创建跟踪任务",
    toolCalls: [
      "feishu_vc_search",
      "feishu_vc_notes",
      "feishu_doc_fetch",
      "feishu_wiki_spaces",
      "feishu_wiki_create",
      "feishu_doc_write",
      "feishu_task_create",
    ],
    uniqueToolCount: 6,
    reasoningTurns: 8,
    durationMs: 180_000,
    domain: "feishu-meeting",
    transcript: [
      "用户: 帮我把昨天的产品评审会议纪要归档到知识库",
      "Agent: 好的，我先查找昨天的会议",
      "tool:feishu_vc_search(昨日产品评审)",
      "Agent: 找到了会议记录，正在获取纪要内容",
      "tool:feishu_vc_notes(meeting_id)",
      "Agent: 获取到纪要了，现在查找知识库空间",
      "tool:feishu_wiki_spaces()",
      "用户: 放到产品文档那个空间里",
      "Agent: 好的，在产品文档空间创建文档",
      "tool:feishu_wiki_create(space_id, 纪要标题)",
      "tool:feishu_doc_write(doc_id, 纪要内容)",
      "Agent: 纪要已归档。需要我创建跟踪任务吗？",
      "用户: 好的，把纪要里的待办创建任务",
      "tool:feishu_task_create(待办列表)",
    ].join("\n"),
    hasTrialAndError: false,
    userCorrections: 0,
  };
}

function makeTrialErrorCandidate(): EvolutionCandidate {
  return {
    taskSummary: "调试并修复RAG系统检索精度过低的问题",
    toolCalls: [
      "code_search",
      "code_read",
      "code_edit",
      "code_edit",
      "code_edit",
      "test_run",
      "test_run",
      "test_run",
      "code_read",
      "code_edit",
      "test_run",
    ],
    uniqueToolCount: 4,
    reasoningTurns: 12,
    durationMs: 300_000,
    domain: "code-debug",
    transcript: [
      "Agent: 检索精度低可能是 embedding 模型的问题",
      "tool:code_edit(embedding config)",
      "tool:test_run()",
      "Agent: 测试还是失败",
      "用户: 不对，不是embedding的问题，是chunk策略的问题",
      "Agent: 抱歉，让我重新看看chunk策略",
      "tool:code_edit(chunk strategy)",
      "tool:test_run()",
      "用户: 还是不对，你看看之前的chunk_overlap参数",
      "Agent: 我来调整 overlap 参数",
      "tool:code_edit(chunk_overlap)",
      "tool:test_run()",
      "Agent: 这次通过了",
    ].join("\n"),
    hasTrialAndError: true,
    userCorrections: 2,
  };
}

async function callLLM(prompt: string): Promise<string> {
  const res = await fetch(ZAI_URL, {
    method: "POST",
    headers: { "Authorization": `Bearer ${ZAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
      max_tokens: 3000,
    }),
  });
  const data = await res.json() as { error?: { message: string }; choices?: Array<{ message: { content: string } }> };
  if (data.error) throw new Error(data.error.message);
  return data.choices?.[0]?.message?.content ?? "";
}

type DraftQualityReport = {
  name: string;
  hasValidName: boolean;
  hasDescription: boolean;
  hasTriggers: boolean;
  triggerCount: number;
  hasChineseTriggers: boolean;
  hasEnglishTriggers: boolean;
  bodyLineCount: number;
  under200Lines: boolean;
  hasFrontmatter: boolean;
  hasWorkflowSection: boolean;
  referencesRealTools: boolean;
  score: number;
};

function evaluateDraft(draft: { name: string; description: string; triggerPhrases: string[]; bodyMarkdown: string }, candidate: EvolutionCandidate): DraftQualityReport {
  const hasValidName = /^[a-z][a-z0-9-]*$/.test(draft.name);
  const hasDescription = draft.description.length >= 10;
  const hasTriggers = draft.triggerPhrases.length >= 3;
  const hasChineseTriggers = draft.triggerPhrases.some((t) => /[\u4e00-\u9fff]/.test(t));
  const hasEnglishTriggers = draft.triggerPhrases.some((t) => /^[a-zA-Z]/.test(t));
  const bodyLines = draft.bodyMarkdown.split("\n").filter((l) => l.trim()).length;
  const under200Lines = bodyLines <= 200;
  const hasFrontmatter = draft.bodyMarkdown.includes("---");
  const hasWorkflowSection = /##\s+(Workflow|工作流|步骤|Steps)/.test(draft.bodyMarkdown);

  const toolNamesInBody = candidate.toolCalls.filter((t) =>
    draft.bodyMarkdown.toLowerCase().includes(t.toLowerCase().split("_")[0]!),
  );
  const referencesRealTools = toolNamesInBody.length > 0;

  let score = 0;
  if (hasValidName) score += 2;
  if (hasDescription) score += 1;
  if (hasTriggers) score += 2;
  if (hasChineseTriggers) score += 1;
  if (hasEnglishTriggers) score += 1;
  if (under200Lines) score += 1;
  if (hasWorkflowSection) score += 1;
  if (referencesRealTools) score += 1;

  return {
    name: draft.name,
    hasValidName,
    hasDescription,
    hasTriggers,
    triggerCount: draft.triggerPhrases.length,
    hasChineseTriggers,
    hasEnglishTriggers,
    bodyLineCount: bodyLines,
    under200Lines,
    hasFrontmatter,
    hasWorkflowSection,
    referencesRealTools,
    score,
  };
}

describe.skipIf(!isLive || !ZAI_API_KEY)("live evolution quality — real LLM skill draft", () => {
  it("generates a valid SKILL.md for a complex feishu task", async () => {
    const candidate = makeComplexCandidate();

    const draft = await generateSkillDraftLLM(candidate, { generateText: callLLM });

    console.log(`\n  ═══ SKILL.md Draft ═══`);
    console.log(`  Name: ${draft.name}`);
    console.log(`  Description: ${draft.description}`);
    console.log(`  Triggers (${draft.triggerPhrases.length}): ${draft.triggerPhrases.join(", ")}`);
    console.log(`  Body lines: ${draft.bodyMarkdown.split("\n").length}`);
    console.log(`  Body preview:\n${draft.bodyMarkdown.split("\n").slice(0, 15).map((l) => `    ${l}`).join("\n")}`);
    console.log(`  ═══════════════════\n`);

    const report = evaluateDraft(draft, candidate);

    console.log(`  Quality: ${report.score}/10`);
    console.log(`  Valid name: ${report.hasValidName} | Description: ${report.hasDescription} | Triggers: ${report.hasTriggers} (${report.triggerCount})`);
    console.log(`  Chinese triggers: ${report.hasChineseTriggers} | English triggers: ${report.hasEnglishTriggers}`);
    console.log(`  Under 200 lines: ${report.under200Lines} (${report.bodyLineCount}) | Workflow section: ${report.hasWorkflowSection}`);
    console.log(`  References real tools: ${report.referencesRealTools}\n`);

    expect(draft.name).toBeTruthy();
    expect(draft.description.length).toBeGreaterThan(5);
    expect(draft.triggerPhrases.length).toBeGreaterThanOrEqual(3);
    expect(report.score).toBeGreaterThanOrEqual(6);
  }, 120_000);

  it("generates a valid SKILL.md for a trial-and-error debug task", async () => {
    const candidate = makeTrialErrorCandidate();

    const draft = await generateSkillDraftLLM(candidate, { generateText: callLLM });

    console.log(`\n  ═══ SKILL.md Draft (Trial-Error) ═══`);
    console.log(`  Name: ${draft.name}`);
    console.log(`  Description: ${draft.description}`);
    console.log(`  Triggers: ${draft.triggerPhrases.join(", ")}`);
    console.log(`  ═══════════════════\n`);

    const report = evaluateDraft(draft, candidate);

    expect(draft.name).toBeTruthy();
    expect(report.score).toBeGreaterThanOrEqual(5);
  }, 120_000);

  it("prompt contains skill-creator spec and candidate info", () => {
    const candidate = makeComplexCandidate();
    const prompt = buildPrompt(candidate);

    expect(prompt).toContain("Task to Analyze");
    expect(prompt).toContain(candidate.taskSummary);
    expect(prompt).toContain(candidate.domain);
    expect(prompt.length).toBeGreaterThan(5000);
  });

  it("validateAndRepair handles real LLM output edge cases", () => {
    const candidate = makeComplexCandidate();

    const goodOutput = [
      "---",
      "name: feishu-meeting-archive",
      "description: \"归档飞书会议纪要到知识库并创建跟踪任务\"",
      "---",
      "",
      "## Triggers",
      "",
      "- 归档会议纪要",
      "- archive meeting notes",
      "- 会议纪要归档到知识库",
      "- meeting archive to wiki",
      "",
      "## Workflow",
      "",
      "1. Search for the target meeting",
      "2. Extract meeting notes",
      "3. Find or create wiki space node",
      "4. Write notes to the document",
      "5. Create follow-up tasks from action items",
    ].join("\n");

    const draft = validateAndRepair(goodOutput, candidate);
    expect(draft.name).toBe("feishu-meeting-archive");
    expect(draft.triggerPhrases.length).toBeGreaterThanOrEqual(3);
    expect(draft.bodyMarkdown).toContain("Workflow");
  });

  it("3 rounds of skill generation produce distinct, valid drafts", async () => {
    const candidates: EvolutionCandidate[] = [
      makeComplexCandidate(),
      {
        taskSummary: "批量导出飞书多维表格数据到Excel并按部门分组汇总",
        toolCalls: ["feishu_base_list", "feishu_base_records", "xlsx_create", "xlsx_write", "xlsx_formula"],
        uniqueToolCount: 3,
        reasoningTurns: 5,
        durationMs: 120_000,
        domain: "feishu-data",
      },
      makeTrialErrorCandidate(),
    ];

    const names = new Set<string>();
    const reports: DraftQualityReport[] = [];

    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i]!;
      const draft = await generateSkillDraftLLM(candidate, { generateText: callLLM });
      names.add(draft.name);

      const report = evaluateDraft(draft, candidate);
      reports.push(report);

      console.log(`\n  [Round ${i + 1}] "${candidate.taskSummary.slice(0, 30)}..." → ${draft.name}`);
      console.log(`  Quality: ${report.score}/10 | Triggers: ${report.triggerCount} | Lines: ${report.bodyLineCount}`);
    }

    console.log(`\n  All names: ${[...names].join(", ")}`);
    console.log(`  Unique names: ${names.size}/${candidates.length}`);
    console.log(`  Avg quality: ${(reports.reduce((s, r) => s + r.score, 0) / reports.length).toFixed(1)}/10\n`);

    expect(names.size).toBe(candidates.length);
    for (const report of reports) {
      expect(report.score).toBeGreaterThanOrEqual(5);
    }
  }, 300_000);
});
