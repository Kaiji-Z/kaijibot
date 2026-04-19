import { html, nothing } from "lit";
import { ifDefined } from "lit/directives/if-defined.js";
import { t } from "../../i18n/index.ts";
import type {
  CronFieldErrors,
  CronFieldKey,
  CronJobsLastStatusFilter,
  CronJobsScheduleKindFilter,
} from "../controllers/cron.ts";
import { formatRelativeTimestamp } from "../format.ts";
import { pathForTab } from "../navigation.ts";
import { formatCronSchedule, formatNextRun } from "../presenter.ts";
import type { ChannelUiMetaEntry, CronJob, CronRunLogEntry, CronStatus } from "../types.ts";
import type {
  CronDeliveryStatus,
  CronJobsEnabledFilter,
  CronRunScope,
  CronRunsStatusValue,
  CronJobsSortBy,
  CronRunsStatusFilter,
  CronSortDir,
} from "../types.ts";
import type { CronFormState } from "../ui-types.ts";

export type CronProps = {
  basePath: string;
  loading: boolean;
  jobsLoadingMore: boolean;
  status: CronStatus | null;
  jobs: CronJob[];
  jobsTotal: number;
  jobsHasMore: boolean;
  jobsQuery: string;
  jobsEnabledFilter: CronJobsEnabledFilter;
  jobsScheduleKindFilter: CronJobsScheduleKindFilter;
  jobsLastStatusFilter: CronJobsLastStatusFilter;
  jobsSortBy: CronJobsSortBy;
  jobsSortDir: CronSortDir;
  error: string | null;
  busy: boolean;
  form: CronFormState;
  fieldErrors: CronFieldErrors;
  canSubmit: boolean;
  editingJobId: string | null;
  channels: string[];
  channelLabels?: Record<string, string>;
  channelMeta?: ChannelUiMetaEntry[];
  runsJobId: string | null;
  runs: CronRunLogEntry[];
  runsTotal: number;
  runsHasMore: boolean;
  runsLoadingMore: boolean;
  runsScope: CronRunScope;
  runsStatuses: CronRunsStatusValue[];
  runsDeliveryStatuses: CronDeliveryStatus[];
  runsStatusFilter: CronRunsStatusFilter;
  runsQuery: string;
  runsSortDir: CronSortDir;
  agentSuggestions: string[];
  modelSuggestions: string[];
  thinkingSuggestions: string[];
  timezoneSuggestions: string[];
  deliveryToSuggestions: string[];
  accountSuggestions: string[];
  onFormChange: (patch: Partial<CronFormState>) => void;
  formOpenForNew: boolean;
  onSetFormOpenForNew: (open: boolean) => void;
  onRefresh: () => void;
  onAdd: () => void;
  onEdit: (job: CronJob) => void;
  onClone: (job: CronJob) => void;
  onCancelEdit: () => void;
  onToggle: (job: CronJob, enabled: boolean) => void;
  onRun: (job: CronJob, mode?: "force" | "due") => void;
  onRemove: (job: CronJob) => void;
  onLoadRuns: (jobId: string) => void;
  onLoadMoreJobs: () => void;
  onJobsFiltersChange: (patch: {
    cronJobsQuery?: string;
    cronJobsEnabledFilter?: CronJobsEnabledFilter;
    cronJobsScheduleKindFilter?: CronJobsScheduleKindFilter;
    cronJobsLastStatusFilter?: CronJobsLastStatusFilter;
    cronJobsSortBy?: CronJobsSortBy;
    cronJobsSortDir?: CronSortDir;
  }) => void | Promise<void>;
  onJobsFiltersReset: () => void | Promise<void>;
  onLoadMoreRuns: () => void;
  onRunsFiltersChange: (patch: {
    cronRunsScope?: CronRunScope;
    cronRunsStatuses?: CronRunsStatusValue[];
    cronRunsDeliveryStatuses?: CronDeliveryStatus[];
    cronRunsStatusFilter?: CronRunsStatusFilter;
    cronRunsQuery?: string;
    cronRunsSortDir?: CronSortDir;
  }) => void | Promise<void>;
  onNavigateToChat?: (sessionKey: string) => void;
};

// ── Form helpers (kept for job creation/editing) ──

function buildChannelOptions(props: CronProps): string[] {
  const options = ["last", ...props.channels.filter(Boolean)];
  const current = props.form.deliveryChannel?.trim();
  if (current && !options.includes(current)) {
    options.push(current);
  }
  const seen = new Set<string>();
  return options.filter((value) => {
    if (seen.has(value)) {
      return false;
    }
    seen.add(value);
    return true;
  });
}

function resolveChannelLabel(props: CronProps, channel: string): string {
  if (channel === "last") {
    return "last";
  }
  const meta = props.channelMeta?.find((entry) => entry.id === channel);
  if (meta?.label) {
    return meta.label;
  }
  return props.channelLabels?.[channel] ?? channel;
}

function renderSuggestionList(id: string, options: string[]) {
  const clean = Array.from(new Set(options.map((option) => option.trim()).filter(Boolean)));
  if (clean.length === 0) {
    return nothing;
  }
  return html`<datalist id=${id}>
    ${clean.map((value) => html`<option value=${value}></option> `)}
  </datalist>`;
}

type BlockingField = {
  key: CronFieldKey;
  label: string;
  message: string;
  inputId: string;
};

function errorIdForField(key: CronFieldKey) {
  return `cron-error-${key}`;
}

function inputIdForField(key: CronFieldKey) {
  if (key === "name") { return "cron-name"; }
  if (key === "scheduleAt") { return "cron-schedule-at"; }
  if (key === "everyAmount") { return "cron-every-amount"; }
  if (key === "cronExpr") { return "cron-cron-expr"; }
  if (key === "staggerAmount") { return "cron-stagger-amount"; }
  if (key === "payloadText") { return "cron-payload-text"; }
  if (key === "payloadModel") { return "cron-payload-model"; }
  if (key === "payloadThinking") { return "cron-payload-thinking"; }
  if (key === "timeoutSeconds") { return "cron-timeout-seconds"; }
  if (key === "failureAlertAfter") { return "cron-failure-alert-after"; }
  if (key === "failureAlertCooldownSeconds") { return "cron-failure-alert-cooldown-seconds"; }
  return "cron-delivery-to";
}

function fieldLabelForKey(
  key: CronFieldKey,
  form: CronFormState,
  deliveryMode: CronFormState["deliveryMode"],
) {
  if (key === "payloadText") {
    return form.payloadKind === "systemEvent"
      ? t("cron.form.mainTimelineMessage")
      : t("cron.form.assistantTaskPrompt");
  }
  if (key === "deliveryTo") {
    return deliveryMode === "webhook" ? t("cron.form.webhookUrl") : t("cron.form.to");
  }
  const labels: Record<CronFieldKey, string> = {
    name: t("cron.form.fieldName"),
    scheduleAt: t("cron.form.runAt"),
    everyAmount: t("cron.form.every"),
    cronExpr: t("cron.form.expression"),
    staggerAmount: t("cron.form.staggerWindow"),
    payloadText: t("cron.form.assistantTaskPrompt"),
    payloadModel: t("cron.form.model"),
    payloadThinking: t("cron.form.thinking"),
    timeoutSeconds: t("cron.form.timeoutSeconds"),
    deliveryTo: t("cron.form.to"),
    failureAlertAfter: "Failure alert after",
    failureAlertCooldownSeconds: "Failure alert cooldown",
  };
  return labels[key];
}

function collectBlockingFields(
  errors: CronFieldErrors,
  form: CronFormState,
  deliveryMode: CronFormState["deliveryMode"],
): BlockingField[] {
  const orderedKeys: CronFieldKey[] = [
    "name",
    "scheduleAt",
    "everyAmount",
    "cronExpr",
    "staggerAmount",
    "payloadText",
    "payloadModel",
    "payloadThinking",
    "timeoutSeconds",
    "deliveryTo",
    "failureAlertAfter",
    "failureAlertCooldownSeconds",
  ];
  const fields: BlockingField[] = [];
  for (const key of orderedKeys) {
    const message = errors[key];
    if (!message) { continue; }
    fields.push({
      key,
      label: fieldLabelForKey(key, form, deliveryMode),
      message,
      inputId: inputIdForField(key),
    });
  }
  return fields;
}

function focusFormField(id: string) {
  const el = document.getElementById(id);
  if (!(el instanceof HTMLElement)) { return; }
  el.scrollIntoView?.({ block: "center", behavior: "smooth" });
  el.focus();
}

function renderFieldLabel(text: string, required = false) {
  return html`<span>
    ${text}
    ${required
      ? html`
          <span class="cron-required-marker" aria-hidden="true">*</span>
          <span class="cron-required-sr">${t("cron.form.requiredSr")}</span>
        `
      : nothing}
  </span>`;
}

export function renderCron(props: CronProps) {
  const isEditing = Boolean(props.editingJobId);
  const showFormOverlay = isEditing || props.formOpenForNew;
  const isAgentTurn = props.form.payloadKind === "agentTurn";
  const isCronSchedule = props.form.scheduleKind === "cron";
  const channelOptions = buildChannelOptions(props);
  const supportsAnnounce =
    props.form.sessionTarget !== "main" && props.form.payloadKind === "agentTurn";
  const selectedDeliveryMode =
    props.form.deliveryMode === "announce" && !supportsAnnounce ? "none" : props.form.deliveryMode;
  const blockingFields = collectBlockingFields(props.fieldErrors, props.form, selectedDeliveryMode);
  const blockedByValidation = !props.busy && blockingFields.length > 0;
  const submitDisabledReason =
    blockedByValidation && !props.canSubmit
      ? blockingFields.length === 1
        ? t("cron.form.fixFields", { count: String(blockingFields.length) })
        : t("cron.form.fixFieldsPlural", { count: String(blockingFields.length) })
      : "";

  const expandedRuns = props.runsJobId
    ? props.runs
        .filter((r) => r.jobId === props.runsJobId)
        .toSorted((a, b) => b.ts - a.ts)
        .slice(0, 5)
    : [];

  return html`
    <section class="cron-simple">
      <section class="card cron-summary-strip">
        <div class="cron-summary-strip__left">
          <div class="cron-summary-item">
            <div class="cron-summary-label">${t("cron.summary.enabled")}</div>
            <div class="cron-summary-value">
              <span class=${`chip ${props.status?.enabled ? "chip-ok" : "chip-danger"}`}>
                ${props.status
                  ? props.status.enabled
                    ? t("cron.summary.yes")
                    : t("cron.summary.no")
                  : t("common.na")}
              </span>
            </div>
          </div>
          <div class="cron-summary-item">
            <div class="cron-summary-label">${t("cron.summary.jobs")}</div>
            <div class="cron-summary-value">${props.status?.jobs ?? t("common.na")}</div>
          </div>
          <div class="cron-summary-item cron-summary-item--wide">
            <div class="cron-summary-label">${t("cron.summary.nextWake")}</div>
            <div class="cron-summary-value">${formatNextRun(props.status?.nextWakeAtMs ?? null)}</div>
          </div>
        </div>
        <div class="cron-summary-strip__actions">
          <button
            class=${props.loading ? "btn cron-refresh-btn--loading" : "btn"}
            ?disabled=${props.loading}
            @click=${props.onRefresh}
          >
            ${props.loading ? t("cron.summary.refreshing") : t("cron.summary.refresh")}
          </button>
          ${props.error ? html`<span class="muted">${props.error}</span>` : nothing}
        </div>
      </section>

      <section class="cron-filter-bar">
        ${renderFilterPill(props, "all", t("cron.jobs.all"), true)}
        ${renderFilterPill(props, "enabled", t("cron.jobs.enabled"), props.jobsEnabledFilter === "enabled")}
        ${renderFilterPill(props, "disabled", t("common.disabled"), props.jobsEnabledFilter === "disabled")}
      </section>

      <section class="cron-job-list">
        ${props.jobs.length === 0
          ? html`<div class="muted" style="padding:24px;text-align:center;">${t("cron.jobs.noMatching")}</div>`
          : props.jobs.map((job) => renderJobCard(job, props, expandedRuns))}
      </section>

      ${props.jobsHasMore
        ? html`
            <div class="row" style="justify-content:center;padding:8px;">
              <button
                class="btn"
                ?disabled=${props.loading || props.jobsLoadingMore}
                @click=${props.onLoadMoreJobs}
              >
                ${props.jobsLoadingMore ? t("cron.jobs.loading") : t("cron.jobs.loadMore")}
              </button>
            </div>
          `
        : nothing}

      ${!showFormOverlay
        ? html`
            <button
              class="cron-fab"
              type="button"
              title=${t("cron.form.addJob")}
              aria-label=${t("cron.form.addJob")}
              ?disabled=${props.busy}
              @click=${() => {
                props.onSetFormOpenForNew(true);
              }}
            >
              +
            </button>
          `
        : nothing}

      ${showFormOverlay
        ? html`
            <div
              class="cron-form-overlay"
              @click=${(e: Event) => {
                if (e.target === e.currentTarget) {
                  props.onSetFormOpenForNew(false);
                  if (props.editingJobId) { props.onCancelEdit(); }
                }
              }}
            >
              <div class="cron-form-overlay__panel">
                <div class="cron-form-overlay__header">
                  <button class="btn btn--ghost" @click=${() => {
                    props.onSetFormOpenForNew(false);
                    if (props.editingJobId) { props.onCancelEdit(); }
                  }}>
                    ← ${t("cron.form.cancel")}
                  </button>
                  <span class="cron-form-overlay__title">
                    ${props.editingJobId ? t("cron.form.editJob") : t("cron.form.newJob")}
                  </span>
                  <span></span>
                </div>
                <div class="cron-form-overlay__body">
                  ${renderFormContent(
                    props,
                    isEditing,
                    isAgentTurn,
                    isCronSchedule,
                    channelOptions,
                    selectedDeliveryMode,
                    supportsAnnounce,
                    blockingFields,
                    blockedByValidation,
                    submitDisabledReason,
                  )}
                </div>
              </div>
            </div>
          `
        : nothing}
    </section>

    ${renderSuggestionList("cron-agent-suggestions", props.agentSuggestions)}
    ${renderSuggestionList("cron-model-suggestions", props.modelSuggestions)}
    ${renderSuggestionList("cron-thinking-suggestions", props.thinkingSuggestions)}
    ${renderSuggestionList("cron-tz-suggestions", props.timezoneSuggestions)}
    ${renderSuggestionList("cron-delivery-to-suggestions", props.deliveryToSuggestions)}
    ${renderSuggestionList("cron-delivery-account-suggestions", props.accountSuggestions)}
  `;
}

function renderFilterPill(
  _props: CronProps,
  filterKey: string,
  label: string,
  active: boolean,
) {
  const dotClass = filterKey === "enabled"
    ? "cron-filter-pill__dot cron-filter-pill__dot--green"
    : filterKey === "disabled"
      ? "cron-filter-pill__dot cron-filter-pill__dot--gray"
      : nothing;
  return html`
    <button
      class=${`cron-filter-pill ${active ? "cron-filter-pill--active" : ""}`}
      type="button"
      @click=${() => {
        if (filterKey === "all") {
          _props.onJobsFiltersChange({ cronJobsEnabledFilter: "all" });
        } else if (filterKey === "enabled") {
          _props.onJobsFiltersChange({
            cronJobsEnabledFilter: _props.jobsEnabledFilter === "enabled" ? "all" : "enabled",
          });
        } else {
          _props.onJobsFiltersChange({
            cronJobsEnabledFilter: _props.jobsEnabledFilter === "disabled" ? "all" : "disabled",
          });
        }
      }}
    >
      ${dotClass ? html`<span class=${dotClass}></span>` : nothing}
      ${label}
    </button>
  `;
}

// ── Job card ──

function renderJobCard(
  job: CronJob,
  props: CronProps,
  expandedRuns: CronRunLogEntry[],
) {
  const isExpanded = props.runsJobId === job.id;
  const lastStatus = job.state?.lastStatus;
  const lastStatusIcon =
    lastStatus === "ok"
      ? "✓"
      : lastStatus === "error"
        ? "✗"
        : "—";
  const lastStatusClass =
    lastStatus === "ok"
      ? "cron-card__last-status--ok"
      : lastStatus === "error"
        ? "cron-card__last-status--error"
        : "cron-card__last-status--na";
  const enabledDotClass = job.enabled
    ? "cron-card__enabled-dot cron-card__enabled-dot--on"
    : "cron-card__enabled-dot cron-card__enabled-dot--off";

  const tags: string[] = [];
  if (job.agentId) { tags.push(job.agentId); }
  if (job.payload.kind === "agentTurn" && job.payload.model) { tags.push(job.payload.model); }

  return html`
    <div class="cron-card ${isExpanded ? "cron-card--expanded" : ""}">
      <div
        class="cron-card__header"
        @click=${() => {
          if (isExpanded) {
            return;
          }
          props.onLoadRuns(job.id);
        }}
      >
        <div class="cron-card__status-col">
          <span class=${enabledDotClass}></span>
          <span class=${`cron-card__last-status ${lastStatusClass}`}>${lastStatusIcon}</span>
        </div>
        <div class="cron-card__info">
          <div class="cron-card__schedule">${formatCronSchedule(job)}</div>
          <div class="cron-card__name">${job.name || job.id}</div>
          ${tags.length > 0
            ? html`<div class="cron-card__tags">
                ${tags.map((tag) => html`<span class="cron-card__tag">${tag}</span>`)}
              </div>`
            : nothing}
        </div>
        <div class="cron-card__controls">
          <label
            class="toggle-switch"
            @click=${(e: Event) => e.stopPropagation()}
          >
            <input
              type="checkbox"
              .checked=${job.enabled}
              ?disabled=${props.busy}
              @change=${() => props.onToggle(job, !job.enabled)}
            />
            <span class="toggle-switch__slider"></span>
          </label>
        </div>
      </div>

      ${isExpanded
        ? html`
            <div class="cron-card__detail">
              <div class="cron-card__meta">
                ${job.agentId
                  ? html`<span class="chip">${t("cron.jobDetail.agent")}: ${job.agentId}</span>`
                  : nothing}
                <span class="chip">${job.sessionTarget}</span>
                <span class="chip">${job.wakeMode}</span>
                ${job.state?.nextRunAtMs
                  ? html`<span class="muted">Next: ${formatStateRelative(job.state.nextRunAtMs)}</span>`
                  : nothing}
                ${job.state?.lastRunAtMs
                  ? html`<span class="muted">Last: ${formatStateRelative(job.state.lastRunAtMs)}</span>`
                  : nothing}
              </div>

              ${job.payload.kind === "systemEvent"
                ? html`<div class="cron-card__payload">
                    <span class="muted">${job.payload.text}</span>
                  </div>`
                : html`<div class="cron-card__payload">
                    <span class="muted">${job.payload.message}</span>
                  </div>`}

              ${expandedRuns.length > 0
                ? html`
                    <div class="cron-card__runs">
                      <div class="cron-card__runs-title">Recent runs</div>
                      ${expandedRuns.map(
                        (entry) => {
                          const runStatus = entry.status ?? "na";
                          return html`
                            <div class=${`cron-card__run cron-card__run--${runStatus}`}>
                              <span class="cron-card__run-time">${formatRelativeTimestamp(entry.ts)}</span>
                              <span class="cron-card__run-summary">
                                ${entry.summary ?? entry.error ?? t("cron.runEntry.noSummary")}
                                ${entry.sessionKey
                                  ? html`<a
                                      class="session-link"
                                      href="${pathForTab("chat", props.basePath)}?session=${encodeURIComponent(entry.sessionKey)}"
                                      @click=${(e: MouseEvent) => {
                                        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey) { return; }
                                        if (props.onNavigateToChat && entry.sessionKey) {
                                          e.preventDefault();
                                          props.onNavigateToChat(entry.sessionKey);
                                        }
                                      }}
                                    >${t("cron.runEntry.openRunChat")}</a>`
                                  : nothing}
                              </span>
                              <span class="cron-card__run-duration">
                                ${typeof entry.durationMs === "number" ? `${entry.durationMs}ms` : ""}
                              </span>
                            </div>
                          `;
                        },
                      )}
                    </div>
                  `
                : nothing}

              <div class="cron-card__actions">
                <button
                  class="btn btn--sm"
                  ?disabled=${props.busy}
                  @click=${() => props.onRun(job, "force")}
                >
                  ${t("cron.jobList.run")}
                </button>
                <button
                  class="btn btn--sm"
                  ?disabled=${props.busy}
                  @click=${() => props.onEdit(job)}
                >
                  ${t("cron.jobList.edit")}
                </button>
                <button
                  class="btn btn--sm"
                  ?disabled=${props.busy}
                  @click=${() => props.onClone(job)}
                >
                  ${t("cron.jobList.clone")}
                </button>
                <button
                  class="btn btn--sm danger"
                  ?disabled=${props.busy}
                  @click=${() => props.onRemove(job)}
                >
                  ${t("cron.jobList.remove")}
                </button>
              </div>
            </div>
          `
        : nothing}
    </div>
  `;
}

// ── Form content (rendered inside overlay) ──

function renderFormContent(
  props: CronProps,
  _isEditing: boolean,
  isAgentTurn: boolean,
  isCronSchedule: boolean,
  channelOptions: string[],
  selectedDeliveryMode: string,
  supportsAnnounce: boolean,
  blockingFields: BlockingField[],
  blockedByValidation: boolean,
  submitDisabledReason: string,
) {
  return html`
    <div class="cron-form">
      <div class="cron-required-legend">
        <span class="cron-required-marker" aria-hidden="true">*</span> ${t("cron.form.required")}
      </div>

      <!-- Basics -->
      <section class="cron-form-section">
        <div class="cron-form-section__title">${t("cron.form.basics")}</div>
        <div class="cron-form-section__sub">${t("cron.form.basicsSub")}</div>
        <div class="form-grid cron-form-grid">
          <label class="field">
            ${renderFieldLabel(t("cron.form.fieldName"), true)}
            <input
              id="cron-name"
              .value=${props.form.name}
              placeholder=${t("cron.form.namePlaceholder")}
              aria-invalid=${props.fieldErrors.name ? "true" : "false"}
              aria-describedby=${ifDefined(props.fieldErrors.name ? errorIdForField("name") : undefined)}
              @input=${(e: Event) => props.onFormChange({ name: (e.target as HTMLInputElement).value })}
            />
            ${renderFieldError(props.fieldErrors.name, errorIdForField("name"))}
          </label>
          <label class="field">
            <span>${t("cron.form.description")}</span>
            <input
              .value=${props.form.description}
              placeholder=${t("cron.form.descriptionPlaceholder")}
              @input=${(e: Event) => props.onFormChange({ description: (e.target as HTMLInputElement).value })}
            />
          </label>
          <label class="field">
            ${renderFieldLabel(t("cron.form.agentId"))}
            <input
              id="cron-agent-id"
              .value=${props.form.agentId}
              list="cron-agent-suggestions"
              ?disabled=${props.form.clearAgent}
              @input=${(e: Event) => props.onFormChange({ agentId: (e.target as HTMLInputElement).value })}
              placeholder=${t("cron.form.agentPlaceholder")}
            />
            <div class="cron-help">${t("cron.form.agentHelp")}</div>
          </label>
          <label class="field checkbox cron-checkbox cron-checkbox-inline">
            <input
              type="checkbox"
              .checked=${props.form.enabled}
              @change=${(e: Event) => props.onFormChange({ enabled: (e.target as HTMLInputElement).checked })}
            />
            <span class="field-checkbox__label">${t("cron.summary.enabled")}</span>
          </label>
        </div>
      </section>

      <!-- Schedule -->
      <section class="cron-form-section">
        <div class="cron-form-section__title">${t("cron.form.schedule")}</div>
        <div class="cron-form-section__sub">${t("cron.form.scheduleSub")}</div>
        <div class="form-grid cron-form-grid">
          <label class="field cron-span-2">
            ${renderFieldLabel(t("cron.form.schedule"))}
            <select
              id="cron-schedule-kind"
              .value=${props.form.scheduleKind}
              @change=${(e: Event) =>
                props.onFormChange({
                  scheduleKind: (e.target as HTMLSelectElement).value as CronFormState["scheduleKind"],
                })}
            >
              <option value="every">${t("cron.form.every")}</option>
              <option value="at">${t("cron.form.at")}</option>
              <option value="cron">${t("cron.form.cronOption")}</option>
            </select>
          </label>
        </div>
        ${renderScheduleFields(props)}
      </section>

      <!-- Execution -->
      <section class="cron-form-section">
        <div class="cron-form-section__title">${t("cron.form.execution")}</div>
        <div class="cron-form-section__sub">${t("cron.form.executionSub")}</div>
        <div class="form-grid cron-form-grid">
          <label class="field">
            ${renderFieldLabel(t("cron.form.session"))}
            <select
              id="cron-session-target"
              .value=${props.form.sessionTarget}
              @change=${(e: Event) =>
                props.onFormChange({
                  sessionTarget: (e.target as HTMLSelectElement).value as CronFormState["sessionTarget"],
                })}
            >
              <option value="main">${t("cron.form.main")}</option>
              <option value="isolated">${t("cron.form.isolated")}</option>
            </select>
            <div class="cron-help">${t("cron.form.sessionHelp")}</div>
          </label>
          <label class="field">
            ${renderFieldLabel(t("cron.form.wakeMode"))}
            <select
              id="cron-wake-mode"
              .value=${props.form.wakeMode}
              @change=${(e: Event) =>
                props.onFormChange({ wakeMode: (e.target as HTMLSelectElement).value as CronFormState["wakeMode"] })}
            >
              <option value="now">${t("cron.form.now")}</option>
              <option value="next-heartbeat">${t("cron.form.nextHeartbeat")}</option>
            </select>
            <div class="cron-help">${t("cron.form.wakeModeHelp")}</div>
          </label>
          <label class="field ${isAgentTurn ? "" : "cron-span-2"}">
            ${renderFieldLabel(t("cron.form.payloadKind"))}
            <select
              id="cron-payload-kind"
              .value=${props.form.payloadKind}
              @change=${(e: Event) =>
                props.onFormChange({
                  payloadKind: (e.target as HTMLSelectElement).value as CronFormState["payloadKind"],
                })}
            >
              <option value="systemEvent">${t("cron.form.systemEvent")}</option>
              <option value="agentTurn">${t("cron.form.agentTurn")}</option>
            </select>
            <div class="cron-help">
              ${props.form.payloadKind === "systemEvent"
                ? t("cron.form.systemEventHelp")
                : t("cron.form.agentTurnHelp")}
            </div>
          </label>
          ${isAgentTurn
            ? html`
                <label class="field">
                  ${renderFieldLabel(t("cron.form.timeoutSeconds"))}
                  <input
                    id="cron-timeout-seconds"
                    .value=${props.form.timeoutSeconds}
                    placeholder=${t("cron.form.timeoutPlaceholder")}
                    aria-invalid=${props.fieldErrors.timeoutSeconds ? "true" : "false"}
                    aria-describedby=${ifDefined(
                      props.fieldErrors.timeoutSeconds ? errorIdForField("timeoutSeconds") : undefined,
                    )}
                    @input=${(e: Event) =>
                      props.onFormChange({ timeoutSeconds: (e.target as HTMLInputElement).value })}
                  />
                  <div class="cron-help">${t("cron.form.timeoutHelp")}</div>
                  ${renderFieldError(props.fieldErrors.timeoutSeconds, errorIdForField("timeoutSeconds"))}
                </label>
              `
            : nothing}
        </div>
        <label class="field cron-span-2">
          ${renderFieldLabel(
            props.form.payloadKind === "systemEvent"
              ? t("cron.form.mainTimelineMessage")
              : t("cron.form.assistantTaskPrompt"),
            true,
          )}
          <textarea
            id="cron-payload-text"
            .value=${props.form.payloadText}
            aria-invalid=${props.fieldErrors.payloadText ? "true" : "false"}
            aria-describedby=${ifDefined(
              props.fieldErrors.payloadText ? errorIdForField("payloadText") : undefined,
            )}
            @input=${(e: Event) =>
              props.onFormChange({ payloadText: (e.target as HTMLTextAreaElement).value })}
            rows="4"
          ></textarea>
          ${renderFieldError(props.fieldErrors.payloadText, errorIdForField("payloadText"))}
        </label>
      </section>

      <!-- Delivery -->
      <section class="cron-form-section">
        <div class="cron-form-section__title">${t("cron.form.deliverySection")}</div>
        <div class="cron-form-section__sub">${t("cron.form.deliverySub")}</div>
        <div class="form-grid cron-form-grid">
          <label class="field ${selectedDeliveryMode === "none" ? "cron-span-2" : ""}">
            ${renderFieldLabel(t("cron.form.resultDelivery"))}
            <select
              id="cron-delivery-mode"
              .value=${selectedDeliveryMode}
              @change=${(e: Event) =>
                props.onFormChange({
                  deliveryMode: (e.target as HTMLSelectElement).value as CronFormState["deliveryMode"],
                })}
            >
              ${supportsAnnounce
                ? html`<option value="announce">${t("cron.form.announceDefault")}</option>`
                : nothing}
              <option value="webhook">${t("cron.form.webhookPost")}</option>
              <option value="none">${t("cron.form.noneInternal")}</option>
            </select>
            <div class="cron-help">${t("cron.form.deliveryHelp")}</div>
          </label>
          ${selectedDeliveryMode !== "none"
            ? html`
                <label class="field ${selectedDeliveryMode === "webhook" ? "cron-span-2" : ""}">
                  ${renderFieldLabel(
                    selectedDeliveryMode === "webhook" ? t("cron.form.webhookUrl") : t("cron.form.channel"),
                    selectedDeliveryMode === "webhook",
                  )}
                  ${selectedDeliveryMode === "webhook"
                    ? html`
                        <input
                          id="cron-delivery-to"
                          .value=${props.form.deliveryTo}
                          list="cron-delivery-to-suggestions"
                          aria-invalid=${props.fieldErrors.deliveryTo ? "true" : "false"}
                          aria-describedby=${ifDefined(
                            props.fieldErrors.deliveryTo ? errorIdForField("deliveryTo") : undefined,
                          )}
                          @input=${(e: Event) =>
                            props.onFormChange({ deliveryTo: (e.target as HTMLInputElement).value })}
                          placeholder=${t("cron.form.webhookPlaceholder")}
                        />
                      `
                    : html`
                        <select
                          id="cron-delivery-channel"
                          .value=${props.form.deliveryChannel || "last"}
                          @change=${(e: Event) =>
                            props.onFormChange({ deliveryChannel: (e.target as HTMLSelectElement).value })}
                        >
                          ${channelOptions.map(
                            (ch) => html`<option value=${ch}>${resolveChannelLabel(props, ch)}</option>`,
                          )}
                        </select>
                      `}
                  ${selectedDeliveryMode === "announce"
                    ? html`<div class="cron-help">${t("cron.form.channelHelp")}</div>`
                    : html`<div class="cron-help">${t("cron.form.webhookHelp")}</div>`}
                </label>
                ${selectedDeliveryMode === "announce"
                  ? html`
                      <label class="field cron-span-2">
                        ${renderFieldLabel(t("cron.form.to"))}
                        <input
                          id="cron-delivery-to"
                          .value=${props.form.deliveryTo}
                          list="cron-delivery-to-suggestions"
                          @input=${(e: Event) =>
                            props.onFormChange({ deliveryTo: (e.target as HTMLInputElement).value })}
                          placeholder=${t("cron.form.toPlaceholder")}
                        />
                        <div class="cron-help">${t("cron.form.toHelp")}</div>
                      </label>
                    `
                  : nothing}
                ${selectedDeliveryMode === "webhook"
                  ? renderFieldError(props.fieldErrors.deliveryTo, errorIdForField("deliveryTo"))
                  : nothing}
              `
            : nothing}
        </div>
      </section>

      <!-- Advanced -->
      <details class="cron-advanced">
        <summary class="cron-advanced__summary">${t("cron.form.advanced")}</summary>
        <div class="cron-help">${t("cron.form.advancedHelp")}</div>
        <div class="form-grid cron-form-grid">
          <label class="field checkbox cron-checkbox">
            <input
              type="checkbox"
              .checked=${props.form.deleteAfterRun}
              @change=${(e: Event) =>
                props.onFormChange({ deleteAfterRun: (e.target as HTMLInputElement).checked })}
            />
            <span class="field-checkbox__label">${t("cron.form.deleteAfterRun")}</span>
            <div class="cron-help">${t("cron.form.deleteAfterRunHelp")}</div>
          </label>
          <label class="field checkbox cron-checkbox">
            <input
              type="checkbox"
              .checked=${props.form.clearAgent}
              @change=${(e: Event) =>
                props.onFormChange({ clearAgent: (e.target as HTMLInputElement).checked })}
            />
            <span class="field-checkbox__label">${t("cron.form.clearAgentOverride")}</span>
            <div class="cron-help">${t("cron.form.clearAgentHelp")}</div>
          </label>
          <label class="field cron-span-2">
            ${renderFieldLabel("Session key")}
            <input
              id="cron-session-key"
              .value=${props.form.sessionKey}
              @input=${(e: Event) =>
                props.onFormChange({ sessionKey: (e.target as HTMLInputElement).value })}
              placeholder="agent:main:main"
            />
            <div class="cron-help">Optional routing key for job delivery and wake routing.</div>
          </label>
          ${isCronSchedule
            ? html`
                <label class="field checkbox cron-checkbox cron-span-2">
                  <input
                    type="checkbox"
                    .checked=${props.form.scheduleExact}
                    @change=${(e: Event) =>
                      props.onFormChange({ scheduleExact: (e.target as HTMLInputElement).checked })}
                  />
                  <span class="field-checkbox__label">${t("cron.form.exactTiming")}</span>
                  <div class="cron-help">${t("cron.form.exactTimingHelp")}</div>
                </label>
                <div class="cron-stagger-group cron-span-2">
                  <label class="field">
                    ${renderFieldLabel(t("cron.form.staggerWindow"))}
                    <input
                      id="cron-stagger-amount"
                      .value=${props.form.staggerAmount}
                      ?disabled=${props.form.scheduleExact}
                      aria-invalid=${props.fieldErrors.staggerAmount ? "true" : "false"}
                      aria-describedby=${ifDefined(
                        props.fieldErrors.staggerAmount ? errorIdForField("staggerAmount") : undefined,
                      )}
                      @input=${(e: Event) =>
                        props.onFormChange({ staggerAmount: (e.target as HTMLInputElement).value })}
                      placeholder=${t("cron.form.staggerPlaceholder")}
                    />
                    ${renderFieldError(props.fieldErrors.staggerAmount, errorIdForField("staggerAmount"))}
                  </label>
                  <label class="field">
                    <span>${t("cron.form.staggerUnit")}</span>
                    <select
                      .value=${props.form.staggerUnit}
                      ?disabled=${props.form.scheduleExact}
                      @change=${(e: Event) =>
                        props.onFormChange({
                          staggerUnit: (e.target as HTMLSelectElement).value as CronFormState["staggerUnit"],
                        })}
                    >
                      <option value="seconds">${t("cron.form.seconds")}</option>
                      <option value="minutes">${t("cron.form.minutes")}</option>
                    </select>
                  </label>
                </div>
              `
            : nothing}
          ${isAgentTurn
            ? html`
                <label class="field cron-span-2">
                  ${renderFieldLabel("Account ID")}
                  <input
                    id="cron-delivery-account-id"
                    .value=${props.form.deliveryAccountId}
                    list="cron-delivery-account-suggestions"
                    ?disabled=${selectedDeliveryMode !== "announce"}
                    @input=${(e: Event) =>
                      props.onFormChange({ deliveryAccountId: (e.target as HTMLInputElement).value })}
                    placeholder="default"
                  />
                  <div class="cron-help">Optional channel account ID for multi-account setups.</div>
                </label>
                <label class="field checkbox cron-checkbox cron-span-2">
                  <input
                    type="checkbox"
                    .checked=${props.form.payloadLightContext}
                    @change=${(e: Event) =>
                      props.onFormChange({ payloadLightContext: (e.target as HTMLInputElement).checked })}
                  />
                  <span class="field-checkbox__label">Light context</span>
                  <div class="cron-help">Use lightweight bootstrap context for this agent job.</div>
                </label>
                <label class="field">
                  ${renderFieldLabel(t("cron.form.model"))}
                  <input
                    id="cron-payload-model"
                    .value=${props.form.payloadModel}
                    list="cron-model-suggestions"
                    @input=${(e: Event) =>
                      props.onFormChange({ payloadModel: (e.target as HTMLInputElement).value })}
                    placeholder=${t("cron.form.modelPlaceholder")}
                  />
                  <div class="cron-help">${t("cron.form.modelHelp")}</div>
                </label>
                <label class="field">
                  ${renderFieldLabel(t("cron.form.thinking"))}
                  <input
                    id="cron-payload-thinking"
                    .value=${props.form.payloadThinking}
                    list="cron-thinking-suggestions"
                    @input=${(e: Event) =>
                      props.onFormChange({ payloadThinking: (e.target as HTMLInputElement).value })}
                    placeholder=${t("cron.form.thinkingPlaceholder")}
                  />
                  <div class="cron-help">${t("cron.form.thinkingHelp")}</div>
                </label>
                <label class="field cron-span-2">
                  ${renderFieldLabel("Failure alerts")}
                  <select
                    .value=${props.form.failureAlertMode}
                    @change=${(e: Event) =>
                      props.onFormChange({
                        failureAlertMode: (e.target as HTMLSelectElement)
                          .value as CronFormState["failureAlertMode"],
                      })}
                  >
                    <option value="inherit">Inherit global setting</option>
                    <option value="disabled">Disable for this job</option>
                    <option value="custom">Custom per-job settings</option>
                  </select>
                  <div class="cron-help">Control when this job sends repeated-failure alerts.</div>
                </label>
                ${props.form.failureAlertMode === "custom"
                  ? html`
                      <label class="field">
                        ${renderFieldLabel("Alert after")}
                        <input
                          id="cron-failure-alert-after"
                          .value=${props.form.failureAlertAfter}
                          aria-invalid=${props.fieldErrors.failureAlertAfter ? "true" : "false"}
                          @input=${(e: Event) =>
                            props.onFormChange({ failureAlertAfter: (e.target as HTMLInputElement).value })}
                          placeholder="2"
                        />
                        <div class="cron-help">Consecutive errors before alerting.</div>
                        ${renderFieldError(
                          props.fieldErrors.failureAlertAfter,
                          errorIdForField("failureAlertAfter"),
                        )}
                      </label>
                      <label class="field">
                        ${renderFieldLabel("Cooldown (seconds)")}
                        <input
                          id="cron-failure-alert-cooldown-seconds"
                          .value=${props.form.failureAlertCooldownSeconds}
                          aria-invalid=${props.fieldErrors.failureAlertCooldownSeconds ? "true" : "false"}
                          @input=${(e: Event) =>
                            props.onFormChange({
                              failureAlertCooldownSeconds: (e.target as HTMLInputElement).value,
                            })}
                          placeholder="3600"
                        />
                        <div class="cron-help">Minimum seconds between alerts.</div>
                        ${renderFieldError(
                          props.fieldErrors.failureAlertCooldownSeconds,
                          errorIdForField("failureAlertCooldownSeconds"),
                        )}
                      </label>
                      <label class="field">
                        ${renderFieldLabel("Alert channel")}
                        <select
                          .value=${props.form.failureAlertChannel || "last"}
                          @change=${(e: Event) =>
                            props.onFormChange({
                              failureAlertChannel: (e.target as HTMLSelectElement).value,
                            })}
                        >
                          ${channelOptions.map(
                            (ch) =>
                              html`<option value=${ch}>${resolveChannelLabel(props, ch)}</option>`,
                          )}
                        </select>
                      </label>
                      <label class="field">
                        ${renderFieldLabel("Alert to")}
                        <input
                          .value=${props.form.failureAlertTo}
                          list="cron-delivery-to-suggestions"
                          @input=${(e: Event) =>
                            props.onFormChange({ failureAlertTo: (e.target as HTMLInputElement).value })}
                          placeholder="+1555... or chat id"
                        />
                        <div class="cron-help">Optional recipient override for failure alerts.</div>
                      </label>
                      <label class="field">
                        ${renderFieldLabel("Alert mode")}
                        <select
                          .value=${props.form.failureAlertDeliveryMode || "announce"}
                          @change=${(e: Event) =>
                            props.onFormChange({
                              failureAlertDeliveryMode: (e.target as HTMLSelectElement)
                            .value as CronFormState["failureAlertDeliveryMode"],
                            })}
                        >
                          <option value="announce">Announce (via channel)</option>
                          <option value="webhook">Webhook (HTTP POST)</option>
                        </select>
                      </label>
                      <label class="field">
                        ${renderFieldLabel("Alert account ID")}
                        <input
                          .value=${props.form.failureAlertAccountId}
                          @input=${(e: Event) =>
                            props.onFormChange({ failureAlertAccountId: (e.target as HTMLInputElement).value })}
                          placeholder="Account ID for multi-account setups"
                        />
                      </label>
                    `
                  : nothing}
              `
            : nothing}
          ${selectedDeliveryMode !== "none"
            ? html`
                <label class="field checkbox cron-checkbox cron-span-2">
                  <input
                    type="checkbox"
                    .checked=${props.form.deliveryBestEffort}
                    @change=${(e: Event) =>
                      props.onFormChange({ deliveryBestEffort: (e.target as HTMLInputElement).checked })}
                  />
                  <span class="field-checkbox__label">${t("cron.form.bestEffortDelivery")}</span>
                  <div class="cron-help">${t("cron.form.bestEffortHelp")}</div>
                </label>
              `
            : nothing}
        </div>
      </details>

      ${blockedByValidation
        ? html`
            <div class="cron-form-status" role="status" aria-live="polite">
              <div class="cron-form-status__title">${t("cron.form.cantAddYet")}</div>
              <div class="cron-help">${t("cron.form.fillRequired")}</div>
              <ul class="cron-form-status__list">
                ${blockingFields.map(
                  (field) => html`
                    <li>
                      <button
                        type="button"
                        class="cron-form-status__link"
                        @click=${() => focusFormField(field.inputId)}
                      >
                        ${field.label}: ${t(field.message)}
                      </button>
                    </li>
                  `,
                )}
              </ul>
            </div>
          `
        : nothing}

      <div class="row cron-form-actions">
        <button
          class="btn primary"
          ?disabled=${props.busy || !props.canSubmit}
          @click=${props.onAdd}
        >
          ${props.busy
            ? t("cron.form.saving")
            : props.editingJobId
              ? t("cron.form.saveChanges")
              : t("cron.form.addJob")}
        </button>
        ${submitDisabledReason
          ? html`<div class="cron-submit-reason" aria-live="polite">${submitDisabledReason}</div>`
          : nothing}
        ${props.editingJobId
          ? html`
              <button class="btn" ?disabled=${props.busy} @click=${() => {
                props.onSetFormOpenForNew(false);
                props.onCancelEdit();
              }}>
                ${t("cron.form.cancel")}
              </button>
            `
          : nothing}
      </div>
    </div>
  `;
}

// ── Schedule field rendering ──

function renderScheduleFields(props: CronProps) {
  const form = props.form;
  if (form.scheduleKind === "at") {
    return html`
      <label class="field cron-span-2" style="margin-top: 12px;">
        ${renderFieldLabel(t("cron.form.runAt"), true)}
        <input
          id="cron-schedule-at"
          type="datetime-local"
          .value=${form.scheduleAt}
          aria-invalid=${props.fieldErrors.scheduleAt ? "true" : "false"}
          aria-describedby=${ifDefined(
            props.fieldErrors.scheduleAt ? errorIdForField("scheduleAt") : undefined,
          )}
          @input=${(e: Event) => props.onFormChange({ scheduleAt: (e.target as HTMLInputElement).value })}
        />
        ${renderFieldError(props.fieldErrors.scheduleAt, errorIdForField("scheduleAt"))}
      </label>
    `;
  }
  if (form.scheduleKind === "every") {
    return html`
      <div class="form-grid cron-form-grid" style="margin-top: 12px;">
        <label class="field">
          ${renderFieldLabel(t("cron.form.every"), true)}
          <input
            id="cron-every-amount"
            .value=${form.everyAmount}
            aria-invalid=${props.fieldErrors.everyAmount ? "true" : "false"}
            aria-describedby=${ifDefined(
              props.fieldErrors.everyAmount ? errorIdForField("everyAmount") : undefined,
            )}
            @input=${(e: Event) => props.onFormChange({ everyAmount: (e.target as HTMLInputElement).value })}
            placeholder=${t("cron.form.everyAmountPlaceholder")}
          />
          ${renderFieldError(props.fieldErrors.everyAmount, errorIdForField("everyAmount"))}
        </label>
        <label class="field">
          <span>${t("cron.form.unit")}</span>
          <select
            .value=${form.everyUnit}
            @change=${(e: Event) =>
              props.onFormChange({ everyUnit: (e.target as HTMLSelectElement).value as CronFormState["everyUnit"] })}
          >
            <option value="minutes">${t("cron.form.minutes")}</option>
            <option value="hours">${t("cron.form.hours")}</option>
            <option value="days">${t("cron.form.days")}</option>
          </select>
        </label>
      </div>
    `;
  }
  return html`
    <div class="form-grid cron-form-grid" style="margin-top: 12px;">
      <label class="field">
        ${renderFieldLabel(t("cron.form.expression"), true)}
        <input
          id="cron-cron-expr"
          .value=${form.cronExpr}
          aria-invalid=${props.fieldErrors.cronExpr ? "true" : "false"}
          aria-describedby=${ifDefined(
            props.fieldErrors.cronExpr ? errorIdForField("cronExpr") : undefined,
          )}
          @input=${(e: Event) => props.onFormChange({ cronExpr: (e.target as HTMLInputElement).value })}
          placeholder=${t("cron.form.expressionPlaceholder")}
        />
        ${renderFieldError(props.fieldErrors.cronExpr, errorIdForField("cronExpr"))}
      </label>
      <label class="field">
        <span>${t("cron.form.timezoneOptional")}</span>
        <input
          .value=${form.cronTz}
          list="cron-tz-suggestions"
          @input=${(e: Event) => props.onFormChange({ cronTz: (e.target as HTMLInputElement).value })}
          placeholder=${t("cron.form.timezonePlaceholder")}
        />
        <div class="cron-help">${t("cron.form.timezoneHelp")}</div>
      </label>
      <div class="cron-help cron-span-2">${t("cron.form.jitterHelp")}</div>
    </div>
  `;
}

function renderFieldError(message?: string, id?: string) {
  if (!message) { return nothing; }
  return html`<div id=${ifDefined(id)} class="cron-help cron-error">${t(message)}</div>`;
}

function formatStateRelative(ms?: number) {
  if (typeof ms !== "number" || !Number.isFinite(ms)) { return t("common.na"); }
  return formatRelativeTimestamp(ms);
}
