import { html, nothing, type TemplateResult } from "lit";
import { t } from "../../i18n/index.ts";
import { icons } from "../icons.ts";
import type { ThemeTransitionContext } from "../theme-transition.ts";
import { themeDisplayName, type ThemeMode, type ThemeName } from "../theme.ts";
import type { ConfigUiHints } from "../types.ts";
import { renderNode } from "./config-form.node.ts";
import { humanize, schemaType, type JsonSchema } from "./config-form.shared.ts";
import { analyzeConfigSchema, SECTION_META } from "./config-form.ts";
import { MODEL_ENTRY, QUICK_SETTINGS } from "./config-quick-fields.ts";

export type ConfigProps = {
  raw: string;
  originalRaw: string;
  valid: boolean | null;
  issues: unknown[];
  loading: boolean;
  saving: boolean;
  applying: boolean;
  updating: boolean;
  connected: boolean;
  schema: unknown;
  schemaLoading: boolean;
  uiHints: ConfigUiHints;
  formMode: "form" | "raw";
  rawAvailable?: boolean;
  showModeToggle?: boolean;
  formValue: Record<string, unknown> | null;
  originalValue: Record<string, unknown> | null;
  searchQuery: string;
  activeSection: string | null;
  activeSubsection: string | null;
  onRawChange: (next: string) => void;
  onFormModeChange: (mode: "form" | "raw") => void;
  onFormPatch: (path: Array<string | number>, value: unknown) => void;
  onSearchChange: (query: string) => void;
  onSectionChange: (section: string | null) => void;
  onSubsectionChange: (section: string | null) => void;
  onReload: () => void;
  onSave: () => void;
  onApply: () => void;
  onUpdate: () => void;
  onOpenFile?: () => void;
  version: string;
  theme: ThemeName;
  themeMode: ThemeMode;
  themeOrder: ThemeName[];
  setTheme: (theme: ThemeName, context?: ThemeTransitionContext) => void;
  setThemeMode: (mode: ThemeMode, context?: ThemeTransitionContext) => void;
  gatewayUrl: string;
  assistantName: string;
  configPath?: string | null;
  navRootLabel?: string;
  includeSections?: string[];
  excludeSections?: string[];
  includeVirtualSections?: boolean;
  onRequestUpdate?: () => void;
  onProvidersChanged?: () => void;
  client?: import("../gateway.ts").GatewayBrowserClient;
  fullModelCatalog?: import("../types.ts").ModelCatalogEntry[];
  configuredProviders?: string[];
  providerAuthOptions?: import("../types.ts").ProviderAuthInfo[];
};

type AccordionGroup = {
  id: string;
  label: string;
  sections: string[];
};

const ACCORDION_GROUPS: AccordionGroup[] = [
  {
    id: "model-ai",
    label: "settings.groups.modelAi",
    sections: ["agents", "models", "skills", "tools", "memory", "session"],
  },
  {
    id: "channel",
    label: "settings.groups.channel",
    sections: ["channels", "messages", "broadcast", "talk", "audio"],
  },
  {
    id: "cognitive",
    label: "settings.groups.cognitive",
    sections: ["cognitive"],
  },
  {
    id: "system",
    label: "settings.groups.system",
    sections: [
      "env",
      "auth",
      "gateway",
      "web",
      "logging",
      "diagnostics",
      "plugins",
      "commands",
      "hooks",
      "bindings",
      "cron",
      "approvals",
      "secrets",
      "cli",
      "meta",
      "update",
      "nodeHost",
      "canvasHost",
      "discovery",
      "media",
      "acp",
      "mcp",
      "browser",
    ],
  },
];

const GROUPED_KEYS = new Set(ACCORDION_GROUPS.flatMap((g) => g.sections));

function scopeSchemaSections(
  schema: JsonSchema | null,
  params: { include?: ReadonlySet<string> | null; exclude?: ReadonlySet<string> | null },
): JsonSchema | null {
  if (!schema || schemaType(schema) !== "object" || !schema.properties) {
    return schema;
  }
  const include = params.include;
  const exclude = params.exclude;
  const nextProps: Record<string, JsonSchema> = {};
  for (const [key, value] of Object.entries(schema.properties)) {
    if (include && include.size > 0 && !include.has(key)) {
      continue;
    }
    if (exclude && exclude.size > 0 && exclude.has(key)) {
      continue;
    }
    nextProps[key] = value;
  }
  return { ...schema, properties: nextProps };
}

function scopeUnsupportedPaths(
  unsupportedPaths: string[],
  params: { include?: ReadonlySet<string> | null; exclude?: ReadonlySet<string> | null },
): string[] {
  const include = params.include;
  const exclude = params.exclude;
  if ((!include || include.size === 0) && (!exclude || exclude.size === 0)) {
    return unsupportedPaths;
  }
  return unsupportedPaths.filter((entry) => {
    if (entry === "<root>") {
      return true;
    }
    const [top] = entry.split(".");
    if (include && include.size > 0) {
      return include.has(top);
    }
    if (exclude && exclude.size > 0) {
      return !exclude.has(top);
    }
    return true;
  });
}

function resolveSectionMeta(
  key: string,
  schema?: JsonSchema,
): { label: string; description?: string } {
  const meta = SECTION_META[key];
  if (meta) {
    return meta;
  }
  return {
    label: schema?.title ?? humanize(key),
    description: schema?.description ?? "",
  };
}

function computeDiff(
  original: Record<string, unknown> | null,
  current: Record<string, unknown> | null,
): Array<{ path: string; from: unknown; to: unknown }> {
  if (!original || !current) {
    return [];
  }
  const changes: Array<{ path: string; from: unknown; to: unknown }> = [];

  function compare(orig: unknown, curr: unknown, path: string) {
    if (orig === curr) {
      return;
    }
    if (typeof orig !== typeof curr) {
      changes.push({ path, from: orig, to: curr });
      return;
    }
    if (typeof orig !== "object" || orig === null || curr === null) {
      if (orig !== curr) {
        changes.push({ path, from: orig, to: curr });
      }
      return;
    }
    if (Array.isArray(orig) && Array.isArray(curr)) {
      if (JSON.stringify(orig) !== JSON.stringify(curr)) {
        changes.push({ path, from: orig, to: curr });
      }
      return;
    }
    const origObj = orig as Record<string, unknown>;
    const currObj = curr as Record<string, unknown>;
    const allKeys = new Set([...Object.keys(origObj), ...Object.keys(currObj)]);
    for (const key of allKeys) {
      compare(origObj[key], currObj[key], path ? `${path}.${key}` : key);
    }
  }

  compare(original, current, "");
  return changes;
}

function getSchemaNodeAtPath(schema: JsonSchema, path: readonly string[]): JsonSchema | null {
  let node: JsonSchema = schema;
  for (const segment of path) {
    if (!node.properties || !(segment in node.properties)) {
      return null;
    }
    node = node.properties[segment] as JsonSchema;
  }
  return node;
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

function renderStatusToggleRow(params: {
  label: string;
  enabled: boolean;
  disabled: boolean;
  path: Array<string | number>;
  onPatch: (path: Array<string | number>, value: unknown) => void;
  extraOnChange?: (enabled: boolean) => void;
}): TemplateResult {
  const { label, enabled, disabled, path, onPatch, extraOnChange } = params;
  return html`
    <label class="cfg-toggle-row ${disabled ? "disabled" : ""}">
      <div class="cfg-toggle-row__content">
        <span class="cfg-toggle-row__label">${label}已${enabled ? "开启" : "关闭"}</span>
      </div>
      <div class="cfg-toggle">
        <input
          type="checkbox"
          .checked=${enabled}
          ?disabled=${disabled}
          @change=${(e: Event) => {
            const v = (e.target as HTMLInputElement).checked;
            onPatch(path, v);
            extraOnChange?.(v);
          }}
        />
        <span class="cfg-toggle__track"></span>
      </div>
    </label>
  `;
}

function renderQuickSettings(props: ConfigProps) {
  if (!props.formValue || !props.schema) {
    return nothing;
  }

  const rootSchema = props.schema as JsonSchema;
  if (schemaType(rootSchema) !== "object" || !rootSchema.properties) {
    return nothing;
  }

  const items: TemplateResult[] = [];

  for (const entry of QUICK_SETTINGS) {
    // Custom renderer takes priority
    if (entry.render) {
      items.push(html`
        <div class="config-quick-settings__item">
          <div class="config-quick-settings__item-label">${entry.label}</div>
          ${entry.description
            ? html`<div class="config-quick-settings__item-desc">${entry.description}</div>`
            : nothing}
          <div class="config-quick-settings__item-control">${entry.render(props)}</div>
        </div>
      `);
      continue;
    }

    const nodeSchema = getSchemaNodeAtPath(rootSchema, entry.path);
    if (!nodeSchema) {
      continue;
    }

    const value = getValueAtPath(props.formValue, entry.path);

    if (schemaType(nodeSchema) === "boolean") {
      const enabled = value === true || (value === undefined && nodeSchema.default === true);
      const control = renderStatusToggleRow({
        label: entry.label,
        enabled,
        disabled: props.loading,
        path: entry.path,
        onPatch: props.onFormPatch,
      });
      items.push(html`
        <div class="config-quick-settings__item">
          <div class="config-quick-settings__item-label">${entry.label}</div>
          ${entry.description
            ? html`<div class="config-quick-settings__item-desc">${entry.description}</div>`
            : nothing}
          <div class="config-quick-settings__item-control">${control}</div>
        </div>
      `);
      continue;
    }

    const control = renderNode({
      schema: nodeSchema,
      value,
      path: entry.path,
      hints: props.uiHints,
      unsupported: new Set(),
      disabled: props.loading,
      showLabel: false,
      onPatch: props.onFormPatch,
    });

    items.push(html`
      <div class="config-quick-settings__item">
        <div class="config-quick-settings__item-label">${entry.label}</div>
        ${entry.description
          ? html`<div class="config-quick-settings__item-desc">${entry.description}</div>`
          : nothing}
        <div class="config-quick-settings__item-control">${control}</div>
      </div>
    `);
  }

  if (items.length === 0) {
    return nothing;
  }

  return html`
    <div class="config-quick-settings">
      <div class="config-quick-settings__title">${t("config.quickSettings")}</div>
      <div class="config-quick-settings__grid">${items}</div>
    </div>
  `;
}

function renderConnectionSection(props: ConfigProps) {
  return html`
    <div class="settings-appearance">
      <div class="settings-appearance__section">
        <h3 class="settings-appearance__heading">${t("settings.connection.title")}</h3>
        <div class="settings-info-grid">
          <div class="settings-info-row">
            <span class="settings-info-row__label">${t("settings.connection.gateway")}</span>
            <span class="settings-info-row__value mono">${props.gatewayUrl || "-"}</span>
          </div>
          <div class="settings-info-row">
            <span class="settings-info-row__label">${t("settings.connection.status")}</span>
            <span class="settings-info-row__value">
              <span
                class="settings-status-dot ${props.connected ? "settings-status-dot--ok" : ""}"
              ></span>
              ${props.connected ? t("common.connected") : t("common.offline")}
            </span>
          </div>
          ${props.assistantName
            ? html`
                <div class="settings-info-row">
                  <span class="settings-info-row__label"
                    >${t("settings.connection.assistant")}</span
                  >
                  <span class="settings-info-row__value">${props.assistantName}</span>
                </div>
              `
            : nothing}
        </div>
      </div>
    </div>
  `;
}

const THEME_SWATCH_COLORS: Record<ThemeName, { bg: string; accent: string }> = {
  "ink-jade": { bg: "#0e1219", accent: "#00d4aa" },
  "rice-paper": { bg: "#f5f2ed", accent: "#00b893" },
  glaze: { bg: "#0a0c16", accent: "#a78bfa" },
};

const MODE_OPTIONS: { id: ThemeMode; label: string }[] = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

function renderAppearanceSection(props: ConfigProps) {
  const modeIcon = (mode: ThemeMode) => {
    if (mode === "system") {
      return icons.monitor;
    }
    if (mode === "light") {
      return icons.sun;
    }
    return icons.moon;
  };

  return html`
    <div class="settings-appearance">
      <div class="settings-appearance__section">
        <h3 class="settings-appearance__heading">${t("settings.appearance.theme")}</h3>
        <div class="appearance-theme-swatches">
          ${(props.themeOrder ?? ["ink-jade", "rice-paper", "glaze"]).map((name) => {
            const swatch = THEME_SWATCH_COLORS[name];
            return html`
              <button
                type="button"
                class="appearance-theme-swatch ${name === props.theme
                  ? "appearance-theme-swatch--active"
                  : ""}"
                title=${themeDisplayName(name)}
                @click=${(e: Event) =>
                  props.setTheme(name, { element: e.currentTarget as HTMLElement })}
              >
                <span
                  class="appearance-theme-swatch__preview"
                  style="background:${swatch.bg};border-color:${swatch.accent}40"
                >
                  <span
                    class="appearance-theme-swatch__dot"
                    style="background:${swatch.accent}"
                  ></span>
                </span>
                <span class="appearance-theme-swatch__label">${themeDisplayName(name)}</span>
              </button>
            `;
          })}
        </div>
      </div>
      <div class="settings-appearance__section">
        <h3 class="settings-appearance__heading">${t("settings.appearance.mode")}</h3>
        <div class="appearance-mode-toggle" role="group" aria-label="Color mode">
          ${MODE_OPTIONS.map(
            (opt) => html`
              <button
                type="button"
                class="appearance-mode-btn ${opt.id === props.themeMode
                  ? "appearance-mode-btn--active"
                  : ""}"
                title=${opt.label}
                aria-label="Color mode: ${opt.label}"
                aria-pressed=${opt.id === props.themeMode}
                @click=${(e: Event) =>
                  props.setThemeMode(opt.id, { element: e.currentTarget as HTMLElement })}
              >
                ${modeIcon(opt.id)}
                <span class="appearance-mode-btn__label">${opt.label}</span>
              </button>
            `,
          )}
        </div>
      </div>
    </div>
  `;
}

function renderModelSection(props: ConfigProps) {
  if (!MODEL_ENTRY.render) {
    return nothing;
  }
  return html`
    <div class="settings-appearance">
      <div class="settings-appearance__section">
        <h3 class="settings-appearance__heading">${MODEL_ENTRY.label}</h3>
        ${MODEL_ENTRY.description
          ? html`<p class="settings-appearance__hint">${MODEL_ENTRY.description}</p>`
          : nothing}
        ${MODEL_ENTRY.render(props)}
      </div>
    </div>
  `;
}

interface ConfigEphemeralState {
  rawRevealed: boolean;
  envRevealed: boolean;
  validityDismissed: boolean;
  revealedSensitivePaths: Set<string>;
}

function createConfigEphemeralState(): ConfigEphemeralState {
  return {
    rawRevealed: false,
    envRevealed: false,
    validityDismissed: false,
    revealedSensitivePaths: new Set(),
  };
}

const cvs = createConfigEphemeralState();

export function resetConfigViewStateForTests() {
  Object.assign(cvs, createConfigEphemeralState());
}

export function renderConfig(props: ConfigProps) {
  const validity = props.valid == null ? "unknown" : props.valid ? "valid" : "invalid";
  const includeVirtualSections = props.includeVirtualSections ?? true;
  const include = props.includeSections?.length ? new Set(props.includeSections) : null;
  const exclude = props.excludeSections?.length ? new Set(props.excludeSections) : null;
  const rawAnalysis = analyzeConfigSchema(props.schema);
  const analysis = {
    schema: scopeSchemaSections(rawAnalysis.schema, { include, exclude }),
    unsupportedPaths: scopeUnsupportedPaths(rawAnalysis.unsupportedPaths, { include, exclude }),
  };
  const requestUpdate = props.onRequestUpdate ?? (() => props.onRawChange(props.raw));

  const schemaProps = analysis.schema?.properties ?? {};

  const diff = computeDiff(props.originalValue, props.formValue);
  const hasChanges = diff.length > 0;

  const canSaveForm = Boolean(props.formValue) && !props.loading && Boolean(analysis.schema);
  const canSave = props.connected && !props.saving && hasChanges && canSaveForm;
  const canApply =
    props.connected && !props.applying && !props.updating && hasChanges && canSaveForm;
  const canUpdate = props.connected && !props.applying && !props.updating;

  const visibleGroups: Array<{
    id: string;
    label: string;
    sections: Array<{ key: string; label: string }>;
  }> = [];

  for (const group of ACCORDION_GROUPS) {
    const matching = group.sections.filter((key) => key in schemaProps);
    if (matching.length > 0) {
      visibleGroups.push({
        id: group.id,
        label: group.label,
        sections: matching.map((key) => {
          const meta = resolveSectionMeta(key, schemaProps[key] as JsonSchema | undefined);
          return { key, label: meta.label };
        }),
      });
    }
  }

  const extraKeys = Object.keys(schemaProps).filter((k) => !GROUPED_KEYS.has(k));
  if (extraKeys.length > 0) {
    visibleGroups.push({
      id: "other",
      label: t("settings.groups.other"),
      sections: extraKeys.map((k) => {
        const meta = resolveSectionMeta(k, schemaProps[k] as JsonSchema | undefined);
        return { key: k, label: meta.label };
      }),
    });
  }

  return html`
    <div class="config-layout">
      <main class="config-main">
        <!-- Top bar -->
        <div class="config-actions">
          <div class="config-actions__left">
            ${hasChanges
              ? html`
                  <span class="config-changes-badge"
                    >${diff.length}
                    ${t("settings.unsavedChange")}${diff.length !== 1 ? "s" : ""}</span
                  >
                `
              : html`<span class="config-status muted">${t("settings.noChanges")}</span>`}
          </div>
          <div class="config-actions__right">
            <button class="btn btn--sm" ?disabled=${props.loading} @click=${props.onReload}>
              ${props.loading ? t("common.loading") : t("common.reload")}
            </button>
            <button class="btn btn--sm primary" ?disabled=${!canSave} @click=${props.onSave}>
              ${props.saving ? t("settings.saving") : t("settings.save")}
            </button>
            <button class="btn btn--sm" ?disabled=${!canApply} @click=${props.onApply}>
              ${props.applying ? t("settings.applying") : t("settings.apply")}
            </button>
            <button class="btn btn--sm" ?disabled=${!canUpdate} @click=${props.onUpdate}>
              ${props.updating ? t("settings.updating") : t("settings.update")}
            </button>
          </div>
        </div>

        <!-- Validity warning -->
        ${validity === "invalid" && !cvs.validityDismissed
          ? html`
              <div class="config-validity-warning">
                <svg
                  class="config-validity-warning__icon"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  width="16"
                  height="16"
                >
                  <path
                    d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
                  ></path>
                  <line x1="12" y1="9" x2="12" y2="13"></line>
                  <line x1="12" y1="17" x2="12.01" y2="17"></line>
                </svg>
                <span class="config-validity-warning__text">${t("settings.invalidConfig")}</span>
                <button
                  class="btn btn--sm"
                  @click=${() => {
                    cvs.validityDismissed = true;
                    requestUpdate();
                  }}
                >
                  ${t("settings.dontRemindAgain")}
                </button>
              </div>
            `
          : nothing}

        <!-- Unified scroll area for all content -->
        <div class="config-scroll-area">
          ${includeVirtualSections ? renderConnectionSection(props) : nothing}
          ${includeVirtualSections ? renderAppearanceSection(props) : nothing}
          ${includeVirtualSections ? renderModelSection(props) : nothing}
          ${renderQuickSettings(props)}
        </div>

        ${props.issues.length > 0
          ? html`<div class="callout danger" style="margin-top: 12px;">
              <pre class="code-block">${JSON.stringify(props.issues, null, 2)}</pre>
            </div>`
          : nothing}
      </main>
    </div>
  `;
}
