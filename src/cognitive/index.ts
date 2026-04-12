export * from "./types.js";
export { classifyMode, buildModePromptSection } from "./mode-router.js";
export { buildCognitiveModePrompt } from "./context-writer.js";

// Persona module
export { PersonaStore, createDefaultPersona } from "./persona/store.js";
export { mergeExtraction, prunePersona } from "./persona/curator.js";
export { extractFromMessage } from "./persona/extractor.js";
export { extractFromMessageLLM, createDefaultDeps as createDefaultExtractorDeps } from "./persona/llm-extractor.js";
export type { LlmExtractorDeps, LlmExtractorOptions } from "./persona/llm-extractor.js";
export { buildPersonaContext } from "./persona/context-builder.js";
export type { ExtractedAttribute, ExtractionResult } from "./persona/types.js";

// Feedback module
export { processFeedback, processImplicitFeedback, extractImplicitSignals } from "./feedback/collector.js";
export { updateBanditFromFeedback, pickBestTopic, adaptFrequency, sampleTopicScores, getTopicSummaries } from "./feedback/preference-learner.js";
export { updateTrustFromFeedback, updateTrustFromImplicit, calculateTrustScore, getInteractionPhase, getPhaseBehaviorAdvice } from "./feedback/trust-calculator.js";
export type { FeedbackEvent, ImplicitFeedbackSignal, TopicFeedbackSummary } from "./feedback/types.js";

// Insight module
export { InsightStore } from "./insight/store.js";
export { generateInsightCandidates } from "./insight/engine.js";
export { generateInsightCandidatesLLM, createDefaultInsightDeps } from "./insight/llm-engine.js";
export type { LlmInsightDeps, LlmInsightOptions } from "./insight/llm-engine.js";
export { findCrossDomainConnections, semanticDistance, discoverDomainsFromPersona, extendDomainGraph } from "./insight/cross-domain-mapper.js";
export type { DomainGraph } from "./insight/cross-domain-mapper.js";
export { scoreSerendipity } from "./insight/serendipity-scorer.js";
export { verifyInsight } from "./insight/verification/pipeline.js";
export type { InsightEngineInput, InsightCandidate, VerificationResult } from "./insight/types.js";

// Scheduler module
export { ProactiveScheduler } from "./scheduler/proactive-scheduler.js";
export type { InsightGeneratorFn } from "./scheduler/proactive-scheduler.js";
export { checkProactiveGate } from "./scheduler/gate.js";
export { TimerSource } from "./scheduler/event-sources/timer-source.js";
export { PersonaChangeSource } from "./scheduler/event-sources/persona-change-source.js";
export type { SchedulerEvent, GateDecision, SchedulerConfig } from "./scheduler/types.js";
