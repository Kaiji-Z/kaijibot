import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import type {
  AgentIdentityResult,
  AgentsFilesListResult,
  AgentsListResult,
  ModelCatalogEntry,
} from "../types.ts";
import {
  buildGroupedModelOptions,
  formatContextWindow,
  groupCatalogByProvider,
  normalizeModelValue,
  resolveAgentConfig,
  resolveModelFallbacks,
  resolveModelLabel,
  resolveModelPrimary,
  sortLocaleStrings,
} from "./agents-utils.ts";
import type { AgentsPanel } from "./agents.ts";

let selectedProvider = "";
let pendingFallbackSlots = 0;

export function renderAgentOverview(params: {
  agent: AgentsListResult["agents"][number];
  basePath: string;
  defaultId: string | null;
  configForm: Record<string, unknown> | null;
  agentFilesList: AgentsFilesListResult | null;
  agentIdentity: AgentIdentityResult | null;
  agentIdentityLoading: boolean;
  agentIdentityError: string | null;
  configLoading: boolean;
  configSaving: boolean;
  configDirty: boolean;
  modelCatalog: ModelCatalogEntry[];
  configuredProviders: string[];
  onConfigReload: () => void;
  onConfigSave: () => void;
  onModelChange: (agentId: string, modelId: string | null) => void;
  onModelFallbacksChange: (agentId: string, fallbacks: string[]) => void;
  onSelectPanel: (panel: AgentsPanel) => void;
  onRequestUpdate?: () => void;
}) {
  const {
    agent,
    configForm,
    agentFilesList,
    configLoading,
    configSaving,
    configDirty,
    onConfigReload,
    onConfigSave,
    onModelChange,
    onModelFallbacksChange,
    onSelectPanel,
  } = params;
  const config = resolveAgentConfig(configForm, agent.id);
  const agentModel = agent.model;
  const workspaceFromFiles =
    agentFilesList && agentFilesList.agentId === agent.id ? agentFilesList.workspace : null;
  const workspace =
    workspaceFromFiles ||
    config.entry?.workspace ||
    config.defaults?.workspace ||
    agent.workspace ||
    "default";
  const model = config.entry?.model
    ? resolveModelLabel(config.entry?.model)
    : config.defaults?.model
      ? resolveModelLabel(config.defaults?.model)
      : resolveModelLabel(agentModel);
  const defaultModel = resolveModelLabel(config.defaults?.model ?? agentModel);
  const entryPrimary = resolveModelPrimary(config.entry?.model);
  const defaultPrimary =
    resolveModelPrimary(config.defaults?.model) ||
    (defaultModel !== "-" ? normalizeModelValue(defaultModel) : null) ||
    (configForm ? null : resolveModelPrimary(agentModel));
  const effectivePrimary = entryPrimary ?? defaultPrimary ?? null;
  const modelFallbacks =
    resolveModelFallbacks(config.entry?.model) ??
    resolveModelFallbacks(config.defaults?.model) ??
    (configForm ? null : resolveModelFallbacks(agentModel));
  const fallbackChips = modelFallbacks ?? [];
  const skillFilter = Array.isArray(config.entry?.skills) ? config.entry?.skills : null;
  const skillCount = skillFilter?.length ?? null;
  const isDefault = Boolean(params.defaultId && agent.id === params.defaultId);
  const disabled = !configForm || configLoading || configSaving;

  const configured = new Set(params.configuredProviders ?? []);
  const configuredCatalog = params.modelCatalog.filter(
    (m) => !m.provider || configured.has(m.provider),
  );
  const byProvider = groupCatalogByProvider(configuredCatalog);
  const providers = sortLocaleStrings(byProvider.keys());
  if (!selectedProvider && effectivePrimary) {
    const slashIdx = effectivePrimary.indexOf("/");
    selectedProvider = slashIdx > 0 ? effectivePrimary.slice(0, slashIdx) : effectivePrimary;
  }
  if (!selectedProvider && providers.length > 0) {
    selectedProvider = providers[0];
  }
  const providerModels = byProvider.get(selectedProvider) ?? [];

  const removeChip = (index: number) => {
    const next = fallbackChips.filter((_, i) => i !== index);
    onModelFallbacksChange(agent.id, next);
  };

  return html`
    <section class="card">
      <div class="card-title">Overview</div>
      <div class="card-sub">Workspace paths and identity metadata.</div>

      <div class="agents-overview-grid" style="margin-top: 16px;">
        <div class="agent-kv">
          <div class="label">Workspace</div>
          <div>
            <button
              type="button"
              class="workspace-link mono"
              @click=${() => onSelectPanel("files")}
              title="Open Files tab"
            >
              ${workspace}
            </button>
          </div>
        </div>
        <div class="agent-kv">
          <div class="label">Primary Model</div>
          <div class="mono">${model}</div>
        </div>
        <div class="agent-kv">
          <div class="label">Skills Filter</div>
          <div>${skillFilter ? `${skillCount} selected` : "all skills"}</div>
        </div>
      </div>

      ${configDirty
        ? html`
            <div class="callout warn" style="margin-top: 16px">
              You have unsaved config changes.
            </div>
          `
        : nothing}

      <div class="agent-model-select" style="margin-top: 20px;">
        <div class="label">Model Selection</div>
        <div class="agent-model-fields">
          <label class="field">
            <span>Primary model${isDefault ? " (default)" : ""}</span>
            <div class="config-model-selector">
              <div class="config-model-selector__row">
                <select
                  class="config-quick-settings__select"
                  ?disabled=${disabled}
                  @change=${(e: Event) => {
                    selectedProvider = (e.target as HTMLSelectElement).value;
                    params.onRequestUpdate?.();
                  }}
                >
                  ${providers.map(
                    (p) =>
                      html`<option value=${p} ?selected=${p === selectedProvider}>
                        ${p}${configured.has(p) ? " ✓" : ""} (${byProvider.get(p)?.length ?? 0})
                      </option>`,
                  )}
                </select>
                <select
                  class="config-quick-settings__select"
                  ?disabled=${disabled}
                  @change=${(e: Event) => {
                    const modelId = (e.target as HTMLSelectElement).value;
                    onModelChange(agent.id, modelId || null);
                  }}
                >
                  ${isDefault
                    ? html` <option value="">Not set</option> `
                    : html`
                        <option value="">
                          ${defaultPrimary
                            ? `Inherit default (${defaultPrimary})`
                            : "Inherit default"}
                        </option>
                      `}
                  ${providerModels.map((m) => {
                    const value = m.provider ? `${m.provider}/${m.id}` : m.id;
                    const isSelected = value === effectivePrimary || m.id === effectivePrimary;
                    const ctx = formatContextWindow(m.contextWindow);
                    const hints: string[] = [];
                    if (ctx) {
                      hints.push(ctx);
                    }
                    if (m.reasoning) {
                      hints.push("reasoning");
                    }
                    const suffix = hints.length ? ` — ${hints.join(", ")}` : "";
                    return html`<option value=${value} ?selected=${isSelected}>
                      ${m.name || m.id}${suffix}
                    </option>`;
                  })}
                </select>
              </div>
            </div>
          </label>
          <div class="field">
            <span>Fallbacks</span>
            <div class="agent-fallback-list">
              ${fallbackChips.map(
                (chip, i) => html`
                  <div class="agent-fallback-item">
                    <select
                      class="config-quick-settings__select"
                      ?disabled=${disabled}
                      @change=${(e: Event) => {
                        const newFallbacks = [...fallbackChips];
                        newFallbacks[i] = (e.target as HTMLSelectElement).value;
                        onModelFallbacksChange(agent.id, newFallbacks);
                      }}
                    >
                      ${buildGroupedModelOptions(chip, configuredCatalog)}
                    </select>
                    <button
                      type="button"
                      class="btn btn--sm"
                      ?disabled=${disabled}
                      @click=${() => removeChip(i)}
                    >
                      ×
                    </button>
                  </div>
                `,
              )}
              ${Array.from(
                { length: pendingFallbackSlots },
                (_, _slotIdx) => html`
                  <div class="agent-fallback-item">
                    <select
                      class="config-quick-settings__select"
                      ?disabled=${disabled}
                      @change=${(e: Event) => {
                        const modelId = (e.target as HTMLSelectElement).value;
                        if (modelId) {
                          pendingFallbackSlots = Math.max(0, pendingFallbackSlots - 1);
                          onModelFallbacksChange(agent.id, [...fallbackChips, modelId]);
                        }
                      }}
                    >
                      <option value="" selected>Select fallback model...</option>
                      ${buildGroupedModelOptions(null, configuredCatalog)}
                    </select>
                    <button
                      type="button"
                      class="btn btn--sm"
                      ?disabled=${disabled}
                      @click=${() => {
                        pendingFallbackSlots = Math.max(0, pendingFallbackSlots - 1);
                        params.onRequestUpdate?.();
                      }}
                    >
                      ×
                    </button>
                  </div>
                `,
              )}
              <button
                type="button"
                class="btn btn--sm"
                ?disabled=${disabled}
                @click=${() => {
                  pendingFallbackSlots++;
                  params.onRequestUpdate?.();
                }}
              >
                + Add fallback
              </button>
            </div>
          </div>
        </div>
        <div class="agent-model-actions">
          <button
            type="button"
            class="btn btn--sm"
            ?disabled=${configLoading}
            @click=${onConfigReload}
          >
            ${t("common.reloadConfig")}
          </button>
          <button
            type="button"
            class="btn btn--sm primary"
            ?disabled=${configSaving || !configDirty}
            @click=${onConfigSave}
          >
            ${configSaving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </section>
  `;
}
