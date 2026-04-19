import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import type {
  AgentIdentityResult,
  AgentsFilesListResult,
  AgentsListResult,
  ChannelsStatusSnapshot,
  CronJob,
  CronStatus,
  ModelCatalogEntry,
  SkillStatusReport,
  ToolsCatalogResult,
  ToolsEffectiveResult,
} from "../types.ts";
import { renderAgentOverview } from "./agents-panels-overview.ts";
import {
  renderAgentFiles,
  renderAgentCron,
} from "./agents-panels-status-files.ts";
import { renderAgentTools } from "./agents-panels-tools-skills.ts";
import {
  buildAgentContext,
  normalizeAgentLabel,
  resolveAgentEmoji,
  resolveModelLabel,
} from "./agents-utils.ts";

export type AgentsPanel = "overview" | "files" | "tools" | "cron";

export type ConfigState = {
  form: Record<string, unknown> | null;
  loading: boolean;
  saving: boolean;
  dirty: boolean;
};

export type ChannelsState = {
  snapshot: ChannelsStatusSnapshot | null;
  loading: boolean;
  error: string | null;
  lastSuccess: number | null;
};

export type CronState = {
  status: CronStatus | null;
  jobs: CronJob[];
  loading: boolean;
  error: string | null;
};

export type AgentFilesState = {
  list: AgentsFilesListResult | null;
  loading: boolean;
  error: string | null;
  active: string | null;
  contents: Record<string, string>;
  drafts: Record<string, string>;
  saving: boolean;
};

export type AgentSkillsState = {
  report: SkillStatusReport | null;
  loading: boolean;
  error: string | null;
  agentId: string | null;
  filter: string;
};

export type ToolsCatalogState = {
  loading: boolean;
  error: string | null;
  result: ToolsCatalogResult | null;
};

export type ToolsEffectiveState = {
  loading: boolean;
  error: string | null;
  result: ToolsEffectiveResult | null;
};

export type AgentsProps = {
  basePath: string;
  loading: boolean;
  error: string | null;
  agentsList: AgentsListResult | null;
  selectedAgentId: string | null;
  activePanel: AgentsPanel;
  config: ConfigState;
  channels: ChannelsState;
  cron: CronState;
  agentFiles: AgentFilesState;
  agentIdentityLoading: boolean;
  agentIdentityError: string | null;
  agentIdentityById: Record<string, AgentIdentityResult>;
  agentSkills: AgentSkillsState;
  toolsCatalog: ToolsCatalogState;
  toolsEffective: ToolsEffectiveState;
  runtimeSessionKey: string;
  runtimeSessionMatchesSelectedAgent: boolean;
  modelCatalog: ModelCatalogEntry[];
  onRefresh: () => void;
  onSelectAgent: (agentId: string) => void;
  onSelectPanel: (panel: AgentsPanel) => void;
  onLoadFiles: (agentId: string) => void;
  onSelectFile: (name: string) => void;
  onFileDraftChange: (name: string, content: string) => void;
  onFileReset: (name: string) => void;
  onFileSave: (name: string) => void;
  onToolsProfileChange: (agentId: string, profile: string | null, clearAllow: boolean) => void;
  onToolsOverridesChange: (agentId: string, alsoAllow: string[], deny: string[]) => void;
  onConfigReload: () => void;
  onConfigSave: () => void;
  onModelChange: (agentId: string, modelId: string | null) => void;
  onModelFallbacksChange: (agentId: string, fallbacks: string[]) => void;
  onCronRefresh: () => void;
  onCronRunNow: (jobId: string) => void;
  onSetDefault: (agentId: string) => void;
};

function countDetailMetrics(
  props: AgentsProps,
  agentId: string,
): {
  filesCount: number | null;
  skillsCount: number | null;
  toolsCount: number | null;
  cronCount: number | null;
  channelsCount: number | null;
} {
  const filesCount = props.agentFiles.list?.files?.length ?? null;
  const skillsCount =
    props.agentSkills.agentId === agentId
      ? (props.agentSkills.report?.skills?.length ?? null)
      : null;
  const toolsCount = props.toolsEffective.result?.groups?.reduce(
    (sum, group) => sum + (group.tools?.length ?? 0),
    0,
  ) ?? null;
  const cronCount = props.cron.jobs.filter((j) => j.agentId === agentId).length || null;
  const channelsCount = props.channels.snapshot
    ? Object.keys(props.channels.snapshot.channelAccounts ?? {}).length
    : null;
  return { filesCount, skillsCount, toolsCount, cronCount, channelsCount };
}

export function renderAgents(props: AgentsProps) {
  const agents = props.agentsList?.agents ?? [];
  const defaultId = props.agentsList?.defaultId ?? null;
  const selectedId = props.selectedAgentId ?? defaultId ?? agents[0]?.id ?? null;
  const selectedAgent = selectedId
    ? (agents.find((agent) => agent.id === selectedId) ?? null)
    : null;

  return html`
    <div class="agents-layout">
      <section class="agents-card-grid">
        ${agents.length === 0
          ? html`
              <div class="agent-card agent-card--empty">
                <div class="agent-card__body">
                  <div class="agent-card__name">${props.loading ? t("common.loading") : "No agents"}</div>
                  <div class="agent-card__sub">Configure agents to get started.</div>
                </div>
              </div>
            `
          : agents.map(
              (agent) =>
                renderAgentCard(agent, agent.id === selectedId, agent.id === defaultId, props),
            )}
      </section>

      ${props.error
        ? html`<div class="callout danger" style="margin-top: 8px;">${props.error}</div>`
        : nothing}

      ${selectedAgent
        ? html`
            <section class="agent-detail-panel">
              ${renderAgentDetailContent(props, selectedAgent, defaultId)}
            </section>
          `
        : nothing}
    </div>
  `;
}

function renderAgentCard(
  agent: AgentsListResult["agents"][number],
  isSelected: boolean,
  isDefault: boolean,
  props: AgentsProps,
) {
  const label = normalizeAgentLabel(agent);
  const emoji = resolveAgentEmoji(
    agent,
    props.agentIdentityById[agent.id] ?? null,
  );
  const modelLabel = resolveModelLabel(agent.model);
  const ctx = buildAgentContext(
    agent,
    props.config.form,
    props.agentFiles.list,
    isDefault ? agent.id : null,
    props.agentIdentityById[agent.id] ?? null,
  );

  return html`
    <button
      type="button"
      class="agent-card ${isSelected ? "agent-card--selected" : ""}"
      @click=${() => props.onSelectAgent(agent.id)}
    >
      <div class="agent-card__header">
        <span class="agent-card__indicator ${isSelected ? "agent-card__indicator--active" : ""}"></span>
        <span class="agent-card__avatar">${emoji || label.charAt(0).toUpperCase()}</span>
        <div class="agent-card__body">
          <div class="agent-card__name">
            ${label}
            ${isDefault
              ? html`<span class="agent-card__badge">default</span>`
              : nothing}
          </div>
          <div class="agent-card__sub">${modelLabel} · ${ctx.workspace}</div>
        </div>
      </div>
    </button>
  `;
}

function renderAgentDetailContent(
  props: AgentsProps,
  agent: AgentsListResult["agents"][number],
  defaultId: string | null,
) {
  const metrics = countDetailMetrics(props, agent.id);
  const isDefault = defaultId != null && agent.id === defaultId;

  return html`
    <div class="agent-detail-header">
      <div class="agent-detail-title">${normalizeAgentLabel(agent)}</div>
      <div class="agent-detail-actions">
        <button
          type="button"
          class="btn btn--sm btn--ghost"
          @click=${() => void navigator.clipboard.writeText(agent.id)}
          title="Copy agent ID to clipboard"
        >
          Copy ID
        </button>
        <button
          type="button"
          class="btn btn--sm btn--ghost"
          ?disabled=${isDefault}
          @click=${() => props.onSetDefault(agent.id)}
          title=${isDefault ? "Already the default agent" : "Set as the default agent"}
        >
          ${isDefault ? "Default" : "Set Default"}
        </button>
        <button
          type="button"
          class="btn btn--sm agents-refresh-btn"
          ?disabled=${props.loading}
          @click=${props.onRefresh}
        >
          ${props.loading ? t("common.loading") : t("common.refresh")}
        </button>
      </div>
    </div>

    <div class="agent-detail-stats">
      ${metricChip("Files", metrics.filesCount)}
      ${metricChip("Skills", metrics.skillsCount)}
      ${metricChip("Tools", metrics.toolsCount)}
      ${metricChip("Cron", metrics.cronCount)}
      ${metricChip("Channels", metrics.channelsCount)}
    </div>

    <div class="agent-detail-sections">
      <div class="agent-detail-section">
        <button
          type="button"
          class="agent-detail-section__toggle"
          @click=${() => props.onSelectPanel("overview")}
        >
          Overview
        </button>
        ${props.activePanel === "overview"
          ? html`<div class="agent-detail-section__content">
              ${renderAgentOverview({
                agent,
                basePath: props.basePath,
                defaultId,
                configForm: props.config.form,
                agentFilesList: props.agentFiles.list,
                agentIdentity: props.agentIdentityById[agent.id] ?? null,
                agentIdentityError: props.agentIdentityError,
                agentIdentityLoading: props.agentIdentityLoading,
                configLoading: props.config.loading,
                configSaving: props.config.saving,
                configDirty: props.config.dirty,
                modelCatalog: props.modelCatalog,
                onConfigReload: props.onConfigReload,
                onConfigSave: props.onConfigSave,
                onModelChange: props.onModelChange,
                onModelFallbacksChange: props.onModelFallbacksChange,
                onSelectPanel: props.onSelectPanel,
              })}
            </div>`
          : nothing}
      </div>

      <div class="agent-detail-section">
        <button
          type="button"
          class="agent-detail-section__toggle"
          @click=${() => props.onSelectPanel("files")}
        >
          Files
        </button>
        ${props.activePanel === "files"
          ? html`<div class="agent-detail-section__content">
              ${renderAgentFiles({
                agentId: agent.id,
                agentFilesList: props.agentFiles.list,
                agentFilesLoading: props.agentFiles.loading,
                agentFilesError: props.agentFiles.error,
                agentFileActive: props.agentFiles.active,
                agentFileContents: props.agentFiles.contents,
                agentFileDrafts: props.agentFiles.drafts,
                agentFileSaving: props.agentFiles.saving,
                onLoadFiles: props.onLoadFiles,
                onSelectFile: props.onSelectFile,
                onFileDraftChange: props.onFileDraftChange,
                onFileReset: props.onFileReset,
                onFileSave: props.onFileSave,
              })}
            </div>`
          : nothing}
      </div>

      <div class="agent-detail-section">
        <button
          type="button"
          class="agent-detail-section__toggle"
          @click=${() => props.onSelectPanel("tools")}
        >
          Tools
        </button>
        ${props.activePanel === "tools"
          ? html`<div class="agent-detail-section__content">
              ${renderAgentTools({
                agentId: agent.id,
                configForm: props.config.form,
                configLoading: props.config.loading,
                configSaving: props.config.saving,
                configDirty: props.config.dirty,
                toolsCatalogLoading: props.toolsCatalog.loading,
                toolsCatalogError: props.toolsCatalog.error,
                toolsCatalogResult: props.toolsCatalog.result,
                toolsEffectiveLoading: props.toolsEffective.loading,
                toolsEffectiveError: props.toolsEffective.error,
                toolsEffectiveResult: props.toolsEffective.result,
                runtimeSessionKey: props.runtimeSessionKey,
                runtimeSessionMatchesSelectedAgent: props.runtimeSessionMatchesSelectedAgent,
                onProfileChange: props.onToolsProfileChange,
                onOverridesChange: props.onToolsOverridesChange,
                onConfigReload: props.onConfigReload,
                onConfigSave: props.onConfigSave,
              })}
            </div>`
          : nothing}
      </div>

      <div class="agent-detail-section">
        <button
          type="button"
          class="agent-detail-section__toggle"
          @click=${() => props.onSelectPanel("cron")}
        >
          Cron Jobs
        </button>
        ${props.activePanel === "cron"
          ? html`<div class="agent-detail-section__content">
              ${renderAgentCron({
                context: buildAgentContext(
                  agent,
                  props.config.form,
                  props.agentFiles.list,
                  defaultId,
                  props.agentIdentityById[agent.id] ?? null,
                ),
                agentId: agent.id,
                jobs: props.cron.jobs,
                status: props.cron.status,
                loading: props.cron.loading,
                error: props.cron.error,
                onRefresh: props.onCronRefresh,
                onRunNow: props.onCronRunNow,
                onSelectPanel: props.onSelectPanel,
              })}
            </div>`
          : nothing}
      </div>
    </div>
  `;
}

function metricChip(label: string, count: number | null) {
  return html`
    <span class="agent-detail-stat">
      <span class="agent-detail-stat__value">${count != null ? count : "—"}</span>
      <span class="agent-detail-stat__label">${label}</span>
    </span>
  `;
}
