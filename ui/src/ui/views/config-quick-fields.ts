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
    if (!map.has(provider)) map.set(provider, []);
    map.get(provider)!.push(entry);
  }
  return map;
}

function formatContextWindow(ctx?: number): string {
  if (!ctx) return "";
  if (ctx >= 1_000_000) return `${(ctx / 1_000_000).toFixed(ctx % 1_000_000 === 0 ? 0 : 1)}M`;
  if (ctx >= 1_000) return `${Math.round(ctx / 1_000)}K`;
  return String(ctx);
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
  const providers = [...allProviderIds].sort();

  const rawModel = props.formValue
    ? getValueAtPath(props.formValue, MODEL_ENTRY.path)
    : undefined;
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

  const selectedAuthMethod = endpointOptions.find(
    (o) => (o.endpoint || o.id) === selectedEndpoint,
  ) ?? endpointOptions[0];
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
              ${label}${isConfiguredForProvider(providerAuthOptions, configuredProviders, p) ? " ✓" : ""} (${byProvider.get(p)?.length ?? 0})
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
                ${endpointOptions.map(
                  (opt) => {
                    const optValue = opt.endpoint || opt.id;
                    return html`<option value=${optValue} ?selected=${optValue === effectiveEndpoint}>
                      ${opt.label}${opt.hint ? ` (${opt.hint})` : ""}
                    </option>`;
                  },
                )}
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
            if (ctx) hints.push(ctx);
            if (m.reasoning) hints.push("reasoning");
            const suffix = hints.length ? ` — ${hints.join(", ")}` : "";
            return html`<option value=${value} ?selected=${isSelected}>${m.name || m.id}${suffix}</option>`;
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
                  if (!key || !client) return;
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

const MODEL_ENTRY: QuickSettingEntry = {
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
          (p) => html`<option value=${p.value} ?selected=${p.value === current}>${p.label}</option>`,
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
          (p) => html`<option value=${p.value} ?selected=${p.value === current}>${p.label}</option>`,
        )}
      </select>
    `;
  },
};

// --- Quick settings entries ---

export const QUICK_SETTINGS: readonly QuickSettingEntry[] = [
  {
    path: ["cognitive", "enabled"],
    label: "认知系统",
    description: "主动学习用户画像并推送洞察",
    section: "cognitive",
  },
  {
    path: ["cognitive", "proactive", "enabled"],
    label: "主动推送",
    description: "主动向用户发送洞察消息",
    section: "cognitive",
  },
  {
    path: ["cognitive", "persona", "autoExtract"],
    label: "用户画像",
    description: "自动从对话中提取兴趣和偏好",
    section: "cognitive",
  },
  {
    path: ["cognitive", "evolution", "enabled"],
    label: "自进化",
    description: "基于错误学习自动建议新技能",
    section: "cognitive",
  },
  MODEL_ENTRY,
  INTERVAL_ENTRY,
  {
    path: ["memory", "citations"],
    label: "来源标注",
    description: "显示回答内容的参考来源",
    section: "memory",
  },
  LANGUAGE_ENTRY,
  {
    path: ["tools", "loopDetection", "enabled"],
    label: "防重复保护",
    description: "检测并阻止重复的工具调用",
    section: "system",
  },
];

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
