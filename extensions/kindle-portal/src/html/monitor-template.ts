/**
 * Focused operational dashboard for Kindle Portal.
 *
 * Shows exactly four things, nothing else:
 *   1. Today's Usage — tokens + cost (big numbers)
 *   2. Provider Quota — ZAI usage percentage (progress bar)
 *   3. Agent Status — every registered agent with session counts
 *   4. System Health — ACTIVE/IDLE + last activity time
 *
 * No cognitive stats, no lane notes, no stat-bar visualizations, no active
 * session cards. Clean and operational.
 *
 * Renders ES5-compatible HTML for a Kindle Paperwhite 7th gen placed below
 * a computer monitor at ~60-80cm viewing distance. Body base is 30px with
 * every child size in `em`, so the A-/A+ zoom buttons (which step
 * `document.body.style.fontSize` across 20-42px) scale the whole page.
 *
 * All HTML/script is built with `+` concatenation — no template literals —
 * so the rendered output passes `lintKindleHtml` (no backticks, no `=>`, no
 * `const`/`let`, no `fetch`).
 */

import type { FleetSnapshot, FleetAgent, RegisteredAgent } from "../types.js";
import type { KindleConfig } from "../config.js";
import { SHARED_CSS } from "./shared-css.js";

/**
 * Format token counts with K/M suffixes: 302000 -> "302K", 1200000 -> "1.2M".
 */
function formatTokens(n: number): string {
  if (n >= 1000000) {
    var m = n / 1000000;
    var ms = m.toFixed(1);
    if (ms.charAt(ms.length - 1) === "0" && ms.charAt(ms.length - 2) === ".") {
      ms = ms.substring(0, ms.length - 2);
    }
    return ms + "M";
  }
  if (n >= 1000) {
    var k = n / 1000;
    var ks = k.toFixed(1);
    if (ks.charAt(ks.length - 1) === "0" && ks.charAt(ks.length - 2) === ".") {
      ks = ks.substring(0, ks.length - 2);
    }
    return ks + "K";
  }
  return String(n);
}

/**
 * Relative time formatter: "just now", "5m ago", "3h ago", "2d ago".
 */
function formatRelativeTime(timestamp: number | undefined, now: number): string {
  if (timestamp === undefined) {
    return "";
  }
  var diff = now - timestamp;
  if (diff < 0) {
    diff = 0;
  }
  var seconds = Math.round(diff / 1000);
  if (seconds < 60) {
    return "just now";
  }
  var minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return minutes + "m ago";
  }
  var hours = Math.round(minutes / 60);
  if (hours < 24) {
    return hours + "h ago";
  }
  var days = Math.round(hours / 24);
  return days + "d ago";
}

/**
 * Resolve the most recent activity timestamp across registered agents.
 */
function lastActivityTime(agents: readonly RegisteredAgent[]): number | undefined {
  var latest: number | undefined;
  for (var i = 0; i < agents.length; i++) {
    var ts = agents[i].lastActiveAt;
    if (ts !== undefined && (latest === undefined || ts > latest)) {
      latest = ts;
    }
  }
  return latest;
}

/**
 * Collect agent IDs that currently have active runs for O(1) lookup.
 */
function collectActiveAgentIds(agents: readonly FleetAgent[]): Set<string> {
  var ids = new Set<string>();
  for (var i = 0; i < agents.length; i++) {
    var a = agents[i];
    if (a.agentId !== undefined && a.agentId.length > 0) {
      ids.add(a.agentId);
    }
  }
  return ids;
}

/**
 * Render a registered-agent card. Active agents get a thick left border;
 * idle agents are dimmed.
 */
function renderAgentCard(agent: RegisteredAgent): string {
  var statusClass = agent.status === "active" ? "active" : "idle";
  var statusIcon = agent.status === "active" ? "\u25cf ACTIVE" : "\u25cb IDLE";
  var model = agent.model;
  var sessionCount = String(agent.sessionCount);
  var sessionWord = agent.sessionCount === 1 ? "session" : "sessions";
  var lastActive = agent.lastActiveAt !== undefined
    ? " \u00b7 last: " + formatRelativeTime(agent.lastActiveAt, Date.now())
    : "";
  return '<div class="agent-card ' + statusClass + '">'
    + '<div class="agent-status">' + statusIcon + "</div>"
    + '<div class="agent-id">' + agent.id + "</div>"
    + '<div class="agent-model">'
    + model + " \u00b7 " + sessionCount + " " + sessionWord + lastActive
    + "</div>"
    + "</div>";
}

/**
 * Build the focused operational dashboard HTML.
 *
 * Layout (float-based — old WebKit has no flexbox):
 *   1. Tab bar: Monitor (active) / Map
 *   2. Header: title + ACTIVE/IDLE badge + last activity + A-/A+ zoom
 *   3. Today's Usage: tokens + cost (2 metrics)
 *   4. Provider Quota: ZAI usage progress bar
 *   5. Agents: every registered agent, always visible
 *   6. Footer: refresh note + nav links
 */
export function renderMonitorHtml(
  snapshot: FleetSnapshot,
  cfg: Pick<KindleConfig, "refreshIntervalSeconds" | "accessToken">,
  registeredAgents?: readonly RegisteredAgent[],
): string {
  var sec = String(cfg.refreshIntervalSeconds);
  var tq = cfg.accessToken ? "?token=" + cfg.accessToken : "";
  var iso = new Date(snapshot.generatedAt).toISOString().substring(0, 19) + "Z";
  var isActive = !snapshot.idle;
  var stateIcon = isActive ? "\u25c9" : "\u25cb";
  var stateText = isActive ? "ACTIVE" : "IDLE";

  // ── Today's usage metrics ──
  var usage = snapshot.usage;
  var todayTokens = usage ? usage.todayTokens : 0;
  var todayCost = usage ? usage.todayCostUsd : 0;
  var tokensStr = todayTokens > 0 ? formatTokens(todayTokens) : "0";
  var costStr = "$" + todayCost.toFixed(2);

  // ── Provider quota ──
  var quota = snapshot.providerQuota;
  var quotaSection: string;
  if (quota) {
    var pct = Math.max(0, Math.min(100, Math.round(quota.usedPercent)));
    var model = quota.provider === "zai" ? "glm-5.2" : quota.provider;
    quotaSection = '<div class="quota-section">'
      + '<div class="quota-label">' + quota.displayName + " (" + model + ") \u2014 "
      + pct + "% used</div>"
      + '<div class="quota-bar"><div class="quota-fill" style="width:'
      + pct + '%"></div></div>'
      + "</div>";
  } else {
    quotaSection = '<div class="quota-section">'
      + '<div class="quota-label">Provider quota unavailable</div>'
      + "</div>";
  }

  // ── Agents section (always shows all registered agents) ──
  var activeAgentIds = collectActiveAgentIds(snapshot.agents);
  var agentsSection: string;
  if (registeredAgents !== undefined && registeredAgents.length > 0) {
    var agentParts: string[] = [];
    for (var ai = 0; ai < registeredAgents.length; ai++) {
      var ra = registeredAgents[ai];
      var merged: RegisteredAgent = {
        id: ra.id,
        model: ra.model,
        isDefault: ra.isDefault,
        status: activeAgentIds.has(ra.id) ? "active" : ra.status,
        lastActiveAt: ra.lastActiveAt,
        sessionCount: ra.sessionCount,
      };
      agentParts.push(renderAgentCard(merged));
    }
    agentsSection = agentParts.join("");
  } else {
    agentsSection = '<div class="empty">\u25cb No agents configured.</div>';
  }

  // ── System health: last activity ──
  var allAgents = registeredAgents ?? [];
  var lastTs = lastActivityTime(allAgents);
  var lastActivityStr = lastTs !== undefined
    ? formatRelativeTime(lastTs, snapshot.generatedAt)
    : "never";

  var refreshMs = String(cfg.refreshIntervalSeconds * 1000);

  return "<!DOCTYPE html>"
    + '<html lang="en">'
    + "<head>"
    + '<meta charset="utf-8">'
    + '<meta http-equiv="refresh" content="' + sec + '">'
    + "<title>KaijiBot</title>"
    + "<style>" + SHARED_CSS + "</style>"
    + "</head>"
    + "<body>"
    // ── Tab bar ──
    + '<div class="tabs">'
    + '<span class="tab tab-active">Monitor</span>'
    + '<a class="tab" href="/kindle/map' + tq + '">Map</a>'
    + "</div>"
    // ── Header bar ──
    + '<div class="header clearfix">'
    + '<div class="zoom-bar">'
    + '<button type="button" class="zoom-btn" onclick="zoomOut()">A-</button>'
    + '<button type="button" class="zoom-btn" onclick="zoomIn()">A+</button>'
    + "</div>"
    + '<div class="title">KaijiBot</div>'
    + '<div class="meta">'
    + '<span class="badge"><span class="status-icon">' + stateIcon + "</span> " + stateText + "</span>"
    + " | " + iso
    + " | Last: " + lastActivityStr
    + "</div>"
    + "</div>"
    // ── Today's Usage (2 metrics) ──
    + '<div class="metrics-row clearfix">'
    + '<div class="metric">'
    + '<div class="metric-num">' + tokensStr + "</div>"
    + '<div class="metric-label">TOKENS TODAY</div>'
    + "</div>"
    + '<div class="metric">'
    + '<div class="metric-num">' + costStr + "</div>"
    + '<div class="metric-label">COST TODAY</div>'
    + "</div>"
    + "</div>"
    // ── Provider Quota ──
    + quotaSection
    // ── Agents section ──
    + '<div class="section">'
    + agentsSection
    + "</div>"
    // ── Footer ──
    + '<div class="footer">'
    + "Auto-refresh: " + sec + "s"
    + ' | <a href="/kindle/' + tq + '">Monitor</a>'
    + ' &middot; <a href="/kindle/map' + tq + '">Map</a>'
    + "</div>"
    + "<script>"
    // ── Zoom (ES5: var, function declarations, + concatenation) ──
    + "var zoomLevel = 30;"
    + "function zoomIn() {"
    + "if (zoomLevel < 42) {"
    + "zoomLevel = zoomLevel + 2;"
    + 'document.body.style.fontSize = zoomLevel + "px";'
    + "}"
    + "}"
    + "function zoomOut() {"
    + "if (zoomLevel > 20) {"
    + "zoomLevel = zoomLevel - 2;"
    + 'document.body.style.fontSize = zoomLevel + "px";'
    + "}"
    + "}"
    // ── XHR polling (auto-refresh) ──
    + "var REFRESH_MS = " + refreshMs + ";"
    + 'var TOKEN_Q = "' + tq + '";'
    + "function pollFleet() {"
    + "var xhr = new XMLHttpRequest();"
    + 'xhr.open("GET", "/kindle/api/fleet" + TOKEN_Q, true);'
    + "xhr.onreadystatechange = function () {"
    + "if (xhr.readyState === 4 && xhr.status === 200) {"
    + "window.location.reload();"
    + "}"
    + "};"
    + "xhr.send();"
    + "}"
    + "setInterval(pollFleet, REFRESH_MS);"
    + "</script>"
    + "</body>"
    + "</html>";
}
