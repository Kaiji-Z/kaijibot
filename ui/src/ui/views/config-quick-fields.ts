import { html, nothing, type TemplateResult } from "lit";
import { t } from "../../i18n/index.ts";
import type { ModelCatalogEntry, ProviderAuthInfo } from "../types.ts";
import type { ConfigProps } from "./config.js";

export type QuickSettingCustomRender = (props: ConfigProps) => TemplateResult | typeof nothing;

export interface QuickSettingEntry {
  path: string[];
  label: string;
  description?: string;
  section: string;
  render?: QuickSettingCustomRender;
}

// --- Model selector state ---

let selectedProvider = "";
let selectedEndpoint = "";
let apiKeyInput = "";
let apiKeySaving = false;
let apiKeySaved = false;
let apiKeyError = false;

function groupCatalogByProvider(catalog: ModelCatalogEntry[]): Map<string, ModelCatalogEntry[]> {
  const map = new Map<string, ModelCatalogEntry[]>();
  for (const entry of catalog) {
    const provider = entry.provider || "unknown";
    if (!map.has(provider)) {
      map.set(provider, []);
    }
    map.get(provider)!.push(entry);
  }
  return map;
}

function formatContextWindow(ctx?: number): string {
  if (!ctx) {
    return "";
  }
  if (ctx >= 1_000_000) {
    return `${(ctx / 1_000_000).toFixed(ctx % 1_000_000 === 0 ? 0 : 1)}M`;
  }
  if (ctx >= 1_000) {
    return `${Math.round(ctx / 1_000)}K`;
  }
  return String(ctx);
}

// --- Favorite Models whitelist helpers ---

const MODELS_WHITELIST_PATH = ["agents", "defaults", "models"];

function getModelsWhitelist(formValue: Record<string, unknown> | null): Set<string> {
  if (!formValue) {
    return new Set();
  }
  const models = getValueAtPath(formValue, MODELS_WHITELIST_PATH);
  if (!models || typeof models !== "object" || Array.isArray(models)) {
    return new Set();
  }
  return new Set(Object.keys(models as Record<string, unknown>));
}

function toggleModelFavorite(
  props: ConfigProps,
  modelKey: string,
  currentWhitelist: Set<string>,
  favorited: boolean,
): void {
  if (!props.formValue) {
    return;
  }
  const base = structuredClone(props.formValue);
  if (!base.agents || typeof base.agents !== "object") {
    base.agents = {};
  }
  const agents = base.agents as Record<string, unknown>;
  if (!agents.defaults || typeof agents.defaults !== "object") {
    agents.defaults = {};
  }
  const defaults = agents.defaults as Record<string, unknown>;
  const existingModels = defaults.models;
  const modelsObj: Record<string, unknown> =
    existingModels && typeof existingModels === "object" && !Array.isArray(existingModels)
      ? { ...(existingModels as Record<string, unknown>) }
      : {};

  if (favorited) {
    modelsObj[modelKey] = {};
  } else {
    delete modelsObj[modelKey];
  }
  defaults.models = modelsObj;
  props.onFormPatch(MODELS_WHITELIST_PATH, modelsObj);
}

function setAllFavorites(props: ConfigProps, allModelKeys: string[], favorited: boolean): void {
  if (!props.formValue) {
    return;
  }
  const modelsObj: Record<string, unknown> = {};
  if (favorited) {
    for (const key of allModelKeys) {
      modelsObj[key] = {};
    }
  }
  props.onFormPatch(MODELS_WHITELIST_PATH, modelsObj);
}

function getConfiguredModels(
  catalog: ModelCatalogEntry[],
  configuredProviders: Set<string>,
): ModelCatalogEntry[] {
  return catalog.filter((m) => configuredProviders.has(m.provider));
}

const collapsedProviders = new Set<string>();

function renderFavoriteModels(
  props: ConfigProps,
  configuredProviderSet: Set<string>,
): TemplateResult | typeof nothing {
  const configuredModels = getConfiguredModels(props.fullModelCatalog ?? [], configuredProviderSet);
  if (configuredModels.length === 0) {
    return nothing;
  }

  const whitelist = getModelsWhitelist(props.formValue);
  const favoritedCount = configuredModels.filter((m) => {
    const key = m.provider ? `${m.provider}/${m.id}` : m.id;
    return whitelist.has(key);
  }).length;
  const totalCount = configuredModels.length;
  const allFavorited = favoritedCount === totalCount;

  const byProvider = groupCatalogByProvider(configuredModels);
  const sortedProviders = [...byProvider.keys()].toSorted();

  return html`
    <div class="config-model-favorites">
      <div class="config-model-favorites__header">
        <span class="config-model-favorites__title">收藏模型</span>
        <span class="config-model-favorites__count">
          ${allFavorited ? "全部已收藏" : `已收藏 ${favoritedCount}/${totalCount}`}
        </span>
        <div class="config-model-favorites__actions">
          <button
            class="config-model-favorites__bulk-btn"
            ?disabled=${props.loading || allFavorited}
            @click=${() => {
              const allKeys = configuredModels.map((m) =>
                m.provider ? `${m.provider}/${m.id}` : m.id,
              );
              setAllFavorites(props, allKeys, true);
              props.onRequestUpdate?.();
            }}
          >
            全选
          </button>
          <button
            class="config-model-favorites__bulk-btn"
            ?disabled=${props.loading || favoritedCount === 0}
            @click=${() => {
              setAllFavorites(props, [], false);
              props.onRequestUpdate?.();
            }}
          >
            清空
          </button>
        </div>
      </div>
      ${favoritedCount === 0
        ? html`<div class="config-model-favorites__hint">收藏模型后可在聊天中快速切换</div>`
        : nothing}
      <div class="config-model-favorites__grid">
        ${sortedProviders.map((provider) => {
          const models = byProvider.get(provider) ?? [];
          const authInfo = (props.providerAuthOptions ?? []).find((p) => p.providerId === provider);
          const providerLabel = authInfo?.providerLabel ?? provider;
          const providerFavCount = models.filter((m) =>
            whitelist.has(m.provider ? `${m.provider}/${m.id}` : m.id),
          ).length;
          const collapsed = collapsedProviders.has(provider);
          return html`
            <div class="config-model-favorites__provider">
              <button
                class="config-model-favorites__provider-toggle"
                @click=${() => {
                  if (collapsedProviders.has(provider)) {
                    collapsedProviders.delete(provider);
                  } else {
                    collapsedProviders.add(provider);
                  }
                  props.onRequestUpdate?.();
                }}
              >
                <span
                  class="config-model-favorites__provider-arrow ${collapsed
                    ? "config-model-favorites__provider-arrow--collapsed"
                    : ""}"
                  >▸</span
                >
                <span class="config-model-favorites__provider-label">${providerLabel}</span>
                <span class="config-model-favorites__provider-count"
                  >${providerFavCount}/${models.length}</span
                >
              </button>
              ${!collapsed
                ? html`<div class="config-model-favorites__models">
                    ${models.map((m) => {
                      const key = m.provider ? `${m.provider}/${m.id}` : m.id;
                      const isFav = whitelist.has(key);
                      return html`
                        <button
                          class="config-model-favorites__model ${isFav
                            ? "config-model-favorites__model--fav"
                            : ""}"
                          ?disabled=${props.loading}
                          title=${isFav ? "取消收藏" : "收藏"}
                          @click=${() => {
                            toggleModelFavorite(props, key, whitelist, !isFav);
                            props.onRequestUpdate?.();
                          }}
                        >
                          <span class="config-model-favorites__star">${isFav ? "★" : "☆"}</span>
                          <span class="config-model-favorites__model-name">${m.name || m.id}</span>
                        </button>
                      `;
                    })}
                  </div>`
                : nothing}
            </div>
          `;
        })}
      </div>
    </div>
  `;
}

function renderModelSelect(props: ConfigProps): TemplateResult | typeof nothing {
  const catalog = props.fullModelCatalog ?? [];
  const client = props.client;
  const providerAuthOptions = props.providerAuthOptions ?? [];
  const configuredProviders = new Set(props.configuredProviders ?? []);

  if (catalog.length === 0 && providerAuthOptions.length === 0) {
    return html`<div class="config-model-selector__loading">${t("common.loading")}</div>`;
  }

  const byProvider = groupCatalogByProvider(catalog);

  const allProviderIds = new Set([
    ...byProvider.keys(),
    ...providerAuthOptions.map((p) => p.providerId),
  ]);
  const providers = [...allProviderIds].toSorted();

  const rawModel = props.formValue ? getValueAtPath(props.formValue, MODEL_ENTRY.path) : undefined;
  const currentModel =
    typeof rawModel === "string"
      ? rawModel
      : rawModel != null && typeof rawModel === "object" && "primary" in rawModel
        ? String((rawModel as { primary: unknown }).primary)
        : undefined;

  if (!selectedProvider && currentModel) {
    const slashIdx = currentModel.indexOf("/");
    selectedProvider = slashIdx > 0 ? currentModel.slice(0, slashIdx) : currentModel;
  }
  if (!selectedProvider && providers.length > 0) {
    selectedProvider = providers[0];
  }

  const authInfo = providerAuthOptions.find((p) => p.providerId === selectedProvider);
  const isConfigured = authInfo?.configured ?? configuredProviders.has(selectedProvider ?? "");

  const endpointOptions = authInfo?.authOptions.filter((o) => o.kind === "api_key") ?? [];
  const hasEndpoints = endpointOptions.length > 1;

  const selectedAuthMethod =
    endpointOptions.find((o) => (o.endpoint || o.id) === selectedEndpoint) ?? endpointOptions[0];
  const effectiveEndpoint = selectedAuthMethod?.endpoint || selectedAuthMethod?.id || "";

  const providerModels = byProvider.get(selectedProvider ?? "") ?? [];
  const needsApiKey = Boolean(selectedProvider && !isConfigured && client);

  return html`
    <div class="config-model-selector">
      <div class="config-model-selector__row">
        <!-- Provider select -->
        <select
          class="config-quick-settings__select"
          ?disabled=${props.loading}
          @change=${(e: Event) => {
            selectedProvider = (e.target as HTMLSelectElement).value;
            selectedEndpoint = "";
            apiKeySaved = false;
            apiKeyError = false;
            props.onRequestUpdate?.();
          }}
        >
          ${providers.map((p) => {
            const info = providerAuthOptions.find((i) => i.providerId === p);
            const label = info?.providerLabel ?? p;
            return html`<option value=${p} ?selected=${p === selectedProvider}>
              ${label}${isConfiguredForProvider(providerAuthOptions, configuredProviders, p)
                ? " ✓"
                : ""}
              (${byProvider.get(p)?.length ?? 0})
            </option>`;
          })}
        </select>

        <!-- Endpoint select (conditional) -->
        ${hasEndpoints
          ? html`
              <select
                class="config-quick-settings__select"
                ?disabled=${props.loading}
                @change=${(e: Event) => {
                  selectedEndpoint = (e.target as HTMLSelectElement).value;
                  apiKeySaved = false;
                  apiKeyError = false;
                  props.onRequestUpdate?.();
                }}
              >
                ${endpointOptions.map((opt) => {
                  const optValue = opt.endpoint || opt.id;
                  return html`<option value=${optValue} ?selected=${optValue === effectiveEndpoint}>
                    ${opt.label}${opt.hint ? ` (${opt.hint})` : ""}
                  </option>`;
                })}
              </select>
            `
          : nothing}

        <!-- Model select -->
        <select
          class="config-quick-settings__select"
          ?disabled=${props.loading || needsApiKey}
          @change=${(e: Event) => {
            const modelId = (e.target as HTMLSelectElement).value;
            if (modelId) {
              props.onFormPatch(MODEL_ENTRY.path, { primary: modelId });
            }
          }}
        >
          <option value="" disabled ?selected=${!currentModel}>Select model</option>
          ${providerModels.map((m) => {
            const value = m.provider ? `${m.provider}/${m.id}` : m.id;
            const isSelected = value === currentModel || m.id === currentModel;
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

      <!-- API Key input (when provider not configured) -->
      ${needsApiKey
        ? html`
            <div class="config-model-selector__apikey">
              <input
                type="password"
                class="config-quick-settings__input"
                placeholder="API Key"
                .value=${apiKeyInput}
                @input=${(e: Event) => {
                  apiKeyInput = (e.target as HTMLInputElement).value;
                  apiKeySaved = false;
                  apiKeyError = false;
                  props.onRequestUpdate?.();
                }}
              />
              <button
                class="btn btn--sm"
                ?disabled=${apiKeySaving || !apiKeyInput.trim()}
                @click=${() => {
                  const key = apiKeyInput.trim();
                  if (!key || !client) {
                    return;
                  }
                  apiKeySaving = true;
                  apiKeySaved = false;
                  apiKeyError = false;
                  props.onRequestUpdate?.();
                  client
                    .request<{ ok: boolean }>("auth.storeApiKey", {
                      provider: selectedProvider,
                      apiKey: key,
                      ...(effectiveEndpoint ? { endpoint: effectiveEndpoint } : {}),
                    })
                    .then(async () => {
                      apiKeySaving = false;
                      apiKeySaved = true;
                      apiKeyInput = "";
                      await props.onProvidersChanged?.();
                    })
                    .catch(() => {
                      apiKeySaving = false;
                      apiKeyError = true;
                    })
                    .finally(() => props.onRequestUpdate?.());
                }}
              >
                ${apiKeySaving
                  ? t("common.loading")
                  : apiKeySaved
                    ? t("config.apiKeysSaved")
                    : apiKeyError
                      ? t("config.apiKeysError")
                      : t("config.apiKeysSave")}
              </button>
            </div>
          `
        : nothing}

      <!-- Favorite Models section -->
      ${renderFavoriteModels(props, configuredProviders)}
    </div>
  `;
}

function isConfiguredForProvider(
  authOptions: ProviderAuthInfo[],
  configuredProviders: Set<string>,
  providerId: string,
): boolean {
  const info = authOptions.find((p) => p.providerId === providerId);
  return info?.configured ?? configuredProviders.has(providerId);
}

// --- Named entries ---

export const MODEL_ENTRY: QuickSettingEntry = {
  path: ["agents", "defaults", "model"],
  label: "AI 模型",
  description: "对话使用的大语言模型",
  section: "model",
  render: (props) => renderModelSelect(props),
};

const INTERVAL_PRESETS = [
  { value: 1, label: "1小时" },
  { value: 2, label: "2小时" },
  { value: 4, label: "4小时" },
  { value: 8, label: "8小时" },
  { value: 12, label: "12小时" },
  { value: 24, label: "24小时" },
  { value: 48, label: "48小时" },
] as const;

const INTERVAL_ENTRY: QuickSettingEntry = {
  path: ["cognitive", "proactive", "minIntervalHours"],
  label: "推送间隔",
  description: "主动推送的最小间隔",
  section: "cognitive",
  render: (props) => {
    const raw = props.formValue ? getValueAtPath(props.formValue, INTERVAL_ENTRY.path) : undefined;
    const current = typeof raw === "number" ? raw : 4;
    return html`
      <select
        class="config-quick-settings__select"
        ?disabled=${props.loading}
        @change=${(e: Event) => {
          props.onFormPatch(INTERVAL_ENTRY.path, Number((e.target as HTMLSelectElement).value));
        }}
      >
        ${INTERVAL_PRESETS.map(
          (p) =>
            html`<option value=${p.value} ?selected=${p.value === current}>${p.label}</option>`,
        )}
      </select>
    `;
  },
};

const LANGUAGE_PRESETS = [
  { value: "", label: "自动" },
  { value: "zh", label: "中文" },
  { value: "en", label: "English" },
  { value: "ja", label: "日本語" },
  { value: "ko", label: "한국어" },
] as const;

const LANGUAGE_ENTRY: QuickSettingEntry = {
  path: ["cognitive", "insight", "outputLanguage"],
  label: "洞察语言",
  description: "主动推送消息使用的语言",
  section: "cognitive",
  render: (props) => {
    const raw = props.formValue ? getValueAtPath(props.formValue, LANGUAGE_ENTRY.path) : undefined;
    const current = typeof raw === "string" ? raw : "";
    return html`
      <select
        class="config-quick-settings__select"
        ?disabled=${props.loading}
        @change=${(e: Event) => {
          props.onFormPatch(LANGUAGE_ENTRY.path, (e.target as HTMLSelectElement).value);
        }}
      >
        ${LANGUAGE_PRESETS.map(
          (p) =>
            html`<option value=${p.value} ?selected=${p.value === current}>${p.label}</option>`,
        )}
      </select>
    `;
  },
};

function renderCognitiveModelSelect(props: ConfigProps): TemplateResult | typeof nothing {
  const catalog = props.fullModelCatalog ?? [];
  const whitelist = getModelsWhitelist(props.formValue);

  const favorited = catalog.filter((m) => {
    const key = m.provider ? `${m.provider}/${m.id}` : m.id;
    return whitelist.has(key);
  });

  const rawModel = props.formValue
    ? getValueAtPath(props.formValue, ["cognitive", "insight", "inferenceModel"])
    : undefined;
  const currentModel = typeof rawModel === "string" ? rawModel : "";

  if (favorited.length === 0 && catalog.length === 0) {
    return html`<div class="config-model-selector__loading">${t("common.loading")}</div>`;
  }

  const options =
    favorited.length > 0
      ? favorited
      : catalog.slice(0, 20);

  return html`
    <select
      class="config-quick-settings__select"
      ?disabled=${props.loading}
      @change=${(e: Event) => {
        const value = (e.target as HTMLSelectElement).value;
        props.onFormPatch(
          ["cognitive", "insight", "inferenceModel"],
          value || undefined,
        );
      }}
    >
      <option value="" ?selected=${!currentModel}>使用默认模型</option>
      ${options.map((m) => {
        const key = m.provider ? `${m.provider}/${m.id}` : m.id;
        return html`<option value=${key} ?selected=${key === currentModel}>
          ${m.provider ? `${m.provider} / ` : ""}${m.name}
        </option>`;
      })}
    </select>
  `;
}

// --- Quick settings entries ---

export const QUICK_SETTINGS: readonly QuickSettingEntry[] = [
  {
    path: ["cognitive", "enabled"],
    label: "认知系统",
    description: "主动学习用户画像并推送洞察",
    section: "cognitive",
  },
  {
    path: ["cognitive", "insight", "inferenceModel"],
    label: "认知模型",
    description: "洞察生成和画像提取使用的模型",
    section: "cognitive",
    render: (props) => renderCognitiveModelSelect(props),
  },
  {
    path: ["tools", "loopDetection", "enabled"],
    label: "防重复保护",
    description: "检测并阻止重复的工具调用",
    section: "system",
  },
  {
    path: ["plugins", "entries", "knowledge-wiki", "config", "enabled"],
    label: "知识维基",
    description: "LLM 自动编译工作空间文件为结构化知识库",
    section: "system",
  },
  {
    path: ["plugins", "entries", "kindle-portal", "enabled"],
    label: "Kindle 监控",
    description: "启用后可在 Kindle 电子书上查看 agent 状态与配额用量",
    section: "system",
    render: (props) => renderKindleToggle(props),
  },
];

let kindleUrlCache: string | null | undefined;

async function fetchKindleUrl(): Promise<string | null> {
  if (kindleUrlCache !== undefined) {
    return kindleUrlCache;
  }
  try {
    const resp = await fetch("/api/status");
    if (!resp.ok) {
      return null;
    }
    const data = (await resp.json()) as { lanIp?: string | null; port?: number };
    if (data.lanIp && data.port) {
      kindleUrlCache = `http://${data.lanIp}:${data.port}/kindle/`;
    } else {
      kindleUrlCache = null;
    }
  } catch {
    kindleUrlCache = null;
  }
  return kindleUrlCache;
}

function renderKindleToggle(props: ConfigProps): TemplateResult | typeof nothing {
  const KINDLE_PATH = ["plugins", "entries", "kindle-portal", "enabled"];
  const value = getValueAtPath(props.formValue ?? {}, KINDLE_PATH);
  const enabled = value === true;

  if (kindleUrlCache === undefined) {
    fetchKindleUrl().then(() => {
      props.onRequestUpdate?.();
    });
  }

  return html`
    <div>
      <label class="cfg-toggle-row ${props.loading ? "disabled" : ""}">
        <div class="cfg-toggle-row__content">
          <span class="cfg-toggle-row__label">Kindle 监控已${enabled ? "开启" : "关闭"}</span>
        </div>
        <div class="cfg-toggle">
          <input
            type="checkbox"
            .checked=${enabled}
            ?disabled=${props.loading}
            @change=${(e: Event) => {
              const v = (e.target as HTMLInputElement).checked;
              props.onFormPatch(KINDLE_PATH, v);
              if (v) {
                props.onFormPatch(["gateway", "bind"], "lan");
              }
            }}
          />
          <span class="cfg-toggle__track"></span>
        </div>
      </label>
      ${enabled && kindleUrlCache
        ? html`<div class="config-quick-settings__hint">
            Kindle 浏览器输入：<strong>${kindleUrlCache}</strong>
          </div>`
        : nothing}
    </div>
  `;
}

function getValueAtPath(root: Record<string, unknown>, path: readonly string[]): unknown {
  let current: unknown = root;
  for (const segment of path) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}
