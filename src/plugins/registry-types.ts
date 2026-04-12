import type { ChannelPlugin } from "../channels/plugins/types.js";
import type { OperatorScope } from "../gateway/method-scopes.js";
import type { GatewayRequestHandlers } from "../gateway/server-methods/types.js";
import type { HookEntry } from "../hooks/types.js";
import type { PluginActivationSource } from "./config-state.js";
import type { PluginManifestContracts } from "./manifest.js";
import type { MemoryEmbeddingProviderAdapter } from "./memory-embedding-providers.js";
import type { PluginRuntime } from "./runtime/types.js";
import type {
  CliBackendPlugin,
  ImageGenerationProviderPlugin,
  MediaUnderstandingProviderPlugin,
  MusicGenerationProviderPlugin,
  KaijiBotPluginChannelRegistration,
  KaijiBotPluginCliCommandDescriptor,
  KaijiBotPluginCliRegistrar,
  KaijiBotPluginCommandDefinition,
  KaijiBotPluginHttpRouteAuth,
  KaijiBotPluginHttpRouteHandler,
  KaijiBotPluginHttpRouteMatch,
  KaijiBotPluginReloadRegistration,
  KaijiBotPluginSecurityAuditCollector,
  KaijiBotPluginService,
  KaijiBotPluginToolFactory,
  PluginBundleFormat,
  PluginConfigUiHint,
  PluginConversationBindingResolvedEvent,
  PluginDiagnostic,
  PluginFormat,
  PluginHookRegistration as TypedPluginHookRegistration,
  PluginKind,
  PluginLogger,
  PluginOrigin,
  ProviderPlugin,
  RealtimeTranscriptionProviderPlugin,
  RealtimeVoiceProviderPlugin,
  SpeechProviderPlugin,
  VideoGenerationProviderPlugin,
  WebFetchProviderPlugin,
  WebSearchProviderPlugin,
} from "./types.js";

export type PluginToolRegistration = {
  pluginId: string;
  pluginName?: string;
  factory: KaijiBotPluginToolFactory;
  names: string[];
  optional: boolean;
  source: string;
  rootDir?: string;
};

export type PluginCliRegistration = {
  pluginId: string;
  pluginName?: string;
  register: KaijiBotPluginCliRegistrar;
  commands: string[];
  descriptors: KaijiBotPluginCliCommandDescriptor[];
  source: string;
  rootDir?: string;
};

export type PluginHttpRouteRegistration = {
  pluginId?: string;
  path: string;
  handler: KaijiBotPluginHttpRouteHandler;
  auth: KaijiBotPluginHttpRouteAuth;
  match: KaijiBotPluginHttpRouteMatch;
  source?: string;
};

export type PluginChannelRegistration = {
  pluginId: string;
  pluginName?: string;
  plugin: ChannelPlugin;
  source: string;
  rootDir?: string;
};

export type PluginChannelSetupRegistration = {
  pluginId: string;
  pluginName?: string;
  plugin: ChannelPlugin;
  source: string;
  enabled: boolean;
  rootDir?: string;
};

export type PluginProviderRegistration = {
  pluginId: string;
  pluginName?: string;
  provider: ProviderPlugin;
  source: string;
  rootDir?: string;
};

export type PluginCliBackendRegistration = {
  pluginId: string;
  pluginName?: string;
  backend: CliBackendPlugin;
  source: string;
  rootDir?: string;
};

type PluginOwnedProviderRegistration<T extends { id: string }> = {
  pluginId: string;
  pluginName?: string;
  provider: T;
  source: string;
  rootDir?: string;
};

export type PluginSpeechProviderRegistration =
  PluginOwnedProviderRegistration<SpeechProviderPlugin>;
export type PluginRealtimeTranscriptionProviderRegistration =
  PluginOwnedProviderRegistration<RealtimeTranscriptionProviderPlugin>;
export type PluginRealtimeVoiceProviderRegistration =
  PluginOwnedProviderRegistration<RealtimeVoiceProviderPlugin>;
export type PluginMediaUnderstandingProviderRegistration =
  PluginOwnedProviderRegistration<MediaUnderstandingProviderPlugin>;
export type PluginImageGenerationProviderRegistration =
  PluginOwnedProviderRegistration<ImageGenerationProviderPlugin>;
export type PluginVideoGenerationProviderRegistration =
  PluginOwnedProviderRegistration<VideoGenerationProviderPlugin>;
export type PluginMusicGenerationProviderRegistration =
  PluginOwnedProviderRegistration<MusicGenerationProviderPlugin>;
export type PluginWebFetchProviderRegistration =
  PluginOwnedProviderRegistration<WebFetchProviderPlugin>;
export type PluginWebSearchProviderRegistration =
  PluginOwnedProviderRegistration<WebSearchProviderPlugin>;
export type PluginMemoryEmbeddingProviderRegistration =
  PluginOwnedProviderRegistration<MemoryEmbeddingProviderAdapter>;

export type PluginHookRegistration = {
  pluginId: string;
  entry: HookEntry;
  events: string[];
  source: string;
  rootDir?: string;
};

export type PluginServiceRegistration = {
  pluginId: string;
  pluginName?: string;
  service: KaijiBotPluginService;
  source: string;
  rootDir?: string;
};

export type PluginReloadRegistration = {
  pluginId: string;
  pluginName?: string;
  registration: KaijiBotPluginReloadRegistration;
  source: string;
  rootDir?: string;
};

export type PluginNodeHostCommandRegistration = {
  pluginId: string;
  pluginName?: string;
  command: import("./types.js").KaijiBotPluginNodeHostCommand;
  source: string;
  rootDir?: string;
};

export type PluginSecurityAuditCollectorRegistration = {
  pluginId: string;
  pluginName?: string;
  collector: KaijiBotPluginSecurityAuditCollector;
  source: string;
  rootDir?: string;
};

export type PluginCommandRegistration = {
  pluginId: string;
  pluginName?: string;
  command: KaijiBotPluginCommandDefinition;
  source: string;
  rootDir?: string;
};

export type PluginConversationBindingResolvedHandlerRegistration = {
  pluginId: string;
  pluginName?: string;
  pluginRoot?: string;
  handler: (event: PluginConversationBindingResolvedEvent) => void | Promise<void>;
  source: string;
  rootDir?: string;
};

export type PluginRecord = {
  id: string;
  name: string;
  version?: string;
  description?: string;
  format?: PluginFormat;
  bundleFormat?: PluginBundleFormat;
  bundleCapabilities?: string[];
  kind?: PluginKind | PluginKind[];
  source: string;
  rootDir?: string;
  origin: PluginOrigin;
  workspaceDir?: string;
  enabled: boolean;
  explicitlyEnabled?: boolean;
  activated?: boolean;
  imported?: boolean;
  activationSource?: PluginActivationSource;
  activationReason?: string;
  status: "loaded" | "disabled" | "error";
  error?: string;
  failedAt?: Date;
  failurePhase?: "validation" | "load" | "register";
  toolNames: string[];
  hookNames: string[];
  channelIds: string[];
  cliBackendIds: string[];
  providerIds: string[];
  speechProviderIds: string[];
  realtimeTranscriptionProviderIds: string[];
  realtimeVoiceProviderIds: string[];
  mediaUnderstandingProviderIds: string[];
  imageGenerationProviderIds: string[];
  videoGenerationProviderIds: string[];
  musicGenerationProviderIds: string[];
  webFetchProviderIds: string[];
  webSearchProviderIds: string[];
  memoryEmbeddingProviderIds: string[];
  gatewayMethods: string[];
  cliCommands: string[];
  services: string[];
  commands: string[];
  httpRoutes: number;
  hookCount: number;
  configSchema: boolean;
  configUiHints?: Record<string, PluginConfigUiHint>;
  configJsonSchema?: Record<string, unknown>;
  contracts?: PluginManifestContracts;
  memorySlotSelected?: boolean;
};

export type PluginRegistry = {
  plugins: PluginRecord[];
  tools: PluginToolRegistration[];
  hooks: PluginHookRegistration[];
  typedHooks: TypedPluginHookRegistration[];
  channels: PluginChannelRegistration[];
  channelSetups: PluginChannelSetupRegistration[];
  providers: PluginProviderRegistration[];
  cliBackends?: PluginCliBackendRegistration[];
  speechProviders: PluginSpeechProviderRegistration[];
  realtimeTranscriptionProviders: PluginRealtimeTranscriptionProviderRegistration[];
  realtimeVoiceProviders: PluginRealtimeVoiceProviderRegistration[];
  mediaUnderstandingProviders: PluginMediaUnderstandingProviderRegistration[];
  imageGenerationProviders: PluginImageGenerationProviderRegistration[];
  videoGenerationProviders: PluginVideoGenerationProviderRegistration[];
  musicGenerationProviders: PluginMusicGenerationProviderRegistration[];
  webFetchProviders: PluginWebFetchProviderRegistration[];
  webSearchProviders: PluginWebSearchProviderRegistration[];
  memoryEmbeddingProviders: PluginMemoryEmbeddingProviderRegistration[];
  gatewayHandlers: GatewayRequestHandlers;
  gatewayMethodScopes?: Partial<Record<string, OperatorScope>>;
  httpRoutes: PluginHttpRouteRegistration[];
  cliRegistrars: PluginCliRegistration[];
  reloads?: PluginReloadRegistration[];
  nodeHostCommands?: PluginNodeHostCommandRegistration[];
  securityAuditCollectors?: PluginSecurityAuditCollectorRegistration[];
  services: PluginServiceRegistration[];
  commands: PluginCommandRegistration[];
  conversationBindingResolvedHandlers: PluginConversationBindingResolvedHandlerRegistration[];
  diagnostics: PluginDiagnostic[];
};

export type PluginRegistryParams = {
  logger: PluginLogger;
  coreGatewayHandlers?: GatewayRequestHandlers;
  runtime: PluginRuntime;
  activateGlobalSideEffects?: boolean;
};

export type PluginRegistrationMode = import("./types.js").PluginRegistrationMode;
export type KaijiBotPluginNodeHostCommand = import("./types.js").KaijiBotPluginNodeHostCommand;
export type KaijiBotPluginToolContext = import("./types.js").KaijiBotPluginToolContext;
export type KaijiBotPluginHttpRouteParams = import("./types.js").KaijiBotPluginHttpRouteParams;
export type KaijiBotPluginHookOptions = import("./types.js").KaijiBotPluginHookOptions;
export type PluginHookHandlerMap = import("./types.js").PluginHookHandlerMap;
export type KaijiBotPluginApi = import("./types.js").KaijiBotPluginApi;
export type TypedPluginHook = TypedPluginHookRegistration;
export type KaijiBotPluginChannelReg = KaijiBotPluginChannelRegistration;
