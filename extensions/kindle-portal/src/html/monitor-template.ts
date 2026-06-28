/**
 * Live fleet monitor dashboard HTML template for Kindle Portal.
 *
 * Renders an ES5-compatible dashboard for a Kindle Paperwhite 7th gen placed
 * below a computer monitor at ~60-80cm viewing distance. Body base is 30px
 * with every child size in `em`, so the A-/A+ zoom buttons (which step
 * `document.body.style.fontSize` across 20-42px) scale the whole page.
 *
 * Layout (float-based — old WebKit has no flexbox):
 *   1. Tab bar: Monitor (active) / Map
 *   2. Header: title + ◉ ACTIVE / ○ IDLE badge + A-/A+ zoom (float right)
 *   3. Cognitive Status: domains bar + metrics row (DOMAINS/CORRECTIONS/SKILLS)
 *   4. Agents: every registered agent (idle + active), always visible
 *   5. Active Sessions: currently running runs, or "No active sessions"
 *   6. Usage metrics: AGENTS / TOKENS / COST
 *   7. Footer: PNG renderer capability + refresh note
 *
 * The page reloads itself via XHR polling (`setInterval` + XMLHttpRequest)
 * with a `<meta http-equiv="refresh">` no-JS fallback.
 *
 * All HTML/script is built with `+` concatenation — no template literals —
 * so the rendered output passes `lintKindleHtml` (no backticks, no `=>`, no
 * `const`/`let`, no `fetch`). Status uses Unicode geometric symbols
 * (■ ▶ ✓ ✗ ● ○) that render reliably on the e-ink system fonts.
 *
 * Agent name resolution: ALWAYS uses agent.id (e.g. "main"). Never shows
 * runId or sessionKey UUIDs. Active snapshot agents are matched to registered
 * agents by agentId to mark them as ACTIVE in the roster.
 */

import type { FleetSnapshot, FleetAgent, RegisteredAgent } from "../types.js";
import type { KindleConfig } from "../config.js";
import { SHARED_CSS } from "./shared-css.js";

const STATUS_SYMBOLS: Record<FleetAgent["status"], string> = {
  thinking: "■",
  tool_calling: "▶",
  completed: "✓",
  failed: "✗",
};

function statusLabel(status: FleetAgent["status"]): string {
  return status.replace(/_/g, " ").toUpperCase();
}

/**
 * Resolve the display name for an active session agent. Priority:
 * agentId → sessionLabel → "session". Never returns runId (a UUID).
 */
function activeSessionName(agent: FleetAgent): string {
  if (agent.agentId !== undefined && agent.agentId.length > 0) {
    return agent.agentId;
  }
  if (agent.sessionLabel !== undefined && agent.sessionLabel.length > 0) {
    return agent.sessionLabel;
  }
  return "session";
}

/**
 * Compact token formatter: values >= 1000 get a "K" suffix with one decimal
 * (trailing ".0" dropped), e.g. 12300 -> "12.3K", 5000 -> "5K".
 */
function formatTokens(n: number): string {
  if (n >= 1000) {
    var s = (n / 1000).toFixed(1);
    if (s.length >= 2 && s.charAt(s.length - 1) === "0" && s.charAt(s.length - 2) === ".") {
      s = s.substring(0, s.length - 2);
    }
    return s + "K";
  }
  return String(n);
}

/**
 * Relative time formatter: "just now", "5m ago", "3h ago", "2d ago".
 * Returns "" when timestamp is undefined.
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
 * Render a registered-agent card. Uses agent.id (never a UUID).
 * Active agents get a thick left border; idle agents are dimmed.
 */
function renderAgentCard(agent: RegisteredAgent): string {
  var statusClass = agent.status === "active" ? "active" : "idle";
  var statusIcon = agent.status === "active" ? "● ACTIVE" : "○ IDLE";
  var model = agent.model;
  var sessionCount = String(agent.sessionCount);
  var sessionWord = agent.sessionCount === 1 ? "session" : "sessions";
  var lastActive = agent.lastActiveAt !== undefined
    ? " · last: " + formatRelativeTime(agent.lastActiveAt, Date.now())
    : "";
  return '<div class="agent-card ' + statusClass + '">'
    + '<div class="agent-status">' + statusIcon + "</div>"
    + '<div class="agent-id">' + agent.id + "</div>"
    + '<div class="agent-model">'
    + model + " · " + sessionCount + " " + sessionWord + lastActive
    + "</div>"
    + "</div>";
}

/**
 * Render an active-session card from the fleet snapshot. Shows live run
 * details: status, elapsed time, tool calls, model, cost.
 */
function renderActiveSessionCard(agent: FleetAgent, generatedAt: number): string {
  var name = activeSessionName(agent);
  var sym = STATUS_SYMBOLS[agent.status];
  var label = statusLabel(agent.status);
  var model = agent.model ?? "unknown";
  var toolCallCount = String(agent.toolCallCount);
  var elapsedSeconds = String(Math.max(0, Math.round((generatedAt - agent.startedAt) / 1000)));
  var cost = agent.estimatedCostUsd !== undefined ? agent.estimatedCostUsd.toFixed(4) : "—";

  return '<div class="card status-' + agent.status + '">'
    + '<div class="card-head clearfix">'
    + '<div class="status-badge"><span class="status-icon">'
    + sym + " " + label + "</span></div>"
    + '<div class="card-name">' + name + "</div>"
    + "</div>"
    + '<div class="card-detail">'
    + label + " · " + elapsedSeconds + "s ago · " + toolCallCount
    + " tools · Model: " + model + " · $" + cost
    + "</div>"
    + "</div>";
}

/**
 * Build the set of agent IDs that currently have active runs, for O(1)
 * lookup when marking registered agents as active.
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
 * Build the dashboard HTML page for a fleet snapshot.
 *
 * When `registeredAgents` is provided, the AGENTS section always shows every
 * registered agent (idle + active). When omitted (backward compat / tests),
 * the AGENTS section falls back to showing active agents from the snapshot.
 *
 * When `snapshot.usage` or `snapshot.cognitive` are undefined, the
 * corresponding metrics render "—" and cognitive counts render 0.
 */
export function renderMonitorHtml(
  snapshot: FleetSnapshot,
  cfg: Pick<KindleConfig, "refreshIntervalSeconds" | "accessToken">,
  registeredAgents?: readonly RegisteredAgent[],
): string {
  var sec = String(cfg.refreshIntervalSeconds);
  var tq = cfg.accessToken ? "?token=" + cfg.accessToken : "";
  var iso = new Date(snapshot.generatedAt).toISOString().substring(0, 19) + "Z";
  var activeCount = String(snapshot.agents.length);
  var isActive = !snapshot.idle;
  var stateIcon = isActive ? "◉" : "○";
  var stateText = isActive ? "ACTIVE" : "IDLE";
  var pngCap = snapshot.pngCapability ?? "unknown";

  var usage = snapshot.usage;
  var tokensStr = usage && usage.totalTokens ? formatTokens(usage.totalTokens) : "—";
  var costStr = usage && usage.estimatedCostUsd !== undefined
    ? "$" + usage.estimatedCostUsd.toFixed(2)
    : "—";

  var cog = snapshot.cognitive;
  var domainsN = cog ? String(cog.domains) : "0";
  var correctionsN = cog ? String(cog.corrections) : "0";
  var skillsN = cog ? String(cog.skills) : "0";
  var domainsNum = cog ? cog.domains : 0;
  var barPct = Math.min(100, Math.round((domainsNum / 150) * 100));

  var activeAgentIds = collectActiveAgentIds(snapshot.agents);

  // ── AGENTS section ──
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
  } else if (snapshot.agents.length > 0) {
    // Backward compat: no registered agents provided, show active ones.
    var fallbackParts: string[] = [];
    for (var fi = 0; fi < snapshot.agents.length; fi++) {
      var fa = snapshot.agents[fi];
      var fallbackAgent: RegisteredAgent = {
        id: activeSessionName(fa),
        model: fa.model ?? "unknown",
        isDefault: false,
        status: "active",
        sessionCount: 0,
      };
      fallbackParts.push(renderAgentCard(fallbackAgent));
    }
    agentsSection = fallbackParts.join("");
  } else {
    agentsSection = '<div class="empty">○ No agents configured.</div>';
  }

  // ── ACTIVE SESSIONS section ──
  var sessionsSection: string;
  if (snapshot.agents.length === 0) {
    sessionsSection = '<div class="empty">○ No active sessions.</div>';
  } else {
    var sessionParts: string[] = [];
    for (var si = 0; si < snapshot.agents.length; si++) {
      sessionParts.push(renderActiveSessionCard(snapshot.agents[si], snapshot.generatedAt));
    }
    sessionsSection = sessionParts.join("");
  }

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
    // ── Tab bar (always at top) ──
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
    + " | Agents: " + activeCount
    + "</div>"
    + "</div>"
    // ── Cognitive Status section (visualized) ──
    + '<div class="section">'
    + '<div class="section-h">COGNITIVE STATUS</div>'
    + "<div>Domains: <strong>" + domainsN + "</strong></div>"
    + '<div class="stat-bar"><div class="stat-bar-fill" style="width:' + barPct + '%"></div></div>'
    + '<div class="metrics-row clearfix">'
    + '<div class="metric">'
    + '<div class="metric-num">' + domainsN + "</div>"
    + '<div class="metric-label">DOMAINS</div>'
    + "</div>"
    + '<div class="metric">'
    + '<div class="metric-num">' + correctionsN + "</div>"
    + '<div class="metric-label">CORRECTIONS</div>'
    + "</div>"
    + '<div class="metric">'
    + '<div class="metric-num">' + skillsN + "</div>"
    + '<div class="metric-label">SKILLS</div>'
    + "</div>"
    + "</div>"
    + '<div class="nav"><a href="/kindle/map' + tq + '">View cognitive map &rarr;</a></div>'
    + "</div>"
    // ── Agents section (always shows all registered agents) ──
    + '<div class="section">'
    + '<div class="section-h">AGENTS</div>'
    + agentsSection
    + "</div>"
    // ── Active Sessions section ──
    + '<div class="section">'
    + '<div class="section-h">ACTIVE SESSIONS</div>'
    + sessionsSection
    + "</div>"
    // ── Usage metrics row: AGENTS / TOKENS / COST ──
    + '<div class="metrics-row clearfix">'
    + '<div class="metric">'
    + '<div class="metric-num">' + activeCount + "</div>"
    + '<div class="metric-label">AGENTS</div>'
    + "</div>"
    + '<div class="metric">'
    + '<div class="metric-num">' + tokensStr + "</div>"
    + '<div class="metric-label">TOKENS</div>'
    + "</div>"
    + '<div class="metric">'
    + '<div class="metric-num">' + costStr + "</div>"
    + '<div class="metric-label">COST</div>'
    + "</div>"
    + "</div>"
    // ── Lane note ──
    + '<div class="lane-note">Lane/queue depth unavailable (plugin-boundary).</div>'
    // ── Footer ──
    + '<div class="footer">'
    + "PNG renderer: " + pngCap + " | Auto-refresh: " + sec + "s"
    + ' | <a href="/kindle/' + tq + '">Monitor</a>'
    + ' &middot; <a href="/kindle/map' + tq + '">Map</a>'
    + "</div>"
    + "<script>"
    // ── Zoom (ES5: var, function declarations, + concatenation) ──
    // body.fontSize is the em-anchor; child sizes scale relatively.
    // Range 20-42px, step 2, base 30px.
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
