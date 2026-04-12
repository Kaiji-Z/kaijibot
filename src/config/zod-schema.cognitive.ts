import { z } from "zod";

export const CognitiveProactiveSchema = z
  .object({
    enabled: z.boolean().optional(),
    minIntervalHours: z.number().min(0.5).max(168).optional(),
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
    autoExtract: z.boolean().optional(),
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
    verificationLevel: z.enum(["basic", "strict", "paranoid"]).optional(),
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

export const CognitiveSchema = z
  .object({
    enabled: z.boolean().optional(),
    proactive: CognitiveProactiveSchema,
    persona: CognitivePersonaSchema,
    insight: CognitiveInsightSchema,
    feedback: CognitiveFeedbackSchema,
  })
  .strict()
  .optional();
