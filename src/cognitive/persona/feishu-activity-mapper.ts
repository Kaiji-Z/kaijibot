import type { ExtractionResult } from "./types.js";
import type {
  FeishuActivityData,
  TaskActivitySummary,
  DocActivitySummary,
  MeetingActivitySummary,
} from "./feishu-activity-types.js";

function docDomainDepth(doc: DocActivitySummary): number {
  return Math.min(5, Math.round(Math.log2(doc.edited + doc.viewed * 0.3 + 1)));
}

function meetingDomainDepth(meeting: MeetingActivitySummary): number {
  return Math.min(5, Math.round(Math.log2(meeting.attended + 1)));
}

function taskDomainDepth(task: TaskActivitySummary): number {
  return Math.min(5, Math.round(Math.log2(task.inProgress + task.completed * 0.5 + 1)));
}

function extractDocDomains(doc: DocActivitySummary): ExtractionResult["domains"] {
  const depth = docDomainDepth(doc);
  if (depth === 0 || doc.documentThemes.length === 0) return [];
  return doc.documentThemes.map((theme) => ({
    name: theme,
    depth,
    insights: [],
    questions:
      doc.viewed > 5 && doc.edited < 2
        ? [`Reading but not contributing in ${theme}`]
        : [],
  }));
}

function extractMeetingDomains(meeting: MeetingActivitySummary): ExtractionResult["domains"] {
  const depth = meetingDomainDepth(meeting);
  if (depth === 0 || meeting.meetingThemes.length === 0) return [];
  return meeting.meetingThemes.map((theme) => ({
    name: theme,
    depth,
    insights: [],
    questions:
      meeting.attended > 0
        ? [`Meetings in ${theme} without documented outcomes`]
        : [],
  }));
}

function extractTaskDomains(task: TaskActivitySummary): ExtractionResult["domains"] {
  const depth = taskDomainDepth(task);
  if (depth === 0 || task.taskListNames.length === 0) return [];
  return task.taskListNames.map((name) => ({
    name,
    depth,
    insights: [],
    questions:
      task.overdue > 0 ? [`Has overdue tasks in ${name}`] : [],
  }));
}

function mergeDomains(
  docDomains: ExtractionResult["domains"],
  meetingDomains: ExtractionResult["domains"],
  taskDomains: ExtractionResult["domains"],
): ExtractionResult["domains"] {
  const merged = new Map<string, ExtractionResult["domains"][number]>();
  for (const d of [...docDomains, ...meetingDomains, ...taskDomains]) {
    const existing = merged.get(d.name);
    if (existing) {
      existing.depth = Math.max(existing.depth, d.depth);
      existing.insights = [...new Set([...existing.insights, ...d.insights])].slice(0, 3);
      existing.questions = [...new Set([...existing.questions, ...d.questions])];
      if (d.negated) existing.negated = d.negated;
    } else {
      merged.set(d.name, {
        ...d,
        insights: d.insights.slice(0, 3),
      });
    }
  }
  return [...merged.values()];
}

function buildRecentFocus(data: FeishuActivityData): string[] {
  const themes: string[] = [
    ...data.docActivity.documentThemes,
    ...data.meetingActivity.meetingThemes,
    ...data.taskActivity.taskListNames,
    ...data.activeProjects,
  ];
  return [...new Set(themes)].slice(0, 5);
}

function buildPendingQuestions(data: FeishuActivityData): string[] {
  const questions: string[] = [];
  const task = data.taskActivity;
  const doc = data.docActivity;
  const meeting = data.meetingActivity;

  if (task.overdue > 0) {
    const domainNames = [
      ...data.docActivity.documentThemes,
      ...data.taskActivity.taskListNames,
    ];
    const domains = domainNames.length > 0
      ? domainNames.slice(0, 3).join(", ")
      : "assigned lists";
    questions.push(`Has ${task.overdue} overdue tasks across ${domains}`);
  }

  if (doc.viewed > 5 && doc.edited < 2) {
    questions.push("Reading extensively but not editing documents");
  }

  if (meeting.organized > meeting.attended * 0.5) {
    questions.push("Organizing many meetings — potential coordination burden");
  }

  return questions;
}

function buildAttributes(data: FeishuActivityData): ExtractionResult["attributes"] {
  const attributes: ExtractionResult["attributes"] = [];
  const doc = data.docActivity;
  const meeting = data.meetingActivity;
  const task = data.taskActivity;

  if (doc.edited > doc.viewed * 0.5) {
    attributes.push({
      field: "identity.coreTraits.editingPreference",
      value: "active_contributor",
      confidence: 0.7,
      source: "observed",
      evidence: `Edited ${doc.edited} docs vs ${doc.viewed} viewed`,
    });
  }

  if (meeting.organized > 2) {
    attributes.push({
      field: "identity.coreTraits.meetingRole",
      value: "organizer",
      confidence: 0.7,
      source: "observed",
      evidence: `Organized ${meeting.organized} meetings`,
    });
  }

  if (task.completed > task.created * 0.8 && task.created > 0) {
    attributes.push({
      field: "identity.coreTraits.taskCompletionRate",
      value: "high",
      confidence: 0.7,
      source: "observed",
      evidence: `Completed ${task.completed} of ${task.created} tasks`,
    });
  }

  return attributes;
}

export function mapFeishuActivity(data: FeishuActivityData): ExtractionResult {
  const docDomains = extractDocDomains(data.docActivity);
  const meetingDomains = extractMeetingDomains(data.meetingActivity);
  const taskDomains = extractTaskDomains(data.taskActivity);
  const domains = mergeDomains(docDomains, meetingDomains, taskDomains);

  return {
    attributes: buildAttributes(data),
    domains,
    recentFocus: buildRecentFocus(data),
    sentiment: undefined,
  };
}
