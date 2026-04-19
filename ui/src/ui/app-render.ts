import { html, nothing } from "lit";
import { t } from "../i18n/index.ts";
import { getSafeLocalStorage } from "../local-storage.ts";
import { refreshChatAvatar } from "./app-chat.ts";
import {
  renderChatControls,
  renderChatMobileToggle,
  renderChatSessionSelect,
  renderTab,
  renderSidebarConnectionStatus,
  renderTopbarThemeModeToggle,
  switchChatSession,
} from "./app-render.helpers.ts";
import type { AppViewState } from "./app-view-state.ts";
import { loadAgentFileContent, loadAgentFiles, saveAgentFile } from "./controllers/agent-files.ts";
import { loadAgentIdentities, loadAgentIdentity } from "./controllers/agent-identity.ts";
import {
  buildToolsEffectiveRequestKey,
  loadAgents,
  loadToolsCatalog,
  loadToolsEffective,
  refreshVisibleToolsEffectiveForCurrentSession,
  saveAgentsConfig,
} from "./controllers/agents.ts";
import {
  applyConfig,
  ensureAgentConfigEntry,
  findAgentConfigEntryIndex,
  loadConfig,
  openConfigFile,
  runUpdate,
  saveConfig,
  updateConfigFormValue,
  removeConfigFormValue,
} from "./controllers/config.ts";
import { loadChatHistory } from "./controllers/chat.ts";
import {
  loadCronRuns,
  loadMoreCronJobs,
  loadMoreCronRuns,
  reloadCronJobs,
  toggleCronJob,
  runCronJob,
  removeCronJob,
  addCronJob,
  startCronEdit,
  startCronClone,
  cancelCronEdit,
  validateCronForm,
  hasCronFormErrors,
  normalizeCronFormState,
  getVisibleCronJobs,
  updateCronJobsFilter,
  updateCronRunsFilter,
} from "./controllers/cron.ts";
import { buildExternalLinkRel, EXTERNAL_LINK_TARGET } from "./external-link.ts";
import "./components/dashboard-header.ts";
import { icons } from "./icons.ts";
import {
  iconForTab,
  normalizeBasePath,
  pathForTab,
  TABS,
  subtitleForTab,
  titleForTab,
} from "./navigation.ts";
import {
  buildAgentMainSessionKey,
  parseAgentSessionKey,
  resolveAgentIdFromSessionKey,
} from "./session-key.ts";
import { agentLogoUrl } from "./views/agents-utils.ts";
import {
  resolveAgentConfig,
  resolveConfiguredCronModelSuggestions,
  resolveEffectiveModelFallbacks,
  resolveModelPrimary,
  sortLocaleStrings,
} from "./views/agents-utils.ts";
import { renderChat } from "./views/chat.ts";
import { renderConfig } from "./views/config.ts";

// Lazy-loaded view modules – deferred so the initial bundle stays small.
// Each loader resolves once; subsequent calls return the cached module.
type LazyState<T> = { mod: T | null; promise: Promise<T> | null };

let _pendingUpdate: (() => void) | undefined;

function createLazy<T>(loader: () => Promise<T>): () => T | null {
  const s: LazyState<T> = { mod: null, promise: null };
  return () => {
    if (s.mod) {
      return s.mod;
    }
    if (!s.promise) {
      s.promise = loader().then((m) => {
        s.mod = m;
        _pendingUpdate?.();
        return m;
      });
    }
    return null;
  };
}

const lazyAgents = createLazy(() => import("./views/agents.ts"));
const lazyCron = createLazy(() => import("./views/cron.ts"));

function lazyRender<M>(getter: () => M | null, render: (mod: M) => unknown) {
  const mod = getter();
  return mod ? render(mod) : nothing;
}

const UPDATE_BANNER_DISMISS_KEY = "kaijibot:control-ui:update-banner-dismissed:v1";
const CRON_THINKING_SUGGESTIONS = ["off", "minimal", "low", "medium", "high"];
const CRON_TIMEZONE_SUGGESTIONS = [
  "UTC",
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Tokyo",
];

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

function normalizeSuggestionValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function uniquePreserveOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(normalized);
  }
  return output;
}

type DismissedUpdateBanner = {
  latestVersion: string;
  channel: string | null;
  dismissedAtMs: number;
};

function loadDismissedUpdateBanner(): DismissedUpdateBanner | null {
  try {
    const raw = getSafeLocalStorage()?.getItem(UPDATE_BANNER_DISMISS_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<DismissedUpdateBanner>;
    if (!parsed || typeof parsed.latestVersion !== "string") {
      return null;
    }
    return {
      latestVersion: parsed.latestVersion,
      channel: typeof parsed.channel === "string" ? parsed.channel : null,
      dismissedAtMs: typeof parsed.dismissedAtMs === "number" ? parsed.dismissedAtMs : Date.now(),
    };
  } catch {
    return null;
  }
}

function isUpdateBannerDismissed(updateAvailable: unknown): boolean {
  const dismissed = loadDismissedUpdateBanner();
  if (!dismissed) {
    return false;
  }
  const info = updateAvailable as { latestVersion?: unknown; channel?: unknown };
  const latestVersion = info && typeof info.latestVersion === "string" ? info.latestVersion : null;
  const channel = info && typeof info.channel === "string" ? info.channel : null;
  return Boolean(
    latestVersion && dismissed.latestVersion === latestVersion && dismissed.channel === channel,
  );
}

function dismissUpdateBanner(updateAvailable: unknown) {
  const info = updateAvailable as { latestVersion?: unknown; channel?: unknown };
  const latestVersion = info && typeof info.latestVersion === "string" ? info.latestVersion : null;
  if (!latestVersion) {
    return;
  }
  const channel = info && typeof info.channel === "string" ? info.channel : null;
  const payload: DismissedUpdateBanner = {
    latestVersion,
    channel,
    dismissedAtMs: Date.now(),
  };
  try {
    getSafeLocalStorage()?.setItem(UPDATE_BANNER_DISMISS_KEY, JSON.stringify(payload));
  } catch {
    // ignore
  }
}

const AVATAR_DATA_RE = /^data:/i;
const AVATAR_HTTP_RE = /^https?:\/\//i;

function resolveAssistantAvatarUrl(state: AppViewState): string | undefined {
  const list = state.agentsList?.agents ?? [];
  const parsed = parseAgentSessionKey(state.sessionKey);
  const agentId = parsed?.agentId ?? state.agentsList?.defaultId ?? "main";
  const agent = list.find((entry) => entry.id === agentId);
  const identity = agent?.identity;
  const candidate = identity?.avatarUrl ?? identity?.avatar;
  if (!candidate) {
    return undefined;
  }
  if (AVATAR_DATA_RE.test(candidate) || AVATAR_HTTP_RE.test(candidate)) {
    return candidate;
  }
  return identity?.avatarUrl;
}

export function renderApp(state: AppViewState) {
  const updatableState = state as AppViewState & { requestUpdate?: () => void };
  const requestHostUpdate =
    typeof updatableState.requestUpdate === "function"
      ? () => updatableState.requestUpdate?.()
      : undefined;
  _pendingUpdate = requestHostUpdate;

  if (!state.connected) {
    return html`${nothing}`;
  }

  const chatDisabledReason = state.connected ? null : t("chat.disconnected");
  const isChat = state.tab === "chat";
  const chatFocus = isChat && (state.settings.chatFocusMode || state.onboarding);
  const navDrawerOpen = Boolean(state.navDrawerOpen && !chatFocus && !state.onboarding);
  const navCollapsed = Boolean(state.settings.navCollapsed && !navDrawerOpen);
  const showThinking = state.onboarding ? false : state.settings.chatShowThinking;
  const showToolCalls = state.onboarding ? true : state.settings.chatShowToolCalls;
  const assistantAvatarUrl = resolveAssistantAvatarUrl(state);
  const chatAvatarUrl = state.chatAvatarUrl ?? assistantAvatarUrl ?? null;
  const configValue =
    state.configForm ?? (state.configSnapshot?.config as Record<string, unknown> | null);
  const basePath = normalizeBasePath(state.basePath ?? "");
  const resolvedAgentId =
    state.agentsSelectedId ??
    state.agentsList?.defaultId ??
    state.agentsList?.agents?.[0]?.id ??
    null;
  const activeSessionAgentId = resolveAgentIdFromSessionKey(state.sessionKey);
  const toolsPanelUsesActiveSession = Boolean(
    resolvedAgentId && activeSessionAgentId && resolvedAgentId === activeSessionAgentId,
  );
  const getCurrentConfigValue = () =>
    state.configForm ?? (state.configSnapshot?.config as Record<string, unknown> | null);
  const findAgentIndex = (agentId: string) =>
    findAgentConfigEntryIndex(getCurrentConfigValue(), agentId);
  const ensureAgentIndex = (agentId: string) => ensureAgentConfigEntry(state, agentId);
  const cronAgentSuggestions = sortLocaleStrings(
    new Set(
      [
        ...(state.agentsList?.agents?.map((entry) => entry.id.trim()) ?? []),
        ...state.cronJobs
          .map((job) => (typeof job.agentId === "string" ? job.agentId.trim() : ""))
          .filter(Boolean),
      ].filter(Boolean),
    ),
  );
  const cronModelSuggestions = sortLocaleStrings(
    new Set(
      [
        ...state.cronModelSuggestions,
        ...resolveConfiguredCronModelSuggestions(configValue),
        ...state.cronJobs
          .map((job) => {
            if (job.payload.kind !== "agentTurn" || typeof job.payload.model !== "string") {
              return "";
            }
            return job.payload.model.trim();
          })
          .filter(Boolean),
      ].filter(Boolean),
    ),
  );
  const visibleCronJobs = getVisibleCronJobs(state);
  const selectedDeliveryChannel =
    state.cronForm.deliveryChannel && state.cronForm.deliveryChannel.trim()
      ? state.cronForm.deliveryChannel.trim()
      : "last";
  const jobToSuggestions = state.cronJobs
    .map((job) => normalizeSuggestionValue(job.delivery?.to))
    .filter(Boolean);
  const accountToSuggestions = (
    selectedDeliveryChannel === "last"
      ? Object.values(state.channelsSnapshot?.channelAccounts ?? {}).flat()
      : (state.channelsSnapshot?.channelAccounts?.[selectedDeliveryChannel] ?? [])
  )
    .flatMap((account) => [
      normalizeSuggestionValue(account.accountId),
      normalizeSuggestionValue(account.name),
    ])
    .filter(Boolean);
  const rawDeliveryToSuggestions = uniquePreserveOrder([
    ...jobToSuggestions,
    ...accountToSuggestions,
  ]);
  const accountSuggestions = uniquePreserveOrder(accountToSuggestions);
  const deliveryToSuggestions =
    state.cronForm.deliveryMode === "webhook"
      ? rawDeliveryToSuggestions.filter((value) => isHttpUrl(value))
      : rawDeliveryToSuggestions;

  return html`
    <div
      class="shell ${isChat ? "shell--chat" : ""} ${chatFocus
        ? "shell--chat-focus"
        : ""} ${navCollapsed ? "shell--nav-collapsed" : ""} ${navDrawerOpen
        ? "shell--nav-drawer-open"
        : ""} ${state.onboarding ? "shell--onboarding" : ""}"
    >
      <button
        type="button"
        class="shell-nav-backdrop"
        aria-label="${t("nav.collapse")}"
        @click=${() => {
          state.navDrawerOpen = false;
        }}
      ></button>
      <header class="topbar">
        <div class="topnav-shell">
          <button
            type="button"
            class="topbar-nav-toggle"
            @click=${() => {
              state.navDrawerOpen = !navDrawerOpen;
            }}
            title="${navDrawerOpen ? t("nav.collapse") : t("nav.expand")}"
            aria-label="${navDrawerOpen ? t("nav.collapse") : t("nav.expand")}"
            aria-expanded=${navDrawerOpen}
          >
            <span class="nav-collapse-toggle__icon" aria-hidden="true">${icons.menu}</span>
          </button>
          <div class="topnav-shell__content">
            <dashboard-header .tab=${state.tab}></dashboard-header>
          </div>
          <div class="topnav-shell__actions">
            <div class="topbar-status">
              ${isChat ? renderChatMobileToggle(state) : nothing}
              ${renderTopbarThemeModeToggle(state)}
            </div>
          </div>
        </div>
      </header>
      <div class="shell-nav">
        <aside class="sidebar ${navCollapsed ? "sidebar--collapsed" : ""}">
          <div class="sidebar-shell">
            <div class="sidebar-shell__header">
              <div class="sidebar-brand">
                ${navCollapsed
                  ? nothing
                  : html`
                      <img
                        class="sidebar-brand__logo"
                        src="${agentLogoUrl(basePath)}"
                        alt="KaijiBot"
                      />
                      <span class="sidebar-brand__copy">
                        <span class="sidebar-brand__eyebrow">${t("nav.control")}</span>
                        <span class="sidebar-brand__title">KaijiBot</span>
                      </span>
                    `}
              </div>
              <button
                type="button"
                class="nav-collapse-toggle"
                @click=${() =>
                  state.applySettings({
                    ...state.settings,
                    navCollapsed: !state.settings.navCollapsed,
                  })}
                title="${navCollapsed ? t("nav.expand") : t("nav.collapse")}"
                aria-label="${navCollapsed ? t("nav.expand") : t("nav.collapse")}"
              >
                <span class="nav-collapse-toggle__icon" aria-hidden="true"
                  >${navCollapsed ? icons.panelLeftOpen : icons.panelLeftClose}</span
                >
              </button>
            </div>
            <div class="sidebar-shell__body">
              <nav class="sidebar-nav">
                ${TABS.map((tab) => renderTab(state, tab, { collapsed: navCollapsed }))}
              </nav>
            </div>
            <div class="sidebar-shell__footer">
              <div class="sidebar-utility-group">
                <a
                  class="nav-item nav-item--external sidebar-utility-link"
                  href="https://docs.kaijibot.ai"
                  target=${EXTERNAL_LINK_TARGET}
                  rel=${buildExternalLinkRel()}
                  title="${t("common.docs")} (opens in new tab)"
                >
                  <span class="nav-item__icon" aria-hidden="true">${icons.book}</span>
                  ${!navCollapsed
                    ? html`
                        <span class="nav-item__text">${t("common.docs")}</span>
                        <span class="nav-item__external-icon">${icons.externalLink}</span>
                      `
                    : nothing}
                </a>
                <div class="sidebar-mode-switch">${renderTopbarThemeModeToggle(state)}</div>
                ${(() => {
                  const version = state.hello?.server?.version ?? "";
                  return version
                    ? html`
                        <div class="sidebar-version" title=${`v${version}`}>
                          ${!navCollapsed
                            ? html`
                                <span class="sidebar-version__label">${t("common.version")}</span>
                                <span class="sidebar-version__text">v${version}</span>
                                ${renderSidebarConnectionStatus(state)}
                              `
                            : html` ${renderSidebarConnectionStatus(state)} `}
                        </div>
                      `
                    : nothing;
                })()}
              </div>
            </div>
          </div>
        </aside>
      </div>
      <main class="content ${isChat ? "content--chat" : ""}">
        ${state.updateAvailable &&
        state.updateAvailable.latestVersion !== state.updateAvailable.currentVersion &&
        !isUpdateBannerDismissed(state.updateAvailable)
          ? html`<div class="update-banner callout danger" role="alert">
              <strong>Update available:</strong> v${state.updateAvailable.latestVersion} (running
              v${state.updateAvailable.currentVersion}).
              <button
                class="btn btn--sm update-banner__btn"
                ?disabled=${state.updateRunning || !state.connected}
                @click=${() => runUpdate(state)}
              >
                ${state.updateRunning ? "Updating…" : "Update now"}
              </button>
              <button
                class="update-banner__close"
                type="button"
                title="Dismiss"
                aria-label="Dismiss update banner"
                @click=${() => {
                  dismissUpdateBanner(state.updateAvailable);
                  state.updateAvailable = null;
                }}
              >
                ${icons.x}
              </button>
            </div>`
          : nothing}
        ${state.tab === "settings"
          ? nothing
          : html`<section class="content-header">
              <div>
                ${isChat
                  ? renderChatSessionSelect(state)
                  : html`<div class="page-title">${titleForTab(state.tab)}</div>`}
                ${isChat ? nothing : html`<div class="page-sub">${subtitleForTab(state.tab)}</div>`}
              </div>
              <div class="page-meta">
                ${state.lastError
                  ? html`<div class="pill danger">${state.lastError}</div>`
                  : nothing}
                ${isChat ? renderChatControls(state) : nothing}
              </div>
            </section>`}
        ${state.tab === "cron"
          ? lazyRender(lazyCron, (m) =>
              m.renderCron({
                basePath: state.basePath,
                loading: state.cronLoading,
                status: state.cronStatus,
                jobs: visibleCronJobs,
                jobsLoadingMore: state.cronJobsLoadingMore,
                jobsTotal: state.cronJobsTotal,
                jobsHasMore: state.cronJobsHasMore,
                jobsQuery: state.cronJobsQuery,
                jobsEnabledFilter: state.cronJobsEnabledFilter,
                jobsScheduleKindFilter: state.cronJobsScheduleKindFilter,
                jobsLastStatusFilter: state.cronJobsLastStatusFilter,
                jobsSortBy: state.cronJobsSortBy,
                jobsSortDir: state.cronJobsSortDir,
                editingJobId: state.cronEditingJobId,
                error: state.cronError,
                busy: state.cronBusy,
                form: state.cronForm,
                channels: state.channelsSnapshot?.channelMeta?.length
                  ? state.channelsSnapshot.channelMeta.map((entry) => entry.id)
                  : (state.channelsSnapshot?.channelOrder ?? []),
                channelLabels: state.channelsSnapshot?.channelLabels ?? {},
                channelMeta: state.channelsSnapshot?.channelMeta ?? [],
                runsJobId: state.cronRunsJobId,
                runs: state.cronRuns,
                runsTotal: state.cronRunsTotal,
                runsHasMore: state.cronRunsHasMore,
                runsLoadingMore: state.cronRunsLoadingMore,
                runsScope: state.cronRunsScope,
                runsStatuses: state.cronRunsStatuses,
                runsDeliveryStatuses: state.cronRunsDeliveryStatuses,
                runsStatusFilter: state.cronRunsStatusFilter,
                runsQuery: state.cronRunsQuery,
                runsSortDir: state.cronRunsSortDir,
                fieldErrors: state.cronFieldErrors,
                canSubmit: !hasCronFormErrors(state.cronFieldErrors),
                agentSuggestions: cronAgentSuggestions,
                modelSuggestions: cronModelSuggestions,
                thinkingSuggestions: CRON_THINKING_SUGGESTIONS,
                timezoneSuggestions: CRON_TIMEZONE_SUGGESTIONS,
                deliveryToSuggestions,
                accountSuggestions,
                onFormChange: (patch) => {
                  state.cronForm = normalizeCronFormState({ ...state.cronForm, ...patch });
                  state.cronFieldErrors = validateCronForm(state.cronForm);
                },
                onRefresh: () => state.loadCron(),
                onAdd: () => addCronJob(state),
                onEdit: (job) => startCronEdit(state, job),
                onClone: (job) => startCronClone(state, job),
                onCancelEdit: () => cancelCronEdit(state),
                onToggle: (job, enabled) => toggleCronJob(state, job, enabled),
                onRun: (job, mode) => runCronJob(state, job, mode ?? "force"),
                onRemove: (job) => removeCronJob(state, job),
                onLoadRuns: async (jobId) => {
                  updateCronRunsFilter(state, { cronRunsScope: "job" });
                  await loadCronRuns(state, jobId);
                },
                onLoadMoreJobs: () => loadMoreCronJobs(state),
                onJobsFiltersChange: async (patch) => {
                  updateCronJobsFilter(state, patch);
                  const shouldReload =
                    typeof patch.cronJobsQuery === "string" ||
                    Boolean(patch.cronJobsEnabledFilter) ||
                    Boolean(patch.cronJobsSortBy) ||
                    Boolean(patch.cronJobsSortDir);
                  if (shouldReload) {
                    await reloadCronJobs(state);
                  }
                },
                onJobsFiltersReset: async () => {
                  updateCronJobsFilter(state, {
                    cronJobsQuery: "",
                    cronJobsEnabledFilter: "all",
                    cronJobsScheduleKindFilter: "all",
                    cronJobsLastStatusFilter: "all",
                    cronJobsSortBy: "nextRunAtMs",
                    cronJobsSortDir: "asc",
                  });
                  await reloadCronJobs(state);
                },
                onLoadMoreRuns: () => loadMoreCronRuns(state),
                onRunsFiltersChange: async (patch) => {
                  updateCronRunsFilter(state, patch);
                  if (state.cronRunsScope === "all") {
                    await loadCronRuns(state, null);
                    return;
                  }
                  await loadCronRuns(state, state.cronRunsJobId);
                },
                onNavigateToChat: (sessionKey) => {
                  switchChatSession(state, sessionKey);
                  state.setTab("chat" as import("./navigation.ts").Tab);
                },
              }),
            )
          : nothing}
        ${state.tab === "agents"
          ? lazyRender(lazyAgents, (m) =>
              m.renderAgents({
                basePath: state.basePath ?? "",
                loading: state.agentsLoading,
                error: state.agentsError,
                agentsList: state.agentsList,
                selectedAgentId: resolvedAgentId,
                activePanel: state.agentsPanel,
                config: {
                  form: configValue,
                  loading: state.configLoading,
                  saving: state.configSaving,
                  dirty: state.configFormDirty,
                },
                channels: {
                  snapshot: state.channelsSnapshot,
                  loading: state.channelsLoading,
                  error: state.channelsError,
                  lastSuccess: state.channelsLastSuccess,
                },
                cron: {
                  status: state.cronStatus,
                  jobs: state.cronJobs,
                  loading: state.cronLoading,
                  error: state.cronError,
                },
                agentFiles: {
                  list: state.agentFilesList,
                  loading: state.agentFilesLoading,
                  error: state.agentFilesError,
                  active: state.agentFileActive,
                  contents: state.agentFileContents,
                  drafts: state.agentFileDrafts,
                  saving: state.agentFileSaving,
                },
                agentIdentityLoading: state.agentIdentityLoading,
                agentIdentityError: state.agentIdentityError,
                agentIdentityById: state.agentIdentityById,
                agentSkills: {
                  report: state.agentSkillsReport,
                  loading: state.agentSkillsLoading,
                  error: state.agentSkillsError,
                  agentId: state.agentSkillsAgentId,
                  filter: "",
                },
                toolsCatalog: {
                  loading: state.toolsCatalogLoading,
                  error: state.toolsCatalogError,
                  result: state.toolsCatalogResult,
                },
                toolsEffective: {
                  loading: state.toolsEffectiveLoading,
                  error: state.toolsEffectiveError,
                  result: state.toolsEffectiveResult,
                },
                runtimeSessionKey: state.sessionKey,
                runtimeSessionMatchesSelectedAgent: toolsPanelUsesActiveSession,
                modelCatalog: state.chatModelCatalog ?? [],
                onRefresh: async () => {
                  await loadAgents(state);
                  const agentIds = state.agentsList?.agents?.map((entry) => entry.id) ?? [];
                  if (agentIds.length > 0) {
                    void loadAgentIdentities(state, agentIds);
                  }
                  const refreshedAgentId =
                    state.agentsSelectedId ??
                    state.agentsList?.defaultId ??
                    state.agentsList?.agents?.[0]?.id ??
                    null;
                  if (state.agentsPanel === "files" && refreshedAgentId) {
                    void loadAgentFiles(state, refreshedAgentId);
                  }
                  if (state.agentsPanel === "tools" && refreshedAgentId) {
                    void loadToolsCatalog(state, refreshedAgentId);
                    if (refreshedAgentId === resolveAgentIdFromSessionKey(state.sessionKey)) {
                      void loadToolsEffective(state, {
                        agentId: refreshedAgentId,
                        sessionKey: state.sessionKey,
                      });
                    }
                  }
                  if (state.agentsPanel === "cron") {
                    void state.loadCron();
                  }
                },
                onSelectAgent: (agentId) => {
                  if (state.agentsSelectedId === agentId) {
                    return;
                  }
                  state.agentsSelectedId = agentId;
                  state.agentFilesList = null;
                  state.agentFilesError = null;
                  state.agentFilesLoading = false;
                  state.agentFileActive = null;
                  state.agentFileContents = {};
                  state.agentFileDrafts = {};
                  state.agentSkillsReport = null;
                  state.agentSkillsError = null;
                  state.agentSkillsAgentId = null;
                  state.toolsCatalogResult = null;
                  state.toolsCatalogError = null;
                  state.toolsCatalogLoading = false;
                  state.toolsEffectiveResult = null;
                  state.toolsEffectiveResultKey = null;
                  state.toolsEffectiveError = null;
                  state.toolsEffectiveLoading = false;
                  state.toolsEffectiveLoadingKey = null;
                  void loadAgentIdentity(state, agentId);
                  if (state.agentsPanel === "files") {
                    void loadAgentFiles(state, agentId);
                  }
                  if (state.agentsPanel === "tools") {
                    void loadToolsCatalog(state, agentId);
                    if (agentId === resolveAgentIdFromSessionKey(state.sessionKey)) {
                      void loadToolsEffective(state, {
                        agentId,
                        sessionKey: state.sessionKey,
                      });
                    }
                  }
                },
                onSelectPanel: (panel) => {
                  state.agentsPanel = panel;
                  if (panel === "files" && resolvedAgentId) {
                    if (state.agentFilesList?.agentId !== resolvedAgentId) {
                      state.agentFilesList = null;
                      state.agentFilesError = null;
                      state.agentFileActive = null;
                      state.agentFileContents = {};
                      state.agentFileDrafts = {};
                      void loadAgentFiles(state, resolvedAgentId);
                    }
                  }
                  if (panel === "tools" && resolvedAgentId) {
                    if (
                      state.toolsCatalogResult?.agentId !== resolvedAgentId ||
                      state.toolsCatalogError
                    ) {
                      void loadToolsCatalog(state, resolvedAgentId);
                    }
                    if (resolvedAgentId === resolveAgentIdFromSessionKey(state.sessionKey)) {
                      const toolsRequestKey = buildToolsEffectiveRequestKey(state, {
                        agentId: resolvedAgentId,
                        sessionKey: state.sessionKey,
                      });
                      if (
                        state.toolsEffectiveResultKey !== toolsRequestKey ||
                        state.toolsEffectiveError
                      ) {
                        void loadToolsEffective(state, {
                          agentId: resolvedAgentId,
                          sessionKey: state.sessionKey,
                        });
                      }
                    } else {
                      state.toolsEffectiveResult = null;
                      state.toolsEffectiveResultKey = null;
                      state.toolsEffectiveError = null;
                      state.toolsEffectiveLoading = false;
                      state.toolsEffectiveLoadingKey = null;
                    }
                  }
                  if (panel === "cron") {
                    void state.loadCron();
                  }
                },
                onLoadFiles: (agentId) => loadAgentFiles(state, agentId),
                onSelectFile: (name) => {
                  state.agentFileActive = name;
                  if (!resolvedAgentId) {
                    return;
                  }
                  void loadAgentFileContent(state, resolvedAgentId, name);
                },
                onFileDraftChange: (name, content) => {
                  state.agentFileDrafts = { ...state.agentFileDrafts, [name]: content };
                },
                onFileReset: (name) => {
                  const base = state.agentFileContents[name] ?? "";
                  state.agentFileDrafts = { ...state.agentFileDrafts, [name]: base };
                },
                onFileSave: (name) => {
                  if (!resolvedAgentId) {
                    return;
                  }
                  const content =
                    state.agentFileDrafts[name] ?? state.agentFileContents[name] ?? "";
                  void saveAgentFile(state, resolvedAgentId, name, content);
                },
                onToolsProfileChange: (agentId, profile, clearAllow) => {
                  const index =
                    profile || clearAllow ? ensureAgentIndex(agentId) : findAgentIndex(agentId);
                  if (index < 0) {
                    return;
                  }
                  const basePath = ["agents", "list", index, "tools"];
                  if (profile) {
                    updateConfigFormValue(state, [...basePath, "profile"], profile);
                  } else {
                    removeConfigFormValue(state, [...basePath, "profile"]);
                  }
                  if (clearAllow) {
                    removeConfigFormValue(state, [...basePath, "allow"]);
                  }
                },
                onToolsOverridesChange: (agentId, alsoAllow, deny) => {
                  const index =
                    alsoAllow.length > 0 || deny.length > 0
                      ? ensureAgentIndex(agentId)
                      : findAgentIndex(agentId);
                  if (index < 0) {
                    return;
                  }
                  const basePath = ["agents", "list", index, "tools"];
                  if (alsoAllow.length > 0) {
                    updateConfigFormValue(state, [...basePath, "alsoAllow"], alsoAllow);
                  } else {
                    removeConfigFormValue(state, [...basePath, "alsoAllow"]);
                  }
                  if (deny.length > 0) {
                    updateConfigFormValue(state, [...basePath, "deny"], deny);
                  } else {
                    removeConfigFormValue(state, [...basePath, "deny"]);
                  }
                },
                onConfigReload: () => loadConfig(state),
                onConfigSave: () => saveAgentsConfig(state),
                onCronRefresh: () => state.loadCron(),
                onCronRunNow: (jobId) => {
                  const job = state.cronJobs.find((entry) => entry.id === jobId);
                  if (!job) {
                    return;
                  }
                  void runCronJob(state, job, "force");
                },
                onModelChange: (agentId, modelId) => {
                  const index = modelId ? ensureAgentIndex(agentId) : findAgentIndex(agentId);
                  if (index < 0) {
                    return;
                  }
                  const list = (getCurrentConfigValue() as { agents?: { list?: unknown[] } } | null)
                    ?.agents?.list;
                  const basePath = ["agents", "list", index, "model"];
                  if (!modelId) {
                    removeConfigFormValue(state, basePath);
                  } else {
                    const entry = Array.isArray(list)
                      ? (list[index] as { model?: unknown })
                      : undefined;
                    const existing = entry?.model;
                    if (existing && typeof existing === "object" && !Array.isArray(existing)) {
                      const fallbacks = (existing as { fallbacks?: unknown }).fallbacks;
                      const next = {
                        primary: modelId,
                        ...(Array.isArray(fallbacks) ? { fallbacks } : {}),
                      };
                      updateConfigFormValue(state, basePath, next);
                    } else {
                      updateConfigFormValue(state, basePath, modelId);
                    }
                  }
                  void refreshVisibleToolsEffectiveForCurrentSession(state);
                },
                onModelFallbacksChange: (agentId, fallbacks) => {
                  const normalized = fallbacks.map((name) => name.trim()).filter(Boolean);
                  const currentConfig = getCurrentConfigValue();
                  const resolvedConfig = resolveAgentConfig(currentConfig, agentId);
                  const effectivePrimary =
                    resolveModelPrimary(resolvedConfig.entry?.model) ??
                    resolveModelPrimary(resolvedConfig.defaults?.model);
                  const effectiveFallbacks = resolveEffectiveModelFallbacks(
                    resolvedConfig.entry?.model,
                    resolvedConfig.defaults?.model,
                  );
                  const index =
                    normalized.length > 0
                      ? effectivePrimary
                        ? ensureAgentIndex(agentId)
                        : -1
                      : (effectiveFallbacks?.length ?? 0) > 0 || findAgentIndex(agentId) >= 0
                        ? ensureAgentIndex(agentId)
                        : -1;
                  if (index < 0) {
                    return;
                  }
                  const list = (getCurrentConfigValue() as { agents?: { list?: unknown[] } } | null)
                    ?.agents?.list;
                  const basePath = ["agents", "list", index, "model"];
                  const entry = Array.isArray(list)
                    ? (list[index] as { model?: unknown })
                    : undefined;
                  const existing = entry?.model;
                  const resolvePrimary = () => {
                    if (typeof existing === "string") {
                      return existing.trim() || null;
                    }
                    if (existing && typeof existing === "object" && !Array.isArray(existing)) {
                      const primary = (existing as { primary?: unknown }).primary;
                      if (typeof primary === "string") {
                        const trimmed = primary.trim();
                        return trimmed || null;
                      }
                    }
                    return null;
                  };
                  const primary = resolvePrimary() ?? effectivePrimary;
                  if (normalized.length === 0) {
                    if (primary) {
                      updateConfigFormValue(state, basePath, primary);
                    } else {
                      removeConfigFormValue(state, basePath);
                    }
                    return;
                  }
                  if (!primary) {
                    return;
                  }
                  updateConfigFormValue(state, basePath, { primary, fallbacks: normalized });
                },
                onSetDefault: (agentId) => {
                  if (!configValue) {
                    return;
                  }
                  updateConfigFormValue(state, ["agents", "defaultId"], agentId);
                },
              }),
            )
          : nothing}
        ${state.tab === "chat"
          ? renderChat({
              sessionKey: state.sessionKey,
              onSessionKeyChange: (next) => {
                state.sessionKey = next;
                state.chatMessage = "";
                state.chatAttachments = [];
                state.chatStream = null;
                state.chatStreamStartedAt = null;
                state.chatRunId = null;
                state.chatQueue = [];
                state.resetToolStream();
                state.resetChatScroll();
                state.applySettings({
                  ...state.settings,
                  sessionKey: next,
                  lastActiveSessionKey: next,
                });
                void state.loadAssistantIdentity();
                void loadChatHistory(state);
                void refreshChatAvatar(state);
              },
              thinkingLevel: state.chatThinkingLevel,
              showThinking,
              showToolCalls,
              loading: state.chatLoading,
              sending: state.chatSending,
              compactionStatus: state.compactionStatus,
              fallbackStatus: state.fallbackStatus,
              assistantAvatarUrl: chatAvatarUrl,
              messages: state.chatMessages,
              toolMessages: state.chatToolMessages,
              streamSegments: state.chatStreamSegments,
              stream: state.chatStream,
              streamStartedAt: state.chatStreamStartedAt,
              draft: state.chatMessage,
              queue: state.chatQueue,
              connected: state.connected,
              canSend: state.connected,
              disabledReason: chatDisabledReason,
              error: state.lastError,
              sessions: state.sessionsResult,
              focusMode: chatFocus,
              onRefresh: () => {
                state.resetToolStream();
                return Promise.all([loadChatHistory(state), refreshChatAvatar(state)]);
              },
              onToggleFocusMode: () => {
                if (state.onboarding) {
                  return;
                }
                state.applySettings({
                  ...state.settings,
                  chatFocusMode: !state.settings.chatFocusMode,
                });
              },
              onChatScroll: (event) => state.handleChatScroll(event),
              getDraft: () => state.chatMessage,
              onDraftChange: (next) => (state.chatMessage = next),
              onRequestUpdate: requestHostUpdate,
              attachments: state.chatAttachments,
              onAttachmentsChange: (next) => (state.chatAttachments = next),
              onSend: () => state.handleSendChat(),
              canAbort: Boolean(state.chatRunId),
              onAbort: () => void state.handleAbortChat(),
              onQueueRemove: (id) => state.removeQueuedMessage(id),
              onNewSession: () => state.handleSendChat("/new", { restoreDraft: true }),
              onClearHistory: async () => {
                if (!state.client || !state.connected) {
                  return;
                }
                try {
                  await state.client.request("sessions.reset", { key: state.sessionKey });
                  state.chatMessages = [];
                  state.chatStream = null;
                  state.chatRunId = null;
                  await loadChatHistory(state);
                } catch (err) {
                  state.lastError = String(err);
                }
              },
              agentsList: state.agentsList,
              currentAgentId: resolvedAgentId ?? "main",
              onAgentChange: (agentId: string) => {
                state.sessionKey = buildAgentMainSessionKey({ agentId });
                state.chatMessages = [];
                state.chatStream = null;
                state.chatRunId = null;
                state.applySettings({
                  ...state.settings,
                  sessionKey: state.sessionKey,
                  lastActiveSessionKey: state.sessionKey,
                });
                void loadChatHistory(state);
                void state.loadAssistantIdentity();
              },
              onNavigateToAgent: () => {
                state.agentsSelectedId = resolvedAgentId;
                state.setTab("agents" as import("./navigation.ts").Tab);
              },
              onSessionSelect: (key: string) => {
                switchChatSession(state, key);
              },
              showNewMessages: state.chatNewMessagesBelow && !state.chatManualRefreshInFlight,
              onScrollToBottom: () => state.scrollToBottom(),
              sidebarOpen: state.sidebarOpen,
              sidebarContent: state.sidebarContent,
              sidebarError: state.sidebarError,
              splitRatio: state.splitRatio,
              onOpenSidebar: (content: string) => state.handleOpenSidebar(content),
              onCloseSidebar: () => state.handleCloseSidebar(),
              onSplitRatioChange: (ratio: number) => state.handleSplitRatioChange(ratio),
              assistantName: state.assistantName,
              assistantAvatar: state.assistantAvatar,
              basePath: state.basePath ?? "",
            })
          : nothing}
        ${state.tab === "settings"
          ? renderConfig({
              raw: state.configRaw,
              originalRaw: state.configRawOriginal,
              valid: state.configValid,
              issues: state.configIssues,
              loading: state.configLoading,
              saving: state.configSaving,
              applying: state.configApplying,
              updating: state.updateRunning,
              connected: state.connected,
              schema: state.configSchema,
              schemaLoading: state.configSchemaLoading,
              uiHints: state.configUiHints,
              formMode: state.configFormMode,
              showModeToggle: true,
              formValue: state.configForm,
              originalValue: state.configFormOriginal,
              searchQuery: state.configSearchQuery,
              activeSection: state.configActiveSection,
              activeSubsection: state.configActiveSubsection,
              onRawChange: (next) => {
                state.configRaw = next;
              },
              onRequestUpdate: requestHostUpdate,
              onFormModeChange: (mode) => (state.configFormMode = mode),
              onFormPatch: (path, value) => updateConfigFormValue(state, path, value),
              onSearchChange: (query) => (state.configSearchQuery = query),
              onSectionChange: (section) => {
                state.configActiveSection = section;
                state.configActiveSubsection = null;
              },
              onSubsectionChange: (section) => (state.configActiveSubsection = section),
              onReload: () => loadConfig(state),
              onSave: () => saveConfig(state),
              onApply: () => applyConfig(state),
              onUpdate: () => runUpdate(state),
              onOpenFile: () => openConfigFile(state),
              version: state.hello?.server?.version ?? "",
              theme: state.theme,
              themeMode: state.themeMode,
              setTheme: (t, ctx) => state.setTheme(t, ctx),
              setThemeMode: (m, ctx) => state.setThemeMode(m, ctx),
              borderRadius: state.settings.borderRadius,
              setBorderRadius: (v) => state.setBorderRadius(v),
              gatewayUrl: state.settings.gatewayUrl,
              assistantName: state.assistantName,
              configPath: state.configSnapshot?.path ?? null,
              rawAvailable: typeof state.configSnapshot?.raw === "string",
            })
          : nothing}
      </main>
      <nav class="bottom-tab-bar">
        ${TABS.map((tab) => {
          const isActive = state.tab === tab;
          const href = pathForTab(tab, state.basePath);
          return html`
            <a
              href=${href}
              class="bottom-tab-bar__item ${isActive ? "bottom-tab-bar__item--active" : ""}"
              @click=${(event: MouseEvent) => {
                if (
                  event.defaultPrevented ||
                  event.button !== 0 ||
                  event.metaKey ||
                  event.ctrlKey ||
                  event.shiftKey ||
                  event.altKey
                ) {
                  return;
                }
                event.preventDefault();
                state.setTab(tab);
              }}
            >
              <span class="bottom-tab-bar__icon" aria-hidden="true">${icons[iconForTab(tab)]}</span>
              <span class="bottom-tab-bar__label">${titleForTab(tab)}</span>
            </a>
          `;
        })}
      </nav>
      ${nothing}
    </div>
  `;
}
