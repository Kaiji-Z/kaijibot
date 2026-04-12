import type { KaijiBotConfig } from "../config/config.js";
import type { PluginRuntime } from "./runtime/types.js";
import type { KaijiBotPluginApi, PluginLogger } from "./types.js";

export type BuildPluginApiParams = {
  id: string;
  name: string;
  version?: string;
  description?: string;
  source: string;
  rootDir?: string;
  registrationMode: KaijiBotPluginApi["registrationMode"];
  config: KaijiBotConfig;
  pluginConfig?: Record<string, unknown>;
  runtime: PluginRuntime;
  logger: PluginLogger;
  resolvePath: (input: string) => string;
  handlers?: Partial<
    Pick<
      KaijiBotPluginApi,
      | "registerTool"
      | "registerHook"
      | "registerHttpRoute"
      | "registerChannel"
      | "registerGatewayMethod"
      | "registerCli"
      | "registerReload"
      | "registerNodeHostCommand"
      | "registerSecurityAuditCollector"
      | "registerService"
      | "registerCliBackend"
      | "registerConfigMigration"
      | "registerAutoEnableProbe"
      | "registerProvider"
      | "registerSpeechProvider"
      | "registerRealtimeTranscriptionProvider"
      | "registerRealtimeVoiceProvider"
      | "registerMediaUnderstandingProvider"
      | "registerImageGenerationProvider"
      | "registerVideoGenerationProvider"
      | "registerMusicGenerationProvider"
      | "registerWebFetchProvider"
      | "registerWebSearchProvider"
      | "registerInteractiveHandler"
      | "onConversationBindingResolved"
      | "registerCommand"
      | "registerContextEngine"
      | "registerCompactionProvider"
      | "registerMemoryCapability"
      | "registerMemoryPromptSection"
      | "registerMemoryPromptSupplement"
      | "registerMemoryCorpusSupplement"
      | "registerMemoryFlushPlan"
      | "registerMemoryRuntime"
      | "registerMemoryEmbeddingProvider"
      | "on"
    >
  >;
};

const noopRegisterTool: KaijiBotPluginApi["registerTool"] = () => {};
const noopRegisterHook: KaijiBotPluginApi["registerHook"] = () => {};
const noopRegisterHttpRoute: KaijiBotPluginApi["registerHttpRoute"] = () => {};
const noopRegisterChannel: KaijiBotPluginApi["registerChannel"] = () => {};
const noopRegisterGatewayMethod: KaijiBotPluginApi["registerGatewayMethod"] = () => {};
const noopRegisterCli: KaijiBotPluginApi["registerCli"] = () => {};
const noopRegisterReload: KaijiBotPluginApi["registerReload"] = () => {};
const noopRegisterNodeHostCommand: KaijiBotPluginApi["registerNodeHostCommand"] = () => {};
const noopRegisterSecurityAuditCollector: KaijiBotPluginApi["registerSecurityAuditCollector"] =
  () => {};
const noopRegisterService: KaijiBotPluginApi["registerService"] = () => {};
const noopRegisterCliBackend: KaijiBotPluginApi["registerCliBackend"] = () => {};
const noopRegisterConfigMigration: KaijiBotPluginApi["registerConfigMigration"] = () => {};
const noopRegisterAutoEnableProbe: KaijiBotPluginApi["registerAutoEnableProbe"] = () => {};
const noopRegisterProvider: KaijiBotPluginApi["registerProvider"] = () => {};
const noopRegisterSpeechProvider: KaijiBotPluginApi["registerSpeechProvider"] = () => {};
const noopRegisterRealtimeTranscriptionProvider: KaijiBotPluginApi["registerRealtimeTranscriptionProvider"] =
  () => {};
const noopRegisterRealtimeVoiceProvider: KaijiBotPluginApi["registerRealtimeVoiceProvider"] =
  () => {};
const noopRegisterMediaUnderstandingProvider: KaijiBotPluginApi["registerMediaUnderstandingProvider"] =
  () => {};
const noopRegisterImageGenerationProvider: KaijiBotPluginApi["registerImageGenerationProvider"] =
  () => {};
const noopRegisterVideoGenerationProvider: KaijiBotPluginApi["registerVideoGenerationProvider"] =
  () => {};
const noopRegisterMusicGenerationProvider: KaijiBotPluginApi["registerMusicGenerationProvider"] =
  () => {};
const noopRegisterWebFetchProvider: KaijiBotPluginApi["registerWebFetchProvider"] = () => {};
const noopRegisterWebSearchProvider: KaijiBotPluginApi["registerWebSearchProvider"] = () => {};
const noopRegisterInteractiveHandler: KaijiBotPluginApi["registerInteractiveHandler"] = () => {};
const noopOnConversationBindingResolved: KaijiBotPluginApi["onConversationBindingResolved"] =
  () => {};
const noopRegisterCommand: KaijiBotPluginApi["registerCommand"] = () => {};
const noopRegisterContextEngine: KaijiBotPluginApi["registerContextEngine"] = () => {};
const noopRegisterCompactionProvider: KaijiBotPluginApi["registerCompactionProvider"] = () => {};
const noopRegisterMemoryCapability: KaijiBotPluginApi["registerMemoryCapability"] = () => {};
const noopRegisterMemoryPromptSection: KaijiBotPluginApi["registerMemoryPromptSection"] = () => {};
const noopRegisterMemoryPromptSupplement: KaijiBotPluginApi["registerMemoryPromptSupplement"] =
  () => {};
const noopRegisterMemoryCorpusSupplement: KaijiBotPluginApi["registerMemoryCorpusSupplement"] =
  () => {};
const noopRegisterMemoryFlushPlan: KaijiBotPluginApi["registerMemoryFlushPlan"] = () => {};
const noopRegisterMemoryRuntime: KaijiBotPluginApi["registerMemoryRuntime"] = () => {};
const noopRegisterMemoryEmbeddingProvider: KaijiBotPluginApi["registerMemoryEmbeddingProvider"] =
  () => {};
const noopOn: KaijiBotPluginApi["on"] = () => {};

export function buildPluginApi(params: BuildPluginApiParams): KaijiBotPluginApi {
  const handlers = params.handlers ?? {};
  return {
    id: params.id,
    name: params.name,
    version: params.version,
    description: params.description,
    source: params.source,
    rootDir: params.rootDir,
    registrationMode: params.registrationMode,
    config: params.config,
    pluginConfig: params.pluginConfig,
    runtime: params.runtime,
    logger: params.logger,
    registerTool: handlers.registerTool ?? noopRegisterTool,
    registerHook: handlers.registerHook ?? noopRegisterHook,
    registerHttpRoute: handlers.registerHttpRoute ?? noopRegisterHttpRoute,
    registerChannel: handlers.registerChannel ?? noopRegisterChannel,
    registerGatewayMethod: handlers.registerGatewayMethod ?? noopRegisterGatewayMethod,
    registerCli: handlers.registerCli ?? noopRegisterCli,
    registerReload: handlers.registerReload ?? noopRegisterReload,
    registerNodeHostCommand: handlers.registerNodeHostCommand ?? noopRegisterNodeHostCommand,
    registerSecurityAuditCollector:
      handlers.registerSecurityAuditCollector ?? noopRegisterSecurityAuditCollector,
    registerService: handlers.registerService ?? noopRegisterService,
    registerCliBackend: handlers.registerCliBackend ?? noopRegisterCliBackend,
    registerConfigMigration: handlers.registerConfigMigration ?? noopRegisterConfigMigration,
    registerAutoEnableProbe: handlers.registerAutoEnableProbe ?? noopRegisterAutoEnableProbe,
    registerProvider: handlers.registerProvider ?? noopRegisterProvider,
    registerSpeechProvider: handlers.registerSpeechProvider ?? noopRegisterSpeechProvider,
    registerRealtimeTranscriptionProvider:
      handlers.registerRealtimeTranscriptionProvider ?? noopRegisterRealtimeTranscriptionProvider,
    registerRealtimeVoiceProvider:
      handlers.registerRealtimeVoiceProvider ?? noopRegisterRealtimeVoiceProvider,
    registerMediaUnderstandingProvider:
      handlers.registerMediaUnderstandingProvider ?? noopRegisterMediaUnderstandingProvider,
    registerImageGenerationProvider:
      handlers.registerImageGenerationProvider ?? noopRegisterImageGenerationProvider,
    registerVideoGenerationProvider:
      handlers.registerVideoGenerationProvider ?? noopRegisterVideoGenerationProvider,
    registerMusicGenerationProvider:
      handlers.registerMusicGenerationProvider ?? noopRegisterMusicGenerationProvider,
    registerWebFetchProvider: handlers.registerWebFetchProvider ?? noopRegisterWebFetchProvider,
    registerWebSearchProvider: handlers.registerWebSearchProvider ?? noopRegisterWebSearchProvider,
    registerInteractiveHandler:
      handlers.registerInteractiveHandler ?? noopRegisterInteractiveHandler,
    onConversationBindingResolved:
      handlers.onConversationBindingResolved ?? noopOnConversationBindingResolved,
    registerCommand: handlers.registerCommand ?? noopRegisterCommand,
    registerContextEngine: handlers.registerContextEngine ?? noopRegisterContextEngine,
    registerCompactionProvider:
      handlers.registerCompactionProvider ?? noopRegisterCompactionProvider,
    registerMemoryCapability: handlers.registerMemoryCapability ?? noopRegisterMemoryCapability,
    registerMemoryPromptSection:
      handlers.registerMemoryPromptSection ?? noopRegisterMemoryPromptSection,
    registerMemoryPromptSupplement:
      handlers.registerMemoryPromptSupplement ?? noopRegisterMemoryPromptSupplement,
    registerMemoryCorpusSupplement:
      handlers.registerMemoryCorpusSupplement ?? noopRegisterMemoryCorpusSupplement,
    registerMemoryFlushPlan: handlers.registerMemoryFlushPlan ?? noopRegisterMemoryFlushPlan,
    registerMemoryRuntime: handlers.registerMemoryRuntime ?? noopRegisterMemoryRuntime,
    registerMemoryEmbeddingProvider:
      handlers.registerMemoryEmbeddingProvider ?? noopRegisterMemoryEmbeddingProvider,
    resolvePath: params.resolvePath,
    on: handlers.on ?? noopOn,
  };
}
