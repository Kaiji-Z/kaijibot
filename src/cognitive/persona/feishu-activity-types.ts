/** Summary of a user's Feishu task activity in a time window */
export type TaskActivitySummary = {
  created: number;
  completed: number;
  inProgress: number;
  overdue: number;
  taskListNames: string[];
  sinceMs: number;
  untilMs: number;
};

/** Summary of a user's Feishu document activity */
export type DocActivitySummary = {
  viewed: number;
  edited: number;
  created: number;
  documentThemes: string[];
  wikiSpaces: string[];
  sinceMs: number;
  untilMs: number;
};

/** Summary of a user's Feishu meeting activity */
export type MeetingActivitySummary = {
  attended: number;
  organized: number;
  totalDurationMinutes: number;
  meetingThemes: string[];
  sinceMs: number;
  untilMs: number;
};

/** Aggregated Feishu activity data for a user */
export type FeishuActivityData = {
  userId: string;
  taskActivity: TaskActivitySummary;
  docActivity: DocActivitySummary;
  meetingActivity: MeetingActivitySummary;
  activeProjects: string[];
  collectedAt: number;
};
