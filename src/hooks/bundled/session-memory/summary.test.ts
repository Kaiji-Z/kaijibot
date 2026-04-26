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
});
