import type { CompactionStatus, FallbackStatus } from "./app-tool-stream.ts";
import type { CronModelSuggestionsState, CronState } from "./controllers/cron.ts";
import type { TranscriptMessage } from "./controllers/history.ts";
import type { GatewayBrowserClient, GatewayHelloOk } from "./gateway.ts";
import type { Tab } from "./navigation.ts";
import type { UiSettings } from "./storage.ts";
import type { ThemeTransitionContext } from "./theme-transition.ts";
import type { ResolvedTheme, ThemeMode, ThemeName } from "./theme.ts";
import type {
  AgentsListResult,
  AgentsFilesListResult,
  AgentIdentityResult,
  AttentionItem,
  ChannelsStatusSnapshot,
  CognitiveStatusResult,
  ConfigSnapshot,
  ConfigUiHints,
  ChatModelOverride,
  GatewaySessionRow,
  MemoryHealthStatus,
  ModelCatalogEntry,
  ProviderAuthInfo,
  SessionsListResult,
  SkillStatusReport,
  ToolsCatalogResult,
  UsageStatusResult,
} from "./types.ts";
import type { ChatAttachment, ChatQueueItem } from "./ui-types.ts";
import type { SessionDetailState } from "./views/agents-utils.ts";

export type AppViewState = {
  settings: UiSettings;
  password: string;
  tab: Tab;
  onboarding: boolean;
  basePath: string;
  connected: boolean;
  theme: ThemeName;
  themeMode: ThemeMode;
  themeResolved: ResolvedTheme;
  themeOrder: ThemeName[];
  hello: GatewayHelloOk | null;
  lastError: string | null;
  lastErrorCode: string | null;
  assistantName: string;
  assistantAvatar: string | null;
  assistantAgentId: string | null;
  sessionKey: string;
  chatLoading: boolean;
  chatSending: boolean;
  chatMessage: string;
  chatAttachments: ChatAttachment[];
  chatMessages: unknown[];
  chatToolMessages: unknown[];
  chatStreamSegments: Array<{ text: string; ts: number }>;
  chatStream: string | null;
  chatStreamStartedAt: number | null;
  chatRunId: string | null;
  compactionStatus: CompactionStatus | null;
  fallbackStatus: FallbackStatus | null;
  chatAvatarUrl: string | null;
  chatThinkingLevel: string | null;
  chatModelOverrides: Record<string, ChatModelOverride | null>;
  chatModelsLoading: boolean;
  chatModelCatalog: ModelCatalogEntry[];
  fullModelCatalog: ModelCatalogEntry[];
  configuredProviders: string[];
  providerAuthOptions: ProviderAuthInfo[];
  chatQueue: ChatQueueItem[];
  chatManualRefreshInFlight: boolean;
  chatNewMessagesBelow: boolean;
  navDrawerOpen: boolean;
  modeSwitcherOpen: boolean;
  deckMoreOpen: boolean;
  sidebarOpen: boolean;
  sidebarContent: string | null;
  sidebarError: string | null;
  splitRatio: number;
  scrollToBottom: (opts?: { smooth?: boolean }) => void;
  pendingGatewayUrl: string | null;
  configLoading: boolean;
  configRaw: string;
  configRawOriginal: string;
  configValid: boolean | null;
  configIssues: unknown[];
  configSaving: boolean;
  configApplying: boolean;
  updateRunning: boolean;
  applySessionKey: string;
  configSnapshot: ConfigSnapshot | null;
  configSchema: unknown;
  configSchemaVersion: string | null;
  configSchemaLoading: boolean;
  configUiHints: ConfigUiHints;
  configForm: Record<string, unknown> | null;
  configFormOriginal: Record<string, unknown> | null;
  configFormMode: "form" | "raw";
  configSearchQuery: string;
  configActiveSection: string | null;
  configActiveSubsection: string | null;
  configFormDirty: boolean;
  agentsLoading: boolean;
  agentsList: AgentsListResult | null;
  agentsError: string | null;
  agentsSelectedId: string | null;
  toolsCatalogLoading: boolean;
  toolsCatalogError: string | null;
  toolsCatalogResult: ToolsCatalogResult | null;
  toolsEffectiveLoading: boolean;
  toolsEffectiveLoadingKey: string | null;
  toolsEffectiveResultKey: string | null;
  toolsEffectiveError: string | null;
  toolsEffectiveResult: import("./types.js").ToolsEffectiveResult | null;
  agentsPanel: "overview" | "files" | "tools" | "cron";
  agentFilesLoading: boolean;
  agentFilesError: string | null;
  agentFilesList: AgentsFilesListResult | null;
  agentFileContents: Record<string, string>;
  agentFileDrafts: Record<string, string>;
  agentFileActive: string | null;
  agentFileSaving: boolean;
  agentIdentityLoading: boolean;
  agentIdentityError: string | null;
  agentIdentityById: Record<string, AgentIdentityResult>;
  agentSkillsLoading: boolean;
  agentSkillsError: string | null;
  agentSkillsReport: SkillStatusReport | null;
  agentSkillsAgentId: string | null;
  channelsLoading: boolean;
  channelsSnapshot: ChannelsStatusSnapshot | null;
  channelsError: string | null;
  channelsLastSuccess: number | null;
  gatewayUptimeMs: number | null;
  memoryHealth: MemoryHealthStatus | null;
  usageStatus: UsageStatusResult | null;
  cognitiveStatus: CognitiveStatusResult | null;
  cognitiveLoading: boolean;
  cognitiveError: string | null;
  cognitiveAgentId: string | null;
  cognitiveUserId: string | null;
  cognitivePersonaList: unknown | null;
  cognitivePersonaDetail: unknown | null;
  insightsLoading: boolean;
  insightsError: string | null;
  insightsAgentId: string | null;
  insightsUserId: string | null;
  insightsList: unknown[];
  evolutionLoading: boolean;
  evolutionError: string | null;
  evolutionAgentId: string | null;
  evolutionUserId: string | null;
  evolutionRecords: unknown[];
  evolutionAuditEntries: unknown[];
  correctionsLoading: boolean;
  correctionsError: string | null;
  correctionsAgentId: string | null;
  correctionsUserId: string | null;
  correctionsUserIds: string[];
  correctionsList: unknown[];
  usageDashboardLoading: boolean;
  usageDashboardError: string | null;
  usageCostData: unknown | null;
  usageSessionsData: unknown | null;
  usageProviderStatus: unknown | null;
  skillsManagerLoading: boolean;
  skillsManagerError: string | null;
  skillsManagerInstalled: import("./types.js").SkillStatusReport | null;
  skillsManagerSearchQuery: string;
  skillsManagerSearchResults: import("../../../src/infra/clawhub.js").ClawHubSkillSearchResult[];
  skillsManagerDetail: unknown | null;
  skillsManagerInstalling: boolean;
  skillsManagerUpdating: boolean;
  skillsManagerActionSlug: string | null;
  historyLoading: boolean;
  historyError: string | null;
  historySessions: GatewaySessionRow[];
  historySearchQuery: string;
  historySelectedKey: string | null;
  historyPreview: unknown | null;
  historyMessages: TranscriptMessage[];
  dialoguesLoading: boolean;
  dialoguesError: string | null;
  dialoguesList: {
    agents: Array<{
      agentId: string;
      workspace: string;
      dialogues: Array<{ filename: string; date: string; time: string; size: number }>;
    }>;
  } | null;
  dialoguesSelectedAgentId: string | null;
  dialoguesSelectedFilename: string | null;
  dialoguesContent: string | null;
  dialoguesContentLoading: boolean;
  dialoguesContentError: string | null;
  sessionsLoading: boolean;
  sessionsResult: SessionsListResult | null;
  sessionsError: string | null;
  sessionsFilterActive: string;
  sessionsFilterLimit: string;
  sessionsIncludeGlobal: boolean;
  sessionsIncludeUnknown: boolean;
  sessionsHideCron: boolean;
  sessionDetails: Record<string, SessionDetailState>;
  updateAvailable: import("./types.js").UpdateAvailable | null;
  attentionItems: AttentionItem[];
  streamMode: boolean;
  client: GatewayBrowserClient | null;
  refreshSessionsAfterChat: Set<string>;
  connect: () => void;
  setTab: (tab: Tab) => void;
  setTheme: (theme: ThemeName, context?: ThemeTransitionContext) => void;
  setThemeMode: (mode: ThemeMode, context?: ThemeTransitionContext) => void;
  setBorderRadius: (value: number) => void;
  applySettings: (next: UiSettings) => void;
  loadAssistantIdentity: () => Promise<void>;
  loadCron: () => Promise<void>;
  handleGatewayUrlConfirm: () => void;
  handleGatewayUrlCancel: () => void;
  handleConfigLoad: () => Promise<void>;
  handleConfigSave: () => Promise<void>;
  handleConfigApply: () => Promise<void>;
  handleConfigFormUpdate: (path: string, value: unknown) => void;
  handleConfigFormModeChange: (mode: "form" | "raw") => void;
  handleConfigRawChange: (raw: string) => void;
  handleCronToggle: (jobId: string, enabled: boolean) => Promise<void>;
  handleCronRun: (jobId: string) => Promise<void>;
  handleCronRemove: (jobId: string) => Promise<void>;
  handleCronAdd: () => Promise<void>;
  handleCronRunsLoad: (jobId: string) => Promise<void>;
  handleCronFormUpdate: (path: string, value: unknown) => void;
  handleSessionsLoad: () => Promise<void>;
  handleSessionsPatch: (key: string, patch: unknown) => Promise<void>;
  handleRunUpdate: () => Promise<void>;
  setPassword: (next: string) => void;
  setChatMessage: (next: string) => void;
  handleSendChat: (messageOverride?: string, opts?: { restoreDraft?: boolean }) => Promise<void>;
  handleAbortChat: () => Promise<void>;
  removeQueuedMessage: (id: string) => void;
  handleChatScroll: (event: Event) => void;
  resetToolStream: () => void;
  resetChatScroll: () => void;
  handleOpenSidebar: (content: string) => void;
  handleCloseSidebar: () => void;
  handleSplitRatioChange: (ratio: number) => void;
} & Pick<
  CronState,
  | "cronLoading"
  | "cronJobsLoadingMore"
  | "cronJobs"
  | "cronJobsTotal"
  | "cronJobsHasMore"
  | "cronJobsNextOffset"
  | "cronJobsLimit"
  | "cronJobsQuery"
  | "cronJobsEnabledFilter"
  | "cronJobsScheduleKindFilter"
  | "cronJobsLastStatusFilter"
  | "cronJobsSortBy"
  | "cronJobsSortDir"
  | "cronStatus"
  | "cronError"
  | "cronForm"
  | "cronFieldErrors"
  | "cronEditingJobId"
  | "cronFormOpenForNew"
  | "cronRunsJobId"
  | "cronRunsLoadingMore"
  | "cronRuns"
  | "cronRunsTotal"
  | "cronRunsHasMore"
  | "cronRunsNextOffset"
  | "cronRunsLimit"
  | "cronRunsScope"
  | "cronRunsStatuses"
  | "cronRunsDeliveryStatuses"
  | "cronRunsStatusFilter"
  | "cronRunsQuery"
  | "cronRunsSortDir"
  | "cronBusy"
> &
  Pick<CronModelSuggestionsState, "cronModelSuggestions">;
