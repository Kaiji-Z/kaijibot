import { html, nothing, type TemplateResult } from "lit";
import { t } from "../../i18n/index.ts";
import type { ThemeTransitionContext } from "../theme-transition.ts";
import type { ThemeMode, ThemeName } from "../theme.ts";
import type { ConfigUiHints } from "../types.ts";
import {
  humanize,
  pathKey,
  schemaType,
  type JsonSchema,
} from "./config-form.shared.ts";
import { analyzeConfigSchema, renderConfigForm, SECTION_META } from "./config-form.ts";
import { renderNode } from "./config-form.node.ts";
import { QUICK_SETTINGS } from "./config-quick-fields.ts";

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
  setTheme: (theme: ThemeName, context?: ThemeTransitionContext) => void;
  setThemeMode: (mode: ThemeMode, context?: ThemeTransitionContext) => void;
  borderRadius: number;
  setBorderRadius: (value: number) => void;
  gatewayUrl: string;
  assistantName: string;
  configPath?: string | null;
  navRootLabel?: string;
  includeSections?: string[];
  excludeSections?: string[];
  includeVirtualSections?: boolean;
  onRequestUpdate?: () => void;
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


function getSchemaNodeAtPath(
  schema: JsonSchema,
  path: readonly string[],
): JsonSchema | null {
  let node: JsonSchema = schema;
  for (const segment of path) {
    if (!node.properties || !(segment in node.properties)) {
      return null;
    }
    node = node.properties[segment] as JsonSchema;
  }
  return node;
}

function getValueAtPath(
  root: Record<string, unknown>,
  path: readonly string[],
): unknown {
  let current: unknown = root;
  for (const segment of path) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
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
    const nodeSchema = getSchemaNodeAtPath(rootSchema, entry.path);
    if (!nodeSchema) {
      continue;
    }

    const value = getValueAtPath(props.formValue, entry.path);

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
      <div class="config-quick-settings__grid">
        ${items}
      </div>
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
                  <span class="settings-info-row__label">${t("settings.connection.assistant")}</span>
                  <span class="settings-info-row__value">${props.assistantName}</span>
                </div>
              `
            : nothing}
        </div>
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

function isSensitivePathRevealed(path: Array<string | number>): boolean {
  const key = pathKey(path);
  return key ? cvs.revealedSensitivePaths.has(key) : false;
}

function toggleSensitivePathReveal(path: Array<string | number>) {
  const key = pathKey(path);
  if (!key) {
    return;
  }
  if (cvs.revealedSensitivePaths.has(key)) {
    cvs.revealedSensitivePaths.delete(key);
  } else {
    cvs.revealedSensitivePaths.add(key);
  }
}

export function resetConfigViewStateForTests() {
  Object.assign(cvs, createConfigEphemeralState());
}


function renderGroupIcon(groupId: string): TemplateResult {
  switch (groupId) {
    case "model-ai":
      return html`
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path
            d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"
          ></path>
          <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
          <line x1="12" y1="22.08" x2="12" y2="12"></line>
        </svg>
      `;
    case "channel":
      return html`
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
        </svg>
      `;
    case "cognitive":
      return html`
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="12" cy="12" r="3"></circle>
          <path
            d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"
          ></path>
        </svg>
      `;
    case "system":
      return html`
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="2" y1="12" x2="22" y2="12"></line>
          <path
            d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"
          ></path>
        </svg>
      `;
    case "other":
      return html`
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="3" y="3" width="7" height="7"></rect>
          <rect x="14" y="3" width="7" height="7"></rect>
          <rect x="14" y="14" width="7" height="7"></rect>
          <rect x="3" y="14" width="7" height="7"></rect>
        </svg>
      `;
    default:
      return html`
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
          <polyline points="14 2 14 8 20 8"></polyline>
        </svg>
      `;
  }
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
  const rawAvailable = props.rawAvailable ?? true;
  const envSensitiveVisible = cvs.envRevealed;
  const requestUpdate = props.onRequestUpdate ?? (() => props.onRawChange(props.raw));

  const schemaProps = analysis.schema?.properties ?? {};

  const diff = computeDiff(props.originalValue, props.formValue);
  const hasChanges = diff.length > 0;

  const canSaveForm = Boolean(props.formValue) && !props.loading && Boolean(analysis.schema);
  const canSave = props.connected && !props.saving && hasChanges && canSaveForm;
  const canApply = props.connected && !props.applying && !props.updating && hasChanges && canSaveForm;
  const canUpdate = props.connected && !props.applying && !props.updating;

  const visibleGroups: Array<{
    id: string;
    label: string;
    sections: Array<{ key: string; label: string }>;
  }> = [];

  for (const group of ACCORDION_GROUPS) {
    const matching = group.sections.filter(
      (key) => key in schemaProps,
    );
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


  const extraKeys = Object.keys(schemaProps).filter(
    (k) => !GROUPED_KEYS.has(k),
  );
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
                    >${diff.length} ${t("settings.unsavedChange")}${diff.length !== 1 ? "s" : ""}</span
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
                <span class="config-validity-warning__text"
                  >${t("settings.invalidConfig")}</span
                >
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

        <!-- Appearance section (always shown at top) -->
        ${includeVirtualSections ? renderConnectionSection(props) : nothing}

        ${renderQuickSettings(props)}

        <div class="config-advanced-divider"><span>${t("config.advancedSettings")}</span></div>

        <!-- Accordion groups -->
        <div class="config-accordion-groups">
          ${visibleGroups.map(
            (group) => html`
              <details class="config-accordion" open>
                <summary class="config-accordion__header">
                  <span class="config-accordion__icon">${renderGroupIcon(group.id)}</span>
                  <span class="config-accordion__title">${t(group.label)}</span>
                  <span class="config-accordion__count">${group.sections.length}</span>
                  <svg
                    class="config-accordion__chevron"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                  >
                    <polyline points="6 9 12 15 18 9"></polyline>
                  </svg>
                </summary>
                <div class="config-accordion__content">
                  ${props.schemaLoading
                    ? html`
                        <div class="config-loading">
                          <div class="config-loading__spinner"></div>
                          <span>${t("settings.loadingSchema")}</span>
                        </div>
                      `
                    : group.sections.map(
                        (section) => html`
                          <div class="config-accordion-section">
                            <button
                              class="config-accordion-section__btn"
                              @click=${() => props.onSectionChange(section.key)}
                            >
                              ${section.label}
                            </button>
                          </div>
                        `,
                      )}
                </div>
              </details>
            `,
          )}
        </div>

        <!-- Active section content -->
        ${props.activeSection && props.activeSection !== "__appearance__"
          ? html`
              <div class="config-active-section">
                <div class="config-active-section__header">
                  <button
                    class="config-active-section__back"
                    @click=${() => props.onSectionChange(null)}
                  >
                    ← ${t("settings.back")}
                  </button>
                  <h2 class="config-active-section__title">
                    ${resolveSectionMeta(
                      props.activeSection,
                      schemaProps[props.activeSection] as JsonSchema | undefined,
                    ).label}
                  </h2>
                </div>
                ${props.activeSection === "env"
                  ? html`
                      <div style="margin-bottom: 8px;">
                        <button
                          class="config-env-peek-btn ${envSensitiveVisible
                            ? "config-env-peek-btn--active"
                            : ""}"
                          title=${envSensitiveVisible ? t("settings.hideEnvValues") : t("settings.revealEnvValues")}
                          @click=${() => {
                            cvs.envRevealed = !cvs.envRevealed;
                            requestUpdate();
                          }}
                        >
                          <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            width="16"
                            height="16"
                          >
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                            <circle cx="12" cy="12" r="3"></circle>
                          </svg>
                          ${t("settings.peek")}
                        </button>
                      </div>
                    `
                  : nothing}
                ${renderConfigForm({
                  schema: analysis.schema,
                  uiHints: props.uiHints,
                  value: props.formValue,
                  rawAvailable,
                  disabled: props.loading || !props.formValue,
                  unsupportedPaths: analysis.unsupportedPaths,
                  onPatch: props.onFormPatch,
                  searchQuery: props.searchQuery,
                  activeSection: props.activeSection,
                  activeSubsection: null,
                  revealSensitive: props.activeSection === "env" ? envSensitiveVisible : false,
                  isSensitivePathRevealed,
                  onToggleSensitivePath: (path) => {
                    toggleSensitivePathReveal(path);
                    requestUpdate();
                  },
                })}
              </div>
            `
          : nothing}

        ${props.issues.length > 0
          ? html`<div class="callout danger" style="margin-top: 12px;">
              <pre class="code-block">${JSON.stringify(props.issues, null, 2)}</pre>
            </div>`
          : nothing}
      </main>
    </div>
  `;
}
