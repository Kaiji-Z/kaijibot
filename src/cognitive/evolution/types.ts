/**
 * Self-Evolution Engine — types and contracts.
 *
 * The engine generates Skill proposals from complex agent tasks,
 * supports patching / dedup-checking existing skills, and tracks
 * user acceptance/rejection history.
 */

/** Tool error profile accumulated automatically during agent run. */
export type ToolErrorProfile = {
  /** Number of tool calls that returned errors (isError: true) */
  errorCount: number;
  /** Distinct tool names that produced errors */
  failedToolNames: string[];
  /** Whether any error involved a mutating action (writes, deletes, etc.) */
  hasMutatingErrors: boolean;
};

/** A completed task evaluated for skill evolution potential. */
export type EvolutionCandidate = {
  /** Short human-readable summary of what the task accomplished */
  taskSummary: string;
  /** Ordered list of tool calls made during the task */
  toolCalls: string[];
  /** Number of distinct tools invoked */
  uniqueToolCount: number;
  /** Number of agent reasoning turns (excluding tool results) */
  reasoningTurns: number;
  /** Wall-clock time the task took, in milliseconds */
  durationMs: number;
  /** Cognitive domain the task belongs to (e.g. "feishu-wiki", "code-review") */
  domain: string;
  /** Optional: raw transcript of the task interaction */
  transcript?: string;
  /** Whether trial-and-error patterns were detected during the task */
  hasTrialAndError?: boolean;
  /** Number of times the user corrected the agent during the task */
  userCorrections?: number;
  /** Evidence strings from the transcript showing trial-error patterns */
  trialErrorSignals?: string[];
  /** Automatically accumulated tool error profile from the agent runtime */
  errorProfile?: ToolErrorProfile;
};

/** A drafted Skill proposal generated from an evolution candidate. */
export type SkillDraft = {
  /** Skill name in kebab-case (e.g. "feishu-wiki-archive") */
  name: string;
  /** One-line description for YAML frontmatter */
  description: string;
  /** Phrases that should trigger this skill */
  triggerPhrases: string[];
  /** Full SKILL.md body markdown (excluding frontmatter) */
  bodyMarkdown: string;
  /** Optional reference files to include (filename → content) */
  references?: Record<string, string>;
  /** Optional script files to include (filename → content) */
  scripts?: Record<string, string>;
  /** Optional asset files to include (filename → content) */
  assets?: Record<string, string>;
};

/** Summary of a recent skill suggestion, provided as context for the agent. */
export type RecentSuggestionSummary = {
  skillName?: string;
  domain: string;
  hoursAgo: number;
  userResponse?: "accepted" | "modified" | "rejected";
};

/** A complete evolution record, persisted to disk. */
export type EvolutionRecord = {
  /** Unique record ID */
  id: string;
  /** User ID this record belongs to */
  userId: string;
  /** The candidate that triggered the evaluation */
  candidate: EvolutionCandidate;
  /** The drafted skill (only when a suggestion was made) */
  draft?: SkillDraft;
  /** User's response (undefined until user acts) */
  userResponse?: "accepted" | "modified" | "rejected";
  /** Path where the skill was saved (only after acceptance) */
  savedSkillPath?: string;
  /** Timestamp (epoch ms) */
  timestamp: number;
};

/** Configuration for the evolution engine. */
export type EvolutionConfig = {
  /** Whether the evolution engine is active (default true) */
  enabled: boolean;
};

/** Default evolution configuration. */
export const DEFAULT_EVOLUTION_CONFIG: EvolutionConfig = {
  enabled: true,
};

export type SkillPatch = {
  name: string;
  instructions: string;
  replacements?: Array<{ oldText: string; newText: string }>;
};

export type SkillPatchResult = { ok: true; updatedPath: string } | { ok: false; error: string };

export type SkillMeta = {
  name: string;
  description: string;
  createdAt: number;
  lastUsedAt: number;
  usageCount: number;
  isStale: boolean;
  /** "agent" = auto-created by evolution system, "user" = user-created/installed */
  provenance?: "agent" | "user";
};

export type DedupCheckResult =
  | { duplicate: false }
  | { duplicate: true; existingName: string; similarity: number };
