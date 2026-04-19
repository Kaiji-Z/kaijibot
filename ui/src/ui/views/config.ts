import { html, nothing, type TemplateResult } from "lit";
import { t } from "../../i18n/index.ts";
import { icons } from "../icons.ts";
import { BORDER_RADIUS_STOPS, type BorderRadiusStop } from "../storage.ts";
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

const BORDER_RADIUS_LABELS: Record<BorderRadiusStop, string> = {
  0: "None",
  25: "Slight",
  50: "Default",
  75: "Round",
  100: "Full",
};

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
    label: "Model & AI",
    sections: ["agents", "models", "skills", "tools", "memory", "session"],
  },
  {
    id: "channel",
    label: "Channel",
    sections: ["channels", "messages", "broadcast", "talk", "audio"],
  },
  {
    id: "cognitive",
    label: "Cognitive",
    sections: ["cognitive"],
  },
  {
    id: "system",
    label: "System",
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


type ThemeOption = { id: ThemeName; label: string; description: string; icon: TemplateResult };
const THEME_OPTIONS: ThemeOption[] = [
  { id: "claw", label: "Claw", description: "Chroma family", icon: icons.zap },
  { id: "knot", label: "Knot", description: "Black & red", icon: icons.link },
  { id: "dash", label: "Dash", description: "Chocolate blueprint", icon: icons.barChart },
];

function renderAppearanceSection(props: ConfigProps) {
  return html`
    <div class="settings-appearance">
      <div class="settings-appearance__section">
        <h3 class="settings-appearance__heading">Theme</h3>
        <p class="settings-appearance__hint">Choose a theme family.</p>
        <div class="settings-theme-grid">
          ${THEME_OPTIONS.map(
            (opt) => html`
              <button
                class="settings-theme-card ${opt.id === props.theme
                  ? "settings-theme-card--active"
                  : ""}"
                title=${opt.description}
                @click=${(e: Event) => {
                  if (opt.id !== props.theme) {
                    const context: ThemeTransitionContext = {
                      element: (e.currentTarget as HTMLElement) ?? undefined,
                    };
                    props.setTheme(opt.id, context);
                  }
                }}
              >
                <span class="settings-theme-card__icon" aria-hidden="true">${opt.icon}</span>
                <span class="settings-theme-card__label">${opt.label}</span>
                ${opt.id === props.theme
                  ? html`<span class="settings-theme-card__check" aria-hidden="true"
                      >${icons.check}</span
                    >`
                  : nothing}
              </button>
            `,
          )}
        </div>
      </div>

      <div class="settings-appearance__section">
        <h3 class="settings-appearance__heading">Roundness</h3>
        <p class="settings-appearance__hint">Adjust corner radius across the UI.</p>
        <div class="settings-roundness">
          <div class="settings-roundness__options">
            ${BORDER_RADIUS_STOPS.map(
              (stop) => html`
                <button
                  type="button"
                  class="settings-roundness__btn ${stop === props.borderRadius ? "active" : ""}"
                  @click=${() => props.setBorderRadius(stop)}
                >
                  <span
                    class="settings-roundness__swatch"
                    style="border-radius: ${Math.round(10 * (stop / 50))}px"
                  ></span>
                  <span class="settings-roundness__label">${BORDER_RADIUS_LABELS[stop]}</span>
                </button>
              `,
            )}
          </div>
        </div>
      </div>

      <div class="settings-appearance__section">
        <h3 class="settings-appearance__heading">Connection</h3>
        <div class="settings-info-grid">
          <div class="settings-info-row">
            <span class="settings-info-row__label">Gateway</span>
            <span class="settings-info-row__value mono">${props.gatewayUrl || "-"}</span>
          </div>
          <div class="settings-info-row">
            <span class="settings-info-row__label">Status</span>
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
                  <span class="settings-info-row__label">Assistant</span>
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
      label: "Other",
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
                    >${diff.length} unsaved change${diff.length !== 1 ? "s" : ""}</span
                  >
                `
              : html`<span class="config-status muted">No changes</span>`}
          </div>
          <div class="config-actions__right">
            <button class="btn btn--sm" ?disabled=${props.loading} @click=${props.onReload}>
              ${props.loading ? t("common.loading") : t("common.reload")}
            </button>
            <button class="btn btn--sm primary" ?disabled=${!canSave} @click=${props.onSave}>
              ${props.saving ? "Saving…" : "Save"}
            </button>
            <button class="btn btn--sm" ?disabled=${!canApply} @click=${props.onApply}>
              ${props.applying ? "Applying…" : "Apply"}
            </button>
            <button class="btn btn--sm" ?disabled=${!canUpdate} @click=${props.onUpdate}>
              ${props.updating ? "Updating…" : "Update"}
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
                  >Your configuration is invalid. Some settings may not work as expected.</span
                >
                <button
                  class="btn btn--sm"
                  @click=${() => {
                    cvs.validityDismissed = true;
                    requestUpdate();
                  }}
                >
                  Don't remind again
                </button>
              </div>
            `
          : nothing}

        <!-- Appearance section (always shown at top) -->
        ${includeVirtualSections ? renderAppearanceSection(props) : nothing}

        <!-- Accordion groups -->
        <div class="config-accordion-groups">
          ${visibleGroups.map(
            (group) => html`
              <details class="config-accordion" open>
                <summary class="config-accordion__header">
                  <span class="config-accordion__icon">${renderGroupIcon(group.id)}</span>
                  <span class="config-accordion__title">${group.label}</span>
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
                          <span>Loading schema…</span>
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
                    ← Back
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
                          title=${envSensitiveVisible ? "Hide env values" : "Reveal env values"}
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
                          Peek
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
