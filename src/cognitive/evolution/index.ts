// Evolution module — Self-Evolution Engine
export { evaluateComplexity } from "./complexity-evaluator.js";
export { generateSkillDraft, toKebabCase, sanitizeSkillName } from "./skill-draft-generator.js";
export { generateSkillDraftLLM, buildPrompt as buildDraftPrompt, validateAndRepair as validateDraftRepair } from "./llm-draft-generator.js";
export type { LlmDraftDeps } from "./llm-draft-generator.js";
export { EvolutionPreferenceAdapter } from "./preference-adapter.js";
export { EvolutionStore, createEvolutionDir } from "./store.js";
export { EvolutionEngine } from "./engine.js";
export type { DraftGeneratorFn } from "./engine.js";
export { SkillPersistenceWriter } from "./skill-writer.js";
export { AuditLog } from "./audit-log.js";
export {
  DEFAULT_EVOLUTION_CONFIG,
} from "./types.js";
export type {
  EvolutionCandidate,
  SkillDraft,
  EvolutionDecision,
  EvolutionUserResponse,
  EvolutionRecord,
  EvolutionConfig,
  ComplexityFactor,
  ComplexityResult,
} from "./types.js";
export { SafetyGate } from "./safety-gate.js";
export type { RiskLevel, OperationRequest, SafetyDecision } from "./safety-gate.js";
export type { AuditEntry } from "./audit-log.js";
