import { describe, it, expect } from "vitest";
import { mapFeishuActivity } from "./feishu-activity-mapper.js";
import type { FeishuActivityData } from "./feishu-activity-types.js";

function emptyData(overrides: Partial<FeishuActivityData> = {}): FeishuActivityData {
  return {
    userId: "test-user",
    taskActivity: {
      created: 0,
      completed: 0,
      inProgress: 0,
      overdue: 0,
      taskListNames: [],
      sinceMs: 0,
      untilMs: 0,
    },
    docActivity: {
      viewed: 0,
      edited: 0,
      created: 0,
      documentThemes: [],
      wikiSpaces: [],
      sinceMs: 0,
      untilMs: 0,
    },
    meetingActivity: {
      attended: 0,
      organized: 0,
      totalDurationMinutes: 0,
      meetingThemes: [],
      sinceMs: 0,
      untilMs: 0,
    },
    activeProjects: [],
    collectedAt: 0,
    ...overrides,
  };
}

describe("mapFeishuActivity", () => {
  it("returns empty extraction for empty activity", () => {
    const result = mapFeishuActivity(emptyData());
    expect(result.attributes).toEqual([]);
    expect(result.domains).toEqual([]);
    expect(result.recentFocus).toEqual([]);
    expect(result.pendingQuestions).toEqual([]);
    expect(result.sentiment).toBeUndefined();
  });

  it("produces domains from task list names", () => {
    const data = emptyData({
      taskActivity: {
        created: 5,
        completed: 3,
        inProgress: 4,
        overdue: 0,
        taskListNames: ["Backend Sprint", "Infra Tasks"],
        sinceMs: 0,
        untilMs: 0,
      },
    });
    const result = mapFeishuActivity(data);
    const names = result.domains.map((d) => d.name);
    expect(names).toContain("Backend Sprint");
    expect(names).toContain("Infra Tasks");
  });

  it("produces domains from document themes", () => {
    const data = emptyData({
      docActivity: {
        viewed: 10,
        edited: 3,
        created: 1,
        documentThemes: ["Machine Learning", "Data Pipeline"],
        wikiSpaces: [],
        sinceMs: 0,
        untilMs: 0,
      },
    });
    const result = mapFeishuActivity(data);
    const names = result.domains.map((d) => d.name);
    expect(names).toContain("Machine Learning");
    expect(names).toContain("Data Pipeline");
  });

  it("produces domains from meeting themes", () => {
    const data = emptyData({
      meetingActivity: {
        attended: 5,
        organized: 1,
        totalDurationMinutes: 120,
        meetingThemes: ["Architecture Review", "Planning"],
        sinceMs: 0,
        untilMs: 0,
      },
    });
    const result = mapFeishuActivity(data);
    const names = result.domains.map((d) => d.name);
    expect(names).toContain("Architecture Review");
    expect(names).toContain("Planning");
  });

  it("calculates domain depth with logarithmic scaling for docs", () => {
    const data = emptyData({
      docActivity: {
        viewed: 0,
        edited: 1,
        created: 0,
        documentThemes: ["Domain A"],
        wikiSpaces: [],
        sinceMs: 0,
        untilMs: 0,
      },
    });
    const result = mapFeishuActivity(data);
    // log2(1 + 0*0.3 + 1) = log2(2) = 1 → min(5, round(1)) = 1
    expect(result.domains[0].depth).toBe(1);

    const data2 = emptyData({
      docActivity: {
        viewed: 100,
        edited: 50,
        created: 0,
        documentThemes: ["Domain B"],
        wikiSpaces: [],
        sinceMs: 0,
        untilMs: 0,
      },
    });
    const result2 = mapFeishuActivity(data2);
    // log2(50 + 100*0.3 + 1) = log2(81) ≈ 6.34 → min(5, round(6.34)) = 5
    expect(result2.domains[0].depth).toBe(5);
  });

  it("calculates domain depth with logarithmic scaling for meetings", () => {
    const data = emptyData({
      meetingActivity: {
        attended: 3,
        organized: 0,
        totalDurationMinutes: 60,
        meetingThemes: ["Team Sync"],
        sinceMs: 0,
        untilMs: 0,
      },
    });
    const result = mapFeishuActivity(data);
    // log2(3 + 1) = log2(4) = 2 → min(5, round(2)) = 2
    expect(result.domains[0].depth).toBe(2);
  });

  it("calculates domain depth with logarithmic scaling for tasks", () => {
    const data = emptyData({
      taskActivity: {
        created: 10,
        completed: 8,
        inProgress: 4,
        overdue: 0,
        taskListNames: ["Sprint Board"],
        sinceMs: 0,
        untilMs: 0,
      },
    });
    const result = mapFeishuActivity(data);
    // log2(4 + 8*0.5 + 1) = log2(9) ≈ 3.17 → min(5, round(3.17)) = 3
    expect(result.domains[0].depth).toBe(3);
  });

  it("generates questions from overdue tasks", () => {
    const data = emptyData({
      taskActivity: {
        created: 5,
        completed: 2,
        inProgress: 1,
        overdue: 3,
        taskListNames: ["Critical"],
        sinceMs: 0,
        untilMs: 0,
      },
    });
    const result = mapFeishuActivity(data);
    const taskDomain = result.domains.find((d) => d.name === "Critical");
    expect(taskDomain?.questions).toContain("Has overdue tasks in Critical");
    expect(result.pendingQuestions.some((q) => q.includes("overdue"))).toBe(true);
  });

  it("generates reading-but-not-contributing question for doc domains", () => {
    const data = emptyData({
      docActivity: {
        viewed: 10,
        edited: 1,
        created: 0,
        documentThemes: ["Research"],
        wikiSpaces: [],
        sinceMs: 0,
        untilMs: 0,
      },
    });
    const result = mapFeishuActivity(data);
    const docDomain = result.domains.find((d) => d.name === "Research");
    expect(docDomain?.questions).toContain("Reading but not contributing in Research");
  });

  it("generates meeting-without-outcomes question", () => {
    const data = emptyData({
      meetingActivity: {
        attended: 5,
        organized: 0,
        totalDurationMinutes: 100,
        meetingThemes: ["Standup"],
        sinceMs: 0,
        untilMs: 0,
      },
    });
    const result = mapFeishuActivity(data);
    const meetingDomain = result.domains.find((d) => d.name === "Standup");
    expect(meetingDomain?.questions).toContain("Meetings in Standup without documented outcomes");
  });

  it("infers editingPreference attribute for active editors", () => {
    const data = emptyData({
      docActivity: {
        viewed: 4,
        edited: 3,
        created: 1,
        documentThemes: ["Docs"],
        wikiSpaces: [],
        sinceMs: 0,
        untilMs: 0,
      },
    });
    const result = mapFeishuActivity(data);
    const attr = result.attributes.find((a) => a.field === "identity.coreTraits.editingPreference");
    expect(attr).toBeDefined();
    expect(attr?.value).toBe("active_contributor");
    expect(attr?.source).toBe("observed");
  });

  it("infers meetingRole attribute for organizers", () => {
    const data = emptyData({
      meetingActivity: {
        attended: 10,
        organized: 5,
        totalDurationMinutes: 200,
        meetingThemes: ["Planning"],
        sinceMs: 0,
        untilMs: 0,
      },
    });
    const result = mapFeishuActivity(data);
    const attr = result.attributes.find((a) => a.field === "identity.coreTraits.meetingRole");
    expect(attr).toBeDefined();
    expect(attr?.value).toBe("organizer");
    expect(attr?.source).toBe("observed");
  });

  it("infers taskCompletionRate attribute for high completers", () => {
    const data = emptyData({
      taskActivity: {
        created: 10,
        completed: 9,
        inProgress: 1,
        overdue: 0,
        taskListNames: ["Work"],
        sinceMs: 0,
        untilMs: 0,
      },
    });
    const result = mapFeishuActivity(data);
    const attr = result.attributes.find((a) => a.field === "identity.coreTraits.taskCompletionRate");
    expect(attr).toBeDefined();
    expect(attr?.value).toBe("high");
    expect(attr?.source).toBe("observed");
  });

  it("does not infer taskCompletionRate when created is 0", () => {
    const data = emptyData({
      taskActivity: {
        created: 0,
        completed: 0,
        inProgress: 0,
        overdue: 0,
        taskListNames: [],
        sinceMs: 0,
        untilMs: 0,
      },
    });
    const result = mapFeishuActivity(data);
    const attr = result.attributes.find((a) => a.field === "identity.coreTraits.taskCompletionRate");
    expect(attr).toBeUndefined();
  });

  it("deduplicates and limits recentFocus to 5 items", () => {
    const data = emptyData({
      docActivity: {
        viewed: 5,
        edited: 2,
        created: 0,
        documentThemes: ["A", "B", "C"],
        wikiSpaces: [],
        sinceMs: 0,
        untilMs: 0,
      },
      meetingActivity: {
        attended: 3,
        organized: 0,
        totalDurationMinutes: 60,
        meetingThemes: ["B", "D", "E", "F"],
        sinceMs: 0,
        untilMs: 0,
      },
      activeProjects: ["G"],
    });
    const result = mapFeishuActivity(data);
    expect(result.recentFocus.length).toBeLessThanOrEqual(5);
    const unique = new Set(result.recentFocus);
    expect(unique.size).toBe(result.recentFocus.length);
  });

  it("generates coordination burden question for heavy organizers", () => {
    const data = emptyData({
      meetingActivity: {
        attended: 4,
        organized: 3,
        totalDurationMinutes: 100,
        meetingThemes: [],
        sinceMs: 0,
        untilMs: 0,
      },
    });
    const result = mapFeishuActivity(data);
    expect(result.pendingQuestions).toContain("Organizing many meetings — potential coordination burden");
  });

  it("generates reading-extensively question", () => {
    const data = emptyData({
      docActivity: {
        viewed: 10,
        edited: 1,
        created: 0,
        documentThemes: [],
        wikiSpaces: [],
        sinceMs: 0,
        untilMs: 0,
      },
    });
    const result = mapFeishuActivity(data);
    expect(result.pendingQuestions).toContain("Reading extensively but not editing documents");
  });

  it("merges domains from all three sources", () => {
    const data = emptyData({
      taskActivity: {
        created: 5,
        completed: 3,
        inProgress: 2,
        overdue: 0,
        taskListNames: ["Project X"],
        sinceMs: 0,
        untilMs: 0,
      },
      docActivity: {
        viewed: 8,
        edited: 4,
        created: 1,
        documentThemes: ["Project X", "Project Y"],
        wikiSpaces: [],
        sinceMs: 0,
        untilMs: 0,
      },
      meetingActivity: {
        attended: 3,
        organized: 1,
        totalDurationMinutes: 60,
        meetingThemes: ["Project X"],
        sinceMs: 0,
        untilMs: 0,
      },
    });
    const result = mapFeishuActivity(data);
    const projectX = result.domains.find((d) => d.name === "Project X");
    expect(projectX).toBeDefined();
    // "Project X" from all three sources — depth should be max of all three
    expect(projectX?.depth).toBeGreaterThan(0);
    const projectY = result.domains.find((d) => d.name === "Project Y");
    expect(projectY).toBeDefined();
  });

  it("includes activeProjects in recentFocus", () => {
    const data = emptyData({
      activeProjects: ["Alpha", "Beta"],
    });
    const result = mapFeishuActivity(data);
    expect(result.recentFocus).toContain("Alpha");
    expect(result.recentFocus).toContain("Beta");
  });
});
