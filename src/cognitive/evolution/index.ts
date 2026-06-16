// Evolution module — Self-Evolution Engine
export { generateSkillDraft, toKebabCase, sanitizeSkillName } from "./skill-draft-generator.js";
export {
  generateSkillDraftLLM,
  buildPrompt as buildDraftPrompt,
  validateAndRepair as validateDraftRepair,
} from "./llm-draft-generator.js";
export type { LlmDraftDeps } from "./llm-draft-generator.js";
export { EvolutionStore, createEvolutionDir } from "./store.js";
export { EvolutionEngine } from "./engine.js";
export type { DraftGeneratorFn } from "./engine.js";
export { SkillPersistenceWriter } from "./skill-writer.js";
export { SkillLifecycleManager } from "./skill-lifecycle.js";
export { AuditLog } from "./audit-log.js";
export { DEFAULT_EVOLUTION_CONFIG } from "./types.js";
export type {
  EvolutionCandidate,
  SkillDraft,
  EvolutionRecord,
  EvolutionConfig,
  RecentSuggestionSummary,
  ToolErrorProfile,
  SkillPatch,
  SkillPatchResult,
  SkillMeta,
  DedupCheckResult,
} from "./types.js";
export type { AuditEntry } from "./audit-log.js";
