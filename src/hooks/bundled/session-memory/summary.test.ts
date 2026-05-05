import { describe, expect, it } from "vitest";
import {
  formatSummaryAsMarkdown,
  type StructuredSummary,
} from "./summary.js";

function makeSummary(overrides: Partial<StructuredSummary> = {}): StructuredSummary {
  return {
    summary: "用户讨论了 API 设计方案并确定了 RESTful 风格。",
    decisions: ["采用 RESTful API 设计", "使用 JSON 作为数据格式"],
    followups: ["实现认证中间件", "编写 API 文档"],
    topics: ["api-design", "architecture"],
    participants: ["user", "assistant"],
    topicSlug: "api-design",
    ...overrides,
  };
}

describe("formatSummaryAsMarkdown", () => {
  it("produces YAML frontmatter with type, date, topics, participants", () => {
    const summary = makeSummary();
    const md = formatSummaryAsMarkdown(summary, "2026-04-24");

    expect(md).toMatch(/^---\n/);
    expect(md).toContain("type: session-summary");
    expect(md).toContain("date: 2026-04-24");
    expect(md).toContain("topics: [api-design, architecture]");
    expect(md).toContain("participants: [user, assistant]");
    expect(md).toMatch(/---\n/);
  });

  it("includes 摘要 section with the summary text", () => {
    const summary = makeSummary();
    const md = formatSummaryAsMarkdown(summary, "2026-04-24");

    expect(md).toContain("## 摘要");
    expect(md).toContain(summary.summary);
  });

  it("renders decisions as bullet points under 关键决策", () => {
    const summary = makeSummary();
    const md = formatSummaryAsMarkdown(summary, "2026-04-24");

    expect(md).toContain("## 关键决策");
    expect(md).toContain("- 采用 RESTful API 设计");
    expect(md).toContain("- 使用 JSON 作为数据格式");
  });

  it("renders followups as checkbox items under 待跟进", () => {
    const summary = makeSummary();
    const md = formatSummaryAsMarkdown(summary, "2026-04-24");

    expect(md).toContain("## 待跟进");
    expect(md).toContain("- [ ] 实现认证中间件");
    expect(md).toContain("- [ ] 编写 API 文档");
  });

  it("omits 关键决策 section when no decisions", () => {
    const summary = makeSummary({ decisions: [] });
    const md = formatSummaryAsMarkdown(summary, "2026-04-24");

    expect(md).not.toContain("## 关键决策");
  });

  it("omits 待跟进 section when no followups", () => {
    const summary = makeSummary({ followups: [] });
    const md = formatSummaryAsMarkdown(summary, "2026-04-24");

    expect(md).not.toContain("## 待跟进");
  });

  it("includes 详细记录 link to topic file", () => {
    const summary = makeSummary();
    const md = formatSummaryAsMarkdown(summary, "2026-04-24");

    expect(md).toContain("## 详细记录 → memory/topics/api-design.md");
  });

  it("uses reference type and English summary correctly", () => {
    const summary = makeSummary({
      summary: "User asked about deployment options for the new service.",
      decisions: [],
      followups: [],
      topics: ["deployment"],
      topicSlug: "deployment-options",
    });
    const md = formatSummaryAsMarkdown(summary, "2026-04-24");

    expect(md).toContain("User asked about deployment options");
    expect(md).toContain("topics: [deployment]");
    expect(md).not.toContain("## 关键决策");
    expect(md).not.toContain("## 待跟进");
  });

  it("renders sessionKey when provided", () => {
    const summary = makeSummary();
    const md = formatSummaryAsMarkdown(summary, "2026-04-24", "agent:main:main");

    expect(md).toContain("- **Session Key**: agent:main:main");
  });

  it("renders sessionFile pointer when provided", () => {
    const summary = makeSummary();
    const md = formatSummaryAsMarkdown(
      summary,
      "2026-04-24",
      undefined,
      "~/.kaijibot/agents/default/sessions/abc-123.jsonl",
    );

    expect(md).toContain("- **完整会话**: ~/.kaijibot/agents/default/sessions/abc-123.jsonl");
  });

  it("omits sessionKey and sessionFile when not provided", () => {
    const summary = makeSummary();
    const md = formatSummaryAsMarkdown(summary, "2026-04-24");

    expect(md).not.toContain("**Session Key**");
    expect(md).not.toContain("**完整会话**");
  });

  it("renders 核心请求 when primaryRequest is set", () => {
    const summary = makeSummary({ primaryRequest: "设计一个 RESTful API" });
    const md = formatSummaryAsMarkdown(summary, "2026-04-24");

    expect(md).toContain("## 核心请求");
    expect(md).toContain("设计一个 RESTful API");
  });

  it("omits 核心请求 when primaryRequest is undefined", () => {
    const summary = makeSummary();
    const md = formatSummaryAsMarkdown(summary, "2026-04-24");

    expect(md).not.toContain("## 核心请求");
  });

  it("renders 技术概念 when technicalConcepts is set", () => {
    const summary = makeSummary({ technicalConcepts: ["REST", "OAuth2"] });
    const md = formatSummaryAsMarkdown(summary, "2026-04-24");

    expect(md).toContain("## 技术概念");
    expect(md).toContain("- REST");
    expect(md).toContain("- OAuth2");
  });

  it("omits 技术概念 when technicalConcepts is empty", () => {
    const summary = makeSummary({ technicalConcepts: [] });
    const md = formatSummaryAsMarkdown(summary, "2026-04-24");

    expect(md).not.toContain("## 技术概念");
  });

  it("renders 文件与变更 when filesAndChanges is set", () => {
    const summary = makeSummary({ filesAndChanges: ["src/index.ts: added retry logic"] });
    const md = formatSummaryAsMarkdown(summary, "2026-04-24");

    expect(md).toContain("## 文件与变更");
    expect(md).toContain("- src/index.ts: added retry logic");
  });

  it("renders 错误与修复 when errorsAndFixes is set", () => {
    const summary = makeSummary({ errorsAndFixes: ["TypeError on null → added null check"] });
    const md = formatSummaryAsMarkdown(summary, "2026-04-24");

    expect(md).toContain("## 错误与修复");
    expect(md).toContain("- TypeError on null → added null check");
  });

  it("renders 问题解决 when problemSolving is set", () => {
    const summary = makeSummary({ problemSolving: ["Tried batch insert → switched to streaming"] });
    const md = formatSummaryAsMarkdown(summary, "2026-04-24");

    expect(md).toContain("## 问题解决");
    expect(md).toContain("- Tried batch insert → switched to streaming");
  });

  it("renders 当前工作 when currentWork is set", () => {
    const summary = makeSummary({ currentWork: "正在实现认证中间件" });
    const md = formatSummaryAsMarkdown(summary, "2026-04-24");

    expect(md).toContain("## 当前工作");
    expect(md).toContain("正在实现认证中间件");
  });

  it("renders 下一步 when nextStep is set", () => {
    const summary = makeSummary({ nextStep: "完成 API 文档编写" });
    const md = formatSummaryAsMarkdown(summary, "2026-04-24");

    expect(md).toContain("## 下一步");
    expect(md).toContain("完成 API 文档编写");
  });

  it("does not render raw transcript details block", () => {
    const summary = makeSummary();
    const md = formatSummaryAsMarkdown(summary, "2026-04-24");

    expect(md).not.toContain("<details>");
    expect(md).not.toContain("</details>");
    expect(md).not.toContain("## 原始对话");
  });
});
