/**
 * Live fleet monitor HTML template for Kindle Portal.
 *
 * Renders an ES5-compatible page showing active KaijiBot agents. Auto-refreshes
 * via XHR polling (`setInterval` + `XMLHttpRequest`) with a `<meta http-equiv
 * =refresh>` fallback. Under Option A (pure plugin boundary) the lane/queue
 * depth is always unavailable, so a static note replaces the lane panel.
 *
 * All HTML/script is built with `+` concatenation — no template literals — so
 * the rendered output passes `lintKindleHtml` (no backticks, no `=>`, no
 * `const`/`let`, no `fetch`).
 *
 * E-ink visual hierarchy:
 *   - Header bar: 22px title + A-/A+ zoom buttons (float right) + meta line
 *     with generated time, active count, and an ■ ACTIVE / ○ IDLE badge.
 *   - Each agent is a card with a status accent bar (4px left border for
 *     thinking/tool_calling/failed), name + status badge, body rows, and
 *     a foot line. Status uses Unicode geometric symbols (■ ▶ ✓ ✗).
 *   - Body fontSize is the zoom anchor; child sizes use em so zoom scales
 *     the whole page uniformly.
 */

import type { FleetSnapshot, FleetAgent } from "../types.js";
import type { KindleConfig } from "../config.js";
import { SHARED_CSS } from "./shared-css.js";

/**
 * Unicode geometric status symbol prefix. No emoji — they render as `[]` on
 * Kindle. Geometric glyphs are reliably available on the e-ink system fonts
 * and stay legible at every zoom step.
 *   thinking     → ■  filled square (solid, working)
 *   tool_calling → ▶  right triangle (active, forward motion)
 *   completed    → ✓  checkmark (done)
 *   failed       → ✗  ballot X (error)
 */
const STATUS_SYMBOLS: Record<FleetAgent["status"], string> = {
  thinking: "■",
  tool_calling: "▶",
  completed: "✓",
  failed: "✗",
};

/**
 * Truncate a display name to 40 chars, appending "..." when truncated.
 */
function truncateName(name: string): string {
  if (name.length > 40) {
    return name.substring(0, 40) + "...";
  }
  return name;
}

/**
 * Resolve an agent's display name from its richest available label, truncate
 * to the viewport-safe width, and prepend "[STALE] " for degraded runs.
 */
function agentDisplayName(agent: FleetAgent): string {
  var base = agent.sessionLabel ?? agent.sessionKey ?? agent.runId;
  var truncated = truncateName(base);
  if (agent.stale) {
    return "[STALE] " + truncated;
  }
  return truncated;
}

/**
 * Uppercase a status with underscores replaced by spaces ("tool_calling" →
 * "TOOL CALLING").
 */
function statusLabel(status: FleetAgent["status"]): string {
  return status.replace(/_/g, " ").toUpperCase();
}

/**
 * Render a single agent card as an HTML fragment (no trailing newline).
 *
 * Layout:
 *   <div class="card status-<status>">   ← accent bar + weight modifier
 *     <div class="card-head clearfix">
 *       <div class="status-badge">...</div>   ← floated right
 *       <div class="card-name">...</div>
 *     </div>
 *     <div class="card-body">Model / Tool rows</div>
 *     <div class="card-foot">elapsed | tokens | cost</div>
 *   </div>
 *
 * The status-icon span wraps both symbol and label so the substring
 * "■ THINKING" (etc.) appears contiguous in the rendered HTML — tests and
 * in-page search both rely on that.
 */
function renderAgentCard(agent: FleetAgent, generatedAt: number): string {
  var name = agentDisplayName(agent);
  var sym = STATUS_SYMBOLS[agent.status];
  var label = statusLabel(agent.status);
  var model = agent.model ?? "unknown";
  var toolName = agent.toolName ?? "—";
  var toolCallCount = String(agent.toolCallCount);
  var elapsedSeconds = String(Math.max(0, Math.round((generatedAt - agent.startedAt) / 1000)));
  var totalTokens = agent.totalTokens !== undefined ? String(agent.totalTokens) : "—";
  var cost = agent.estimatedCostUsd !== undefined ? agent.estimatedCostUsd.toFixed(4) : "—";

  return '<div class="card status-' + agent.status + '">'
    + '<div class="card-head clearfix">'
    + '<div class="status-badge"><span class="status-icon">'
    + sym + " " + label + "</span></div>"
    + '<div class="card-name">' + name + "</div>"
    + "</div>"
    + '<div class="card-body">'
    + '<div class="card-row">Model: ' + model + "</div>"
    + '<div class="card-row">Tool: ' + toolName + " (calls: " + toolCallCount + ")</div>"
    + "</div>"
    + '<div class="card-foot">'
    + elapsedSeconds + "s ago"
    + " | Tokens: " + totalTokens
    + " | Cost: $" + cost
    + "</div>"
    + "</div>";
}

/**
 * Build the live-monitor HTML page for a fleet snapshot.
 *
 * The page reloads itself on a configured interval via XHR polling; the
 * `<meta http-equiv="refresh">` is a no-JS fallback. All string assembly uses
 * `+` so the output stays ES5/old-WebKit clean.
 *
 * Zoom: `zoomIn()` / `zoomOut()` step `document.body.style.fontSize` in 2px
 * increments across the 14px–28px range. Because every child font-size is
 * declared in `em`, the whole page scales uniformly.
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
  // Filled square for ACTIVE (something is running), hollow circle for IDLE.
  var stateIcon = isActive ? "■" : "○";
  var stateText = isActive ? "ACTIVE" : "IDLE";
  // Re-use status-* class names so the badge picks up weight/color variants.
  var stateClass = isActive ? "thinking" : "completed";
  var pngCap = snapshot.pngCapability ?? "unknown";

  // Agent cards or empty state.
  var cards: string;
  if (snapshot.agents.length === 0) {
    cards = '<div class="empty">No active agents.</div>';
  } else {
    var parts: string[] = [];
    for (var i = 0; i < snapshot.agents.length; i++) {
      parts.push(renderAgentCard(snapshot.agents[i], snapshot.generatedAt));
    }
    cards = parts.join("");
  }

  // XHR polling interval in milliseconds.
  var refreshMs = String(cfg.refreshIntervalSeconds * 1000);

  return "<!DOCTYPE html>"
    + '<html lang="en">'
    + "<head>"
    + '<meta charset="utf-8">'
    + '<meta http-equiv="refresh" content="' + sec + '">'
    + "<title>KaijiBot Fleet Monitor</title>"
    + "<style>" + SHARED_CSS + "</style>"
    + "</head>"
    + "<body>"
    // Header bar: zoom buttons float right, title and meta flow on the left.
    + '<div class="header clearfix">'
    + '<div class="zoom-bar">'
    + '<button type="button" class="zoom-btn" onclick="zoomOut()">A-</button>'
    + '<button type="button" class="zoom-btn" onclick="zoomIn()">A+</button>'
    + "</div>"
    + '<div class="title">KaijiBot Fleet Monitor</div>'
    + '<div class="meta">Generated: ' + iso
    + " | Active: " + activeCount
    + ' | <span class="badge"><span class="status-icon">'
    + stateIcon + "</span> "
    + '<span class="status-' + stateClass + '">' + stateText + "</span></span></div>"
    + "</div>"
    + '<div class="nav"><a href="/kindle/map' + tq + '">Cognitive Map</a></div>'
    + '<div class="lane-note">Lane/queue depth unavailable (plugin-boundary).</div>'
    + cards
    + '<div class="footer">'
    + "PNG renderer: " + pngCap + " | Auto-refresh: " + sec + "s"
    + "</div>"
    + "<script>"
    // ── Zoom (ES5: var, function declarations, + concatenation) ──
    // body.fontSize is the em-anchor; child sizes scale relatively.
    + "var zoomLevel = 18;"
    + "function zoomIn() {"
    + "if (zoomLevel < 28) {"
    + "zoomLevel = zoomLevel + 2;"
    + 'document.body.style.fontSize = zoomLevel + "px";'
    + "}"
    + "}"
    + "function zoomOut() {"
    + "if (zoomLevel > 14) {"
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
