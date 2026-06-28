/**
 * Live fleet monitor dashboard HTML template for Kindle Portal.
 *
 * Renders an ES5-compatible dashboard for a Kindle Paperwhite 7th gen placed
 * below a computer monitor at ~60-80cm viewing distance. Body base is 22px
 * with every child size in `em`, so the A-/A+ zoom buttons (which step
 * `document.body.style.fontSize` across 16-32px) scale the whole page.
 *
 * Layout (float-based — old WebKit has no flexbox):
 *   1. Header: title + ◉ ACTIVE / ○ IDLE badge + A-/A+ zoom (float right)
 *   2. Metrics row: three floated boxes (AGENTS / TOKENS / COST)
 *   3. ACTIVE AGENTS section: agent cards or an "all quiet" empty state
 *   4. COGNITIVE MAP section: domain/insight/skill/correction counts + link
 *   5. Footer: PNG renderer capability + refresh note + nav links
 *
 * The page reloads itself via XHR polling (`setInterval` + XMLHttpRequest)
 * with a `<meta http-equiv="refresh">` no-JS fallback.
 *
 * All HTML/script is built with `+` concatenation — no template literals —
 * so the rendered output passes `lintKindleHtml` (no backticks, no `=>`, no
 * `const`/`let`, no `fetch`). Status uses Unicode geometric symbols
 * (■ ▶ ✓ ✗) that render reliably on the e-ink system fonts.
 */

import type { FleetSnapshot, FleetAgent } from "../types.js";
import type { KindleConfig } from "../config.js";
import { SHARED_CSS } from "./shared-css.js";

const STATUS_SYMBOLS: Record<FleetAgent["status"], string> = {
  thinking: "■",
  tool_calling: "▶",
  completed: "✓",
  failed: "✗",
};

function truncateName(name: string): string {
  if (name.length > 40) {
    return name.substring(0, 40) + "...";
  }
  return name;
}

function agentDisplayName(agent: FleetAgent): string {
  var base = agent.sessionLabel ?? agent.sessionKey ?? agent.runId;
  var truncated = truncateName(base);
  if (agent.stale) {
    return "[STALE] " + truncated;
  }
  return truncated;
}

function statusLabel(status: FleetAgent["status"]): string {
  return status.replace(/_/g, " ").toUpperCase();
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

function renderAgentCard(agent: FleetAgent, generatedAt: number): string {
  var name = agentDisplayName(agent);
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
 * Build the dashboard HTML page for a fleet snapshot.
 *
 * When `snapshot.usage` or `snapshot.cognitive` are undefined (e.g. in test
 * snapshots without the /api/fleet enrichment), the corresponding metrics
 * render "—" and cognitive counts render 0.
 */
export function renderMonitorHtml(
  snapshot: FleetSnapshot,
  cfg: Pick<KindleConfig, "refreshIntervalSeconds" | "accessToken">,
): string {
  var sec = String(cfg.refreshIntervalSeconds);
  var tq = cfg.accessToken ? "?token=" + cfg.accessToken : "";
  var iso = new Date(snapshot.generatedAt).toISOString().substring(0, 19) + "Z";
  var activeCount = String(snapshot.agents.length);
  var isActive = !snapshot.idle;
  // Filled circle for ACTIVE (something running), hollow circle for IDLE.
  var stateIcon = isActive ? "◉" : "○";
  var stateText = isActive ? "ACTIVE" : "IDLE";
  var pngCap = snapshot.pngCapability ?? "unknown";

  // Aggregate usage metrics (undefined in un-enriched snapshots).
  var usage = snapshot.usage;
  var tokensStr = usage && usage.totalTokens ? formatTokens(usage.totalTokens) : "—";
  var costStr = usage && usage.estimatedCostUsd !== undefined
    ? "$" + usage.estimatedCostUsd.toFixed(2)
    : "—";

  // Cognitive stats (undefined in un-enriched snapshots -> 0).
  var cog = snapshot.cognitive;
  var domainsN = cog ? String(cog.domains) : "0";
  var insightsN = cog ? String(cog.insights) : "0";
  var skillsN = cog ? String(cog.skills) : "0";
  var correctionsN = cog ? String(cog.corrections) : "0";

  // Agent cards or empty state.
  var cards: string;
  if (snapshot.agents.length === 0) {
    cards = '<div class="empty">○ All quiet. No active agents.</div>';
  } else {
    var parts: string[] = [];
    for (var i = 0; i < snapshot.agents.length; i++) {
      parts.push(renderAgentCard(snapshot.agents[i], snapshot.generatedAt));
    }
    cards = parts.join("");
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
    // ── Header bar: zoom floats right, title + meta flow on the left ──
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
    // ── Metrics row: three floated boxes ──
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
    // ── Active agents section ──
    + '<div class="section">'
    + '<div class="section-h">ACTIVE AGENTS</div>'
    + cards
    + "</div>"
    // ── Cognitive map section ──
    + '<div class="section">'
    + '<div class="section-h">COGNITIVE MAP</div>'
    + '<div class="card-detail">'
    + domainsN + " domains · " + insightsN + " insights · "
    + skillsN + " skills · " + correctionsN + " corrections"
    + "</div>"
    + '<div class="nav"><a href="/kindle/map' + tq + '">View cognitive map &rarr;</a></div>'
    + "</div>"
    // ── Lane note (always unavailable under plugin boundary) ──
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
    + "var zoomLevel = 22;"
    + "function zoomIn() {"
    + "if (zoomLevel < 32) {"
    + "zoomLevel = zoomLevel + 2;"
    + 'document.body.style.fontSize = zoomLevel + "px";'
    + "}"
    + "}"
    + "function zoomOut() {"
    + "if (zoomLevel > 16) {"
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
