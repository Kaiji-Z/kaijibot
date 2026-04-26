import { z } from "zod";
import type { PersonaTree } from "../types.js";

const confidenceValueSchema = z.object({
  value: z.unknown(),
  confidence: z.number(),
  evidenceCount: z.number(),
  lastUpdated: z.number(),
  source: z.enum(["explicit", "inferred", "observed"]),
});

const communicationStyleSchema = z.object({
  formality: z.enum(["formal", "casual", "mixed"]),
  verbosity: z.enum(["concise", "moderate", "detailed"]),
  technicalLevel: z.enum(["beginner", "intermediate", "expert"]),
  preferredLanguage: z.enum(["zh", "en", "mixed"]),
});

const domainNodeSchema = z.object({
  depth: z.number(),
  recurrence: z.number(),
  lastMentioned: z.number(),
  keyInsights: z.array(z.string()),
  activeQuestions: z.array(z.string()),
  connections: z.array(z.string()),
  negationSignals: z.number().optional().default(0),
  lastNegatedAt: z.number().optional(),
});

const topicBanditSchema = z.object({
  alpha: z.number(),
  beta: z.number(),
});

const feedbackProfileSchema = z.object({
  topicBandits: z.record(z.string(), topicBanditSchema),
  preferredStyle: z.enum(["question", "observation", "connection"]),
  optimalFrequencyHours: z.number(),
  lastProactiveAt: z.number(),
  suppressUntil: z.number().optional(),
  recentInsightIds: z.array(z.string()).optional().default([]),
  recentInsightContents: z.array(z.string()).optional().default([]),
  recentInsightDomains: z.array(z.array(z.string())).optional().default([]),
  recentInsightTypes: z.array(z.string()).optional().default([]),
  recentInsightQueryHistory: z.array(z.string()).optional().default([]),
});

const rapportMetricsSchema = z.object({
  trustScore: z.number().min(0).max(1),
  totalExchanges: z.number(),
  avgResponseLength: z.number(),
  selfDisclosureLevel: z.number().min(0).max(1),
});

const userLifecycleSchema = z.object({
  stage: z.enum(["new", "active", "dormant", "lapsed"]).optional().default("new"),
  lastActiveAt: z.number().optional().default(0),
  lastStageTransitionAt: z.number().optional().default(0),
  consecutiveSilentDays: z.number().optional().default(0),
  totalActiveDays: z.number().optional().default(0),
});

const calibrationRecordSchema = z.object({
  insightId: z.string(),
  predictedPAccept: z.number(),
  actualOutcome: z.enum(["positive", "negative", "neutral", "engaged", "no_response"]),
  timestamp: z.number(),
});

const contradictionRecordSchema = z.object({
  field: z.string(),
  oldValue: z.string(),
  newValue: z.string(),
  oldConfidence: z.number(),
  newConfidence: z.number(),
  oldSource: z.enum(["explicit", "inferred", "observed"]),
  newSource: z.enum(["explicit", "inferred", "observed"]),
  resolution: z.enum(["resolved_new", "resolved_old", "resolved_merge"]),
  resolvedAt: z.number(),
});

const personaTreeSchema = z.object({
  identity: z.object({
    coreTraits: z.record(z.string(), confidenceValueSchema),
    communicationStyle: communicationStyleSchema.optional(),
    timezone: z.string().optional(),
    primaryLanguage: z.string().optional(),
    expertDomains: z.array(z.string()),
    interestDomains: z.array(z.string()),
    curiosityDomains: z.array(z.string()),
  }),
  domains: z.record(z.string(), domainNodeSchema),
  recentFocus: z.array(z.string()),
  activeProjects: z.array(z.string()),
  pendingQuestions: z.array(z.string()).optional().default([]),
  feedbackProfile: feedbackProfileSchema,
  rapport: rapportMetricsSchema,
  domainBlacklist: z.array(z.string()).optional().default([]),
  lifecycle: userLifecycleSchema.optional().default({
    stage: "new",
    lastActiveAt: 0,
    lastStageTransitionAt: 0,
    consecutiveSilentDays: 0,
    totalActiveDays: 0,
  }),
  moodHistory: z.array(z.any()).optional().default([]),
  calibrationHistory: z.array(calibrationRecordSchema).optional().default([]),
  contradictionLog: z.array(contradictionRecordSchema).optional().default([]),
}).passthrough();

export function safeParsePersona(json: unknown): PersonaTree | null {
  const result = personaTreeSchema.safeParse(json);
  if (!result.success) {
    return null;
  }
  return result.data as PersonaTree;
}
