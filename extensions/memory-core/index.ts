import { definePluginEntry } from "kaijibot/plugin-sdk/plugin-entry";
import { registerMemoryCli } from "./src/cli.js";
import { registerDreamingCommand } from "./src/dreaming-command.js";
import { registerShortTermPromotionDreaming } from "./src/dreaming.js";
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
import { createMemoryTidyTool } from "./src/tools.memory-tidy.js";
import { createMemorySaveTool } from "./src/tools.memory-save.js";
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
  DEFAULT_TOPIC_FILES,
  parseTopicFile,
  parseTopicEntry,
  parseTopicEntryHeading,
  serializeTopicFile,
  serializeTopicEntry,
  createEmptyTopicFile,
  formatEntryHeading,
} from "./src/topic-types.js";
export { MemoryIndexManager, type MemoryIndexDeps, type MemoryIndex, type MemoryIndexSection, type RecentSession } from "./src/memory-index.js";
export { incrementGroundedCount } from "./src/short-term-promotion.js";

export default definePluginEntry({
  id: "memory-core",
  name: "Memory (Core)",
  description: "File-backed memory search tools and CLI",
  kind: "memory",
  register(api) {
    registerBuiltInMemoryEmbeddingProviders(api);
    registerShortTermPromotionDreaming(api);
    registerDreamingCommand(api);
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
