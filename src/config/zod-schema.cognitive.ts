import { z } from "zod";

export const CognitiveProactiveSchema = z
  .object({
    enabled: z.boolean().default(true),
    minIntervalHours: z.number().min(0.5).max(168).default(0.5),
    activeHours: z
      .object({
        start: z.string().optional(),
        end: z.string().optional(),
        timezone: z.string().optional(),
      })
      .strict()
      .optional(),
    digestMode: z.enum(["realtime", "daily", "weekly"]).optional(),
    costFalseNegative: z.number().min(0.1).max(100).optional(),
    costFalseAlarm: z.number().min(0.1).max(100).optional(),
  })
  .strict()
  .optional();

export const CognitivePersonaSchema = z
  .object({
    autoExtract: z.boolean().default(true),
    extractionModel: z.string().optional(),
    identityRefreshHours: z.number().min(1).max(720).optional(),
  })
  .strict()
  .optional();

export const CognitiveInsightSchema = z
  .object({
    sources: z
      .object({
        webSearchProvider: z.string().optional(),
        scanIntervalHours: z.number().min(1).max(168).optional(),
        explicitTopics: z.array(z.string()).optional(),
      })
      .strict()
      .optional(),
    engine: z.enum(["v1", "v2", "dual"]).optional(),
    verificationLevel: z.enum(["basic", "strict", "paranoid"]).optional(),
    inferenceModel: z.string().optional(),
    surpriseRatio: z.number().min(0).max(1).optional(),
    outputLanguage: z.string().optional(),
  })
  .strict()
  .optional();

export const CognitiveFeedbackSchema = z
  .object({
    mechanism: z.enum(["emoji", "buttons", "text"]).optional(),
    implicitFeedback: z.boolean().optional(),
  })
  .strict()
  .optional();

export const CognitiveEvolutionSchema = z
  .object({
    enabled: z.boolean().default(true),
    minComplexity: z.number().min(0).max(1).default(0.6),
    errorComplexityThreshold: z.number().min(0).max(1).default(0.3),
    clawhubEnabled: z.boolean().optional(),
    clawhubRegistry: z.string().url().optional(),
    clawhubAutoPublish: z.boolean().optional(),
  })
  .strict()
  .optional();

export const CognitiveSchema = z
  .object({
    enabled: z.boolean().default(true),
    proactive: CognitiveProactiveSchema,
    persona: CognitivePersonaSchema,
    insight: CognitiveInsightSchema,
    feedback: CognitiveFeedbackSchema,
    evolution: CognitiveEvolutionSchema,
  })
  .strict()
  .optional();
