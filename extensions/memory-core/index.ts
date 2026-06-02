import { definePluginEntry } from "kaijibot/plugin-sdk/plugin-entry";
import { registerMemoryCli } from "./src/cli.js";
import {
  buildMemoryFlushPlan,
  DEFAULT_MEMORY_FLUSH_FORCE_TRANSCRIPT_BYTES,
  DEFAULT_MEMORY_FLUSH_PROMPT,
  DEFAULT_MEMORY_FLUSH_SOFT_TOKENS,
} from "./src/flush-plan.js";
import { registerBuiltInMemoryEmbeddingProviders } from "./src/memory/provider-adapters.js";
import { buildPromptSection } from "./src/prompt-section.js";
import { listMemoryCorePublicArtifacts } from "./src/public-artifacts.js";
import { memoryRuntime } from "./src/runtime-provider.js";
import { createMemoryGetTool, createMemorySearchTool } from "./src/tools.js";
import { createMemorySaveTool } from "./src/tools.memory-save.js";
import { createMemoryTidyTool } from "./src/tools.memory-tidy.js";
export {
  buildMemoryFlushPlan,
  DEFAULT_MEMORY_FLUSH_FORCE_TRANSCRIPT_BYTES,
  DEFAULT_MEMORY_FLUSH_PROMPT,
  DEFAULT_MEMORY_FLUSH_SOFT_TOKENS,
} from "./src/flush-plan.js";
export { buildPromptSection } from "./src/prompt-section.js";
export { TopicManager, createTopicManager, type TopicManagerDeps } from "./src/topic-manager.js";
export {
  type TopicFile,
  type TopicEntry,
  parseTopicFile,
  parseTopicEntry,
  parseTopicEntryHeading,
  serializeTopicFile,
  serializeTopicEntry,
  createEmptyTopicFile,
  formatEntryHeading,
} from "./src/topic-types.js";
export {
  MemoryIndexManager,
  type MemoryIndexDeps,
  type MemoryIndex,
  type MemoryIndexSection,
  type RecentSession,
  parseMemoryIndex,
  serializeIndex,
  parseMemoryIndexDiagnostic,
  getCanonicalSectionOrder,
  type DiagnosticMemoryIndex,
  type UnknownHeading,
  type OrphanLine,
  type DuplicateHeading,
  type LegacyHeading,
} from "./src/memory-index.js";
export { incrementGroundedCount } from "./src/short-term-promotion.js";
export {
  runConsolidationForAgent,
  runConsolidationAllAgents,
  registerConsolidationCron,
  type ConsolidationDeps,
  type ConsolidationRouteDeps,
} from "./src/consolidation.js";
export {
  repairMemoryStructure,
  diagnoseStructure,
  planRepair,
  classifyHeuristic,
  classifyWithLLM,
  verifyStructure,
  type RepairSeverity,
  type StructuralIssue,
  type RepairDiagnostic,
  type RepairAction,
  type RepairPlan,
  type RepairResult,
  type MemoryRepairDeps,
} from "./src/memory-repair.js";
export type {
  ExtractedItem,
  RouteItem,
  TranscriptBatch,
  ConsolidationCheckpoint,
  ConsolidationResult,
  FileWithUserId,
} from "./src/consolidation-types.js";
export { routeToStores } from "./src/consolidation-route.js";
export {
  extractFromBatch,
  mergeAndDedupBatches,
  resolveConflicts,
} from "./src/consolidation-extract.js";
export {
  TopicRegistry,
  createTopicRegistry,
  type TopicMeta,
  type TopicRegistryData,
  type TopicRegistryDeps,
} from "./src/topic-registry.js";
export {
  routeToTopic,
  kebabMatch,
  type TopicCandidate,
  type RouteResult,
  type RouteToTopicParams,
} from "./src/topic-router.js";
export {
  semanticTopicMerge,
  computeTopicJaccard,
  type TopicForMerge,
  type MergeCandidate,
  type SemanticMergeParams,
  type SemanticMergeResult,
} from "./src/semantic-merge.js";

export default definePluginEntry({
  id: "memory-core",
  name: "Memory (Core)",
  description: "File-backed memory search tools and CLI",
  kind: "memory",
  register(api) {
    registerBuiltInMemoryEmbeddingProviders(api);
    api.registerMemoryCapability({
      promptBuilder: buildPromptSection,
      flushPlanResolver: buildMemoryFlushPlan,
      runtime: memoryRuntime,
      publicArtifacts: {
        listArtifacts: listMemoryCorePublicArtifacts,
      },
    });

    api.registerTool(
      (ctx) =>
        createMemorySearchTool({
          config: ctx.config,
          agentSessionKey: ctx.sessionKey,
        }),
      { names: ["memory_search"] },
    );

    api.registerTool(
      (ctx) =>
        createMemoryGetTool({
          config: ctx.config,
          agentSessionKey: ctx.sessionKey,
        }),
      { names: ["memory_get"] },
    );

    api.registerTool(
      (ctx) =>
        createMemoryTidyTool({
          config: ctx.config,
          agentSessionKey: ctx.sessionKey,
        }),
      { names: ["memory_tidy"] },
    );

    api.registerTool(
      (ctx) =>
        createMemorySaveTool({
          config: ctx.config,
          agentSessionKey: ctx.sessionKey,
        }),
      { names: ["memory_save"] },
    );

    api.registerCli(
      ({ program }) => {
        registerMemoryCli(program);
      },
      {
        descriptors: [
          {
            name: "memory",
            description: "Search, inspect, and reindex memory files",
            hasSubcommands: true,
          },
        ],
      },
    );
  },
});
