/**
 * Self-Evolution Engine — types and contracts.
 *
 * The engine evaluates whether completed agent tasks are worth
 * preserving as reusable Skills, drafts Skill proposals, and
 * tracks user acceptance/rejection to learn preferences.
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
  /** Optional reference files to include */
  references?: Record<string, string>;
};

/** The engine's decision on whether to suggest a skill. */
export type EvolutionDecision = {
  /** Whether to proactively suggest a skill to the user */
  shouldSuggest: boolean;
  /** Confidence of the suggestion (0-1) */
  confidence: number;
  /** Computed complexity score (0-1) */
  complexityScore: number;
  /** Human-readable explanation of the decision */
  reasoning: string;
};

/** User's response to a skill suggestion. */
export type EvolutionUserResponse = "accepted" | "modified" | "rejected";

/** A complete evolution record, persisted to disk. */
export type EvolutionRecord = {
  /** Unique record ID */
  id: string;
  /** User ID this record belongs to */
  userId: string;
  /** The candidate that triggered the evaluation */
  candidate: EvolutionCandidate;
  /** The engine's decision */
  decision: EvolutionDecision;
  /** The drafted skill (only when shouldSuggest=true) */
  draft?: SkillDraft;
  /** User's response (undefined until user acts) */
  userResponse?: EvolutionUserResponse;
  /** Path where the skill was saved (only after acceptance) */
  savedSkillPath?: string;
  /** Timestamp (epoch ms) */
  timestamp: number;
};

/** Configuration for the evolution engine. */
export type EvolutionConfig = {
  /** Minimum complexity score to trigger a suggestion (0-1, default 0.6) */
  minComplexity: number;
  /** Lower threshold used when tool errors or retries were detected (0-1, default 0.3) */
  errorComplexityThreshold: number;
  /** Minimum hours between suggestions for a user (default 24) */
  cooldownHours: number;
  /** Maximum suggestions per user per day (default 3) */
  maxSuggestionsPerDay: number;
  /** Minimum trust score to allow suggestions (0-1, default 0.5) */
  minTrustScore: number;
  /** Whether the evolution engine is active (default true) */
  enabled: boolean;
  /** Whether to enable ClawHub skill sharing (default false) */
  clawhubEnabled: boolean;
  /** ClawHub registry URL (default "https://clawhub.com") */
  clawhubRegistry: string;
  /** Whether to auto-publish accepted skills (default false) */
  clawhubAutoPublish: boolean;
};

/** Complexity evaluation factors contributing to the score. */
export type ComplexityFactor = {
  /** Factor name (e.g. "toolCount", "uniqueTools") */
  name: string;
  /** Raw value for this factor */
  raw: number;
  /** Normalized value (0-1) */
  normalized: number;
  /** Weight applied to this factor */
  weight: number;
};

/** Result of complexity evaluation. */
export type ComplexityResult = {
  /** Overall complexity score (0-1) */
  score: number;
  /** Individual factors that contributed */
  factors: ComplexityFactor[];
};

/** Default evolution configuration. */
export const DEFAULT_EVOLUTION_CONFIG: EvolutionConfig = {
  minComplexity: 0.4,
  errorComplexityThreshold: 0.3,
  cooldownHours: 24,
  maxSuggestionsPerDay: 3,
  minTrustScore: 0.5,
  enabled: true,
  clawhubEnabled: false,
  clawhubRegistry: "https://clawhub.com",
  clawhubAutoPublish: false,
};

export type ClawHubPublishResult =
  | { ok: true; slug: string; version: string }
  | { ok: false; error: string };

export type ClawHubSearchResult = {
  slug: string;
  name: string;
  description: string;
  version: string;
  downloads: number;
  author: string;
};

export type ClawHubSkillDetail = ClawHubSearchResult & {
  content: string;
  changelog?: string;
};

export type SkillPatch = {
  name: string;
  instructions: string;
  replacements?: Array<{ oldText: string; newText: string }>;
};

export type SkillPatchResult =
  | { ok: true; updatedPath: string }
  | { ok: false; error: string };

export type SkillMeta = {
  name: string;
  description: string;
  createdAt: number;
  lastUsedAt: number;
  usageCount: number;
  isStale: boolean;
};

export type DedupCheckResult =
  | { duplicate: false }
  | { duplicate: true; existingName: string; similarity: number };

export type TrialErrorResult = {
  detected: boolean;
  signals: string[];
  userCorrections: number;
  boost: number;
};
