import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import type { SkillStatusEntry, SkillStatusReport } from "../types.ts";
import { groupSkills } from "./skills-grouping.ts";
import {
  computeSkillMissing,
  computeSkillReasons,
  renderSkillStatusChips,
} from "./skills-shared.ts";

type ClawHubSkillSearchResult = {
  score: number;
  slug: string;
  displayName: string;
  summary?: string;
  version?: string;
  updatedAt?: number;
};

export type SkillsManagerProps = {
  loading: boolean;
  error: string | null;
  installed: SkillStatusReport | null;
  searchQuery: string;
  searchResults: ClawHubSkillSearchResult[];
  detail: unknown | null;
  installing: boolean;
  updating: boolean;
  actionSlug: string | null;
  onSearch: (query: string) => void;
  onInstall: (slug: string) => void;
  onUpdate: (slug: string) => void;
  onDetail: (slug: string) => void;
  onRefresh: () => void;
};

export function renderSkillsManager(props: SkillsManagerProps) {
  if (props.loading) {
    return html`<div class="page-loader">${t("common.loading")}</div>`;
  }
  if (props.error) {
    return html`<div class="callout danger">${props.error}</div>`;
  }

  return html`
    <section class="stack">
      <div class="skills-header">
        <h3>${t("tabs.skills")}</h3>
        <button class="btn" @click=${props.onRefresh}>Refresh</button>
      </div>

      <div class="skills-layout">
        <div class="skills-panel">${renderInstalledPanel(props)}</div>
        <div class="skills-panel">${renderSearchPanel(props)}</div>
      </div>
    </section>
  `;
}

function renderInstalledPanel(props: SkillsManagerProps) {
  const report = props.installed;
  const skills: SkillStatusEntry[] = report?.skills ?? [];

  if (skills.length === 0) {
    return html`
      <div class="card">
        <h4>Installed Skills</h4>
        <p class="text-muted">No skills installed yet.</p>
      </div>
    `;
  }

  const groups = groupSkills(skills);

  return html`
    <div class="card">
      <h4>Installed Skills <span class="text-muted">(${skills.length})</span></h4>
      <div class="stack" style="margin-top: 8px;">
        ${groups.map(
          (group) => html`
            <div class="skills-group">
              <div class="skills-group-label">
                ${group.label} <span class="text-muted">(${group.skills.length})</span>
              </div>
              <div class="skills-card-grid">
                ${group.skills.map((skill) => renderInstalledSkillCard(skill, props))}
              </div>
            </div>
          `,
        )}
      </div>
    </div>
  `;
}

function renderInstalledSkillCard(skill: SkillStatusEntry, props: SkillsManagerProps) {
  const missing = computeSkillMissing(skill);
  const reasons = computeSkillReasons(skill);
  const isActing = props.actionSlug === skill.name && props.updating;

  return html`
    <div class="skills-entry">
      <div class="skills-entry-header">
        <span class="skills-entry-name">
          ${skill.emoji ? html`${skill.emoji} ` : nothing}${skill.name}
        </span>
        <span class="pill ${skill.eligible ? "pill-ok" : "pill-warn"}">
          ${skill.eligible ? "enabled" : "disabled"}
        </span>
      </div>
      ${skill.description
        ? html`<div class="skills-entry-desc">${skill.description}</div>`
        : nothing}
      ${renderSkillStatusChips({ skill, showBundledBadge: skill.bundled })}
      ${missing.length > 0
        ? html`
            <div class="callout warn" style="margin-top: 6px;">Missing: ${missing.join(", ")}</div>
          `
        : nothing}
      ${reasons.length > 0
        ? html`
            <div class="text-muted" style="margin-top: 4px; font-size: 12px;">
              ${reasons.join(", ")}
            </div>
          `
        : nothing}
      <div class="skills-entry-actions">
        ${skill.source === "kaijibot-managed"
          ? html`
              <button class="btn" ?disabled=${isActing} @click=${() => props.onUpdate(skill.name)}>
                ${isActing ? "Updating…" : "Update"}
              </button>
            `
          : nothing}
      </div>
    </div>
  `;
}

function renderSearchPanel(props: SkillsManagerProps) {
  return html`
    <div class="card">
      <h4>ClawHub Search</h4>
      <div class="skills-search-bar">
        <input
          type="text"
          placeholder="Search skills on ClawHub…"
          .value=${props.searchQuery}
          @input=${(e: Event) => {
            const value = (e.target as HTMLInputElement).value;
            props.onSearch(value);
          }}
        />
      </div>
      ${props.searchQuery && props.searchResults.length === 0
        ? html`<p class="text-muted" style="margin-top: 8px;">No results found.</p>`
        : nothing}
      ${props.searchResults.length > 0
        ? html`
            <div class="stack" style="margin-top: 12px;">
              ${props.searchResults.map((result) => renderSearchResultCard(result, props))}
            </div>
          `
        : nothing}
    </div>
  `;
}

function renderSearchResultCard(result: ClawHubSkillSearchResult, props: SkillsManagerProps) {
  const isActing = props.actionSlug === result.slug && props.installing;

  return html`
    <div class="skills-entry">
      <div class="skills-entry-header">
        <span class="skills-entry-name">${result.displayName}</span>
        ${result.version ? html`<span class="pill">${result.version}</span>` : nothing}
      </div>
      ${result.summary ? html`<div class="skills-entry-desc">${result.summary}</div>` : nothing}
      <div class="skills-entry-meta">
        ${result.score
          ? html`<span class="text-muted">Score: ${result.score.toFixed(2)}</span>`
          : nothing}
      </div>
      <div class="skills-entry-actions">
        <button
          class="btn primary"
          ?disabled=${isActing}
          @click=${() => props.onInstall(result.slug)}
        >
          ${isActing ? "Installing…" : "Install"}
        </button>
        <button class="btn" @click=${() => props.onDetail(result.slug)}>Details</button>
      </div>
    </div>
  `;
}
