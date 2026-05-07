import { z } from "zod";
import type { PersonaTree } from "../types.js";

const insightCategorySchema = z.enum([
  "domain_knowledge",
  "behavioral_pattern",
  "stated_preference",
  "tool_config",
  "contextual_fact",
  "goal_or_aspiration",
]);

const typedInsightSchema = z.object({
  text: z.string(),
  category: insightCategorySchema,
  confidence: z.number(),
  source: z.enum(["explicit", "inferred", "observed"]),
  firstObserved: z.number(),
  lastReinforced: z.number(),
  evidenceCount: z.number(),
  halfLifeDays: z.number(),
});

const interestPhaseSchema = z.enum(["emergent", "stable", "declining", "dormant", "revived"]);

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
  insights: z.array(typedInsightSchema).optional(),
  activeQuestions: z.array(z.string()),
  negationSignals: z.number().optional().default(0),
  lastNegatedAt: z.number().optional(),
  phase: interestPhaseSchema.optional(),
  phaseEnteredAt: z.number().optional(),
});

const topicBanditSchema = z.object({
  alpha: z.number(),
  beta: z.number(),
});

const feedbackProfileSchema = z.object({
  topicBandits: z.record(z.string(), topicBanditSchema),
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
  totalActiveDays: z.number().optional().default(0),
});

const calibrationRecordSchema = z.object({
  insightId: z.string(),
  predictedPAccept: z.number(),
  actualOutcome: z.enum(["positive", "negative", "neutral", "engaged", "no_response"]),
  timestamp: z.number(),
});

const personaTreeSchema = z.object({
  identity: z.object({
    displayName: z.string().optional(),
    coreTraits: z.record(z.string(), confidenceValueSchema),
    communicationStyle: communicationStyleSchema.optional(),
    primaryLanguage: z.string().optional(),
    expertDomains: z.array(z.string()),
    interestDomains: z.array(z.string()),
    curiosityDomains: z.array(z.string()),
  }),
  domains: z.record(z.string(), domainNodeSchema),
  recentFocus: z.array(z.string()),
  feedbackProfile: feedbackProfileSchema,
  rapport: rapportMetricsSchema,
  domainBlacklist: z.array(z.string()).optional().default([]),
  lifecycle: userLifecycleSchema.optional().default({
    stage: "new",
    lastActiveAt: 0,
    lastStageTransitionAt: 0,
    totalActiveDays: 0,
  }),
  moodHistory: z.array(z.any()).optional().default([]),
  calibrationHistory: z.array(calibrationRecordSchema).optional().default([]),
}).strip();

export function safeParsePersona(json: unknown): PersonaTree | null {
  const result = personaTreeSchema.safeParse(json);
  if (!result.success) {
    return null;
  }
  return result.data as PersonaTree;
}
