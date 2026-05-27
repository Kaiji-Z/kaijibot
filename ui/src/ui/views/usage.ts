import { html, nothing } from "lit";
import type {
  CostUsageSummary,
  CostUsageDailyEntry,
  SessionsUsageResult,
  UsageStatusResult,
  ProviderUsageSnapshot,
} from "../types.ts";

type ModelUsageEntry = SessionsUsageResult["aggregates"]["byModel"][number];

export type UsageDashboardProps = {
  loading: boolean;
  error: string | null;
  costData: unknown | null;
  sessionsData: unknown | null;
  providerStatus: unknown | null;
  onRefresh: () => void;
};

// ── Formatters ──────────────────────────────────────

function formatCost(value: number): string {
  return `$${value.toFixed(2)}`;
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) {
    const m = value / 1_000_000;
    return m >= 10 ? `${m.toFixed(0)}M` : `${m.toFixed(1)}M`;
  }
  if (value >= 1_000) {
    const k = value / 1_000;
    return k >= 100 ? `${k.toFixed(0)}K` : `${k.toFixed(1)}K`;
  }
  return String(value);
}

function formatCount(value: number): string {
  if (value >= 1_000_000) {
    const m = value / 1_000_000;
    return m >= 10 ? `${m.toFixed(0)}M` : `${m.toFixed(1)}M`;
  }
  if (value >= 1_000) {
    const k = value / 1_000;
    return k >= 100 ? `${k.toFixed(0)}K` : `${k.toFixed(1)}K`;
  }
  return String(value);
}

// ── Sub-renders ─────────────────────────────────────

function renderSummaryCards(cost: CostUsageSummary, sessions: SessionsUsageResult) {
  const totals = cost.totals;
  const aggregates = sessions.aggregates;
  const totalCost = totals.totalCost;
  const totalTokens = totals.totalTokens;
  const messages = aggregates.messages.total;
  const toolCalls = aggregates.tools.totalCalls;

  return html`
    <div class="usage-summary-grid">
      <div class="usage-summary-card stat">
        <div class="usage-summary-title">Total Cost</div>
        <div class="usage-summary-value">${formatCost(totalCost)}</div>
        <div class="usage-summary-sub">${cost.days}-day period</div>
      </div>
      <div class="usage-summary-card stat">
        <div class="usage-summary-title">Total Tokens</div>
        <div class="usage-summary-value">${formatTokens(totalTokens)}</div>
        <div class="usage-summary-sub">input + output</div>
      </div>
      <div class="usage-summary-card stat">
        <div class="usage-summary-title">Messages</div>
        <div class="usage-summary-value">${formatCount(messages)}</div>
        <div class="usage-summary-sub">${formatCount(aggregates.messages.user)} user / ${formatCount(aggregates.messages.assistant)} assistant</div>
      </div>
      <div class="usage-summary-card stat">
        <div class="usage-summary-title">Tool Calls</div>
        <div class="usage-summary-value">${formatCount(toolCalls)}</div>
        <div class="usage-summary-sub">${aggregates.tools.uniqueTools} unique tools</div>
      </div>
    </div>
  `;
}

function renderDailyTrend(cost: CostUsageSummary) {
  const daily = cost.daily;
  if (!daily || daily.length === 0) {
    return html`<div class="usage-empty-block">No daily data available.</div>`;
  }

  const maxCost = Math.max(...daily.map((d: CostUsageDailyEntry) => d.totalCost), 0.01);

  return html`
    <div class="daily-chart-compact">
      <div class="daily-chart-header">
        <div class="usage-mosaic-section-title">Daily Cost Trend</div>
        <div class="usage-mosaic-total">${formatCost(cost.totals.totalCost)} total</div>
      </div>
      <div class="daily-chart-bars">
        ${daily.map((entry: CostUsageDailyEntry) => {
          const heightPct = Math.max(3, (entry.totalCost / maxCost) * 100);
          const label = entry.date.slice(5);
          return html`
            <div class="daily-bar-wrapper">
              <div class="daily-bar-tooltip">
                <strong>${entry.date}</strong><br />
                Cost: ${formatCost(entry.totalCost)}<br />
                Tokens: ${formatTokens(entry.totalTokens)}
              </div>
              <div
                class="daily-bar"
                style="height: ${heightPct}%"
                title="${entry.date}: ${formatCost(entry.totalCost)}"
              ></div>
              <div class="daily-bar-label daily-bar-label--compact">${label}</div>
            </div>
          `;
        })}
      </div>
    </div>
  `;
}

function renderModelBreakdown(sessions: SessionsUsageResult) {
  const byModel = sessions.aggregates.byModel;
  if (!byModel || byModel.length === 0) {
    return html`<div class="usage-empty-block">No model data available.</div>`;
  }

  const sorted = [...byModel].toSorted(
    (a: ModelUsageEntry, b: ModelUsageEntry) => b.totals.totalCost - a.totals.totalCost,
  );

  return html`
    <div class="usage-mosaic-section">
      <div class="usage-mosaic-section-title">Model Breakdown</div>
      <table class="usage-table">
        <thead>
          <tr>
            <th>Model</th>
            <th>Provider</th>
            <th style="text-align:right">Requests</th>
            <th style="text-align:right">Tokens</th>
            <th style="text-align:right">Cost</th>
          </tr>
        </thead>
        <tbody>
          ${sorted.map((m: ModelUsageEntry) => {
            const modelDisplay = m.model ?? "unknown";
            const providerDisplay = m.provider ?? "—";
            return html`
              <tr>
                <td title="${modelDisplay}">${modelDisplay}</td>
                <td>${providerDisplay}</td>
                <td style="text-align:right; font-variant-numeric: tabular-nums">${formatCount(m.count)}</td>
                <td style="text-align:right; font-variant-numeric: tabular-nums">${formatTokens(m.totals.totalTokens)}</td>
                <td style="text-align:right; font-variant-numeric: tabular-nums">${formatCost(m.totals.totalCost)}</td>
              </tr>
            `;
          })}
        </tbody>
      </table>
    </div>
  `;
}

function renderProviderStatus(status: UsageStatusResult) {
  const providers = status.providers;
  if (!providers || providers.length === 0) {
    return html`<div class="usage-empty-block">No provider quota data available.</div>`;
  }

  return html`
    <div class="usage-mosaic-section">
      <div class="usage-mosaic-section-title">Provider Quota Status</div>
      <div class="usage-provider-grid">
        ${providers.map((p: ProviderUsageSnapshot) => {
          const displayName = p.displayName ?? p.provider;
          const windows = p.windows ?? [];
          return html`
            <div class="usage-provider-card">
              <div class="usage-provider-name">${displayName}</div>
              ${windows.length === 0
                ? html`<div class="usage-provider-windows-empty">No quota windows</div>`
                : windows.map(
                    (w) => html`
                      <div class="usage-window">
                        <div class="usage-window-header">
                          <span class="usage-window-label">${w.label}</span>
                          <span class="usage-window-pct">${w.usedPercent.toFixed(0)}%</span>
                        </div>
                        <div class="usage-window-bar">
                          <div
                            class="usage-window-fill ${w.usedPercent >= 90
                              ? "usage-window-fill--danger"
                              : w.usedPercent >= 70
                                ? "usage-window-fill--warn"
                                : ""}"
                            style="width: ${Math.min(w.usedPercent, 100)}%"
                          ></div>
                        </div>
                      </div>
                    `,
                  )}
            </div>
          `;
        })}
      </div>
    </div>
  `;
}

// ── Main view ───────────────────────────────────────

export function renderUsageDashboard(props: UsageDashboardProps) {
  if (props.loading) {
    return html`<div class="page-loader"><span class="usage-loading-spinner"></span> Loading usage data…</div>`;
  }
  if (props.error) {
    return html`
      <section class="stack">
        <div class="callout danger">${props.error}</div>
        <button class="btn btn--sm" @click=${props.onRefresh}>Retry</button>
      </section>
    `;
  }

  const cost = props.costData as CostUsageSummary | null;
  const sessions = props.sessionsData as SessionsUsageResult | null;
  const providerStatus = props.providerStatus as UsageStatusResult | null;

  if (!cost && !sessions) {
    return html`
      <section class="stack">
        <div class="card">
          <h3>Usage</h3>
          <p style="color: var(--muted)">No usage data available yet. Data will appear once the gateway processes requests.</p>
        </div>
      </section>
    `;
  }

  const safeCost = cost ?? {
    updatedAt: 0,
    days: 30,
    daily: [],
    totals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, totalCost: 0, inputCost: 0, outputCost: 0, cacheReadCost: 0, cacheWriteCost: 0, missingCostEntries: 0 },
  } satisfies CostUsageSummary;

  const safeSessions = sessions ?? {
    updatedAt: 0,
    startDate: "",
    endDate: "",
    sessions: [],
    totals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, totalCost: 0, inputCost: 0, outputCost: 0, cacheReadCost: 0, cacheWriteCost: 0, missingCostEntries: 0 },
    aggregates: { messages: { total: 0, user: 0, assistant: 0, toolCalls: 0, toolResults: 0, errors: 0 }, tools: { totalCalls: 0, uniqueTools: 0, tools: [] }, byModel: [], byProvider: [], byAgent: [], byChannel: [], daily: [] },
  } satisfies SessionsUsageResult;

  return html`
    <section class="usage-page">
      <div class="usage-header">
        <div class="usage-header-row">
          <div class="usage-header-title">
            <button class="btn btn--sm" @click=${props.onRefresh}>Refresh</button>
          </div>
          <div class="usage-header-metrics">
            ${safeCost.updatedAt
              ? html`<span class="usage-metric-badge">Updated ${new Date(safeCost.updatedAt).toLocaleTimeString()}</span>`
              : nothing}
          </div>
        </div>
      </div>

      ${renderSummaryCards(safeCost, safeSessions)}

      <div class="usage-overview-layout">
        <div class="usage-left-card">
          <div class="card usage-overview-card">
            ${renderDailyTrend(safeCost)}
          </div>
        </div>

        <div class="usage-left-card">
          <div class="card usage-overview-card">
            ${renderModelBreakdown(safeSessions)}
          </div>
        </div>
      </div>

      ${providerStatus
        ? html`
            <div class="card usage-overview-card">
              ${renderProviderStatus(providerStatus)}
            </div>
          `
        : nothing}
    </section>
  `;
}
