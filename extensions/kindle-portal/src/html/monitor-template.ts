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
 */

import type { FleetSnapshot, FleetAgent } from "../types.js";
import type { KindleConfig } from "../config.js";
import { SHARED_CSS } from "./shared-css.js";

/**
 * ASCII status symbol prefix. No emoji — they render as `[]` on Kindle.
 * Weight + symbol differentiate states since the palette is pure B/W.
 */
const STATUS_SYMBOLS: Record<FleetAgent["status"], string> = {
  thinking: "...",
  tool_calling: ">",
  completed: "OK",
  failed: "X",
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

  return '<div class="card">'
    + '<div class="card-id">' + name + "</div>"
    + '<div class="card-row"><span class="status-' + agent.status + '">'
    + sym + " " + label + "</span></div>"
    + '<div class="card-row">Model: ' + model + "</div>"
    + '<div class="card-row">Tool: ' + toolName + " (calls: " + toolCallCount + ")</div>"
    + '<div class="card-row">Started: ' + elapsedSeconds + "s ago</div>"
    + '<div class="card-row">Tokens: ' + totalTokens + " | Cost: $" + cost + "</div>"
    + "</div>";
}

/**
 * Build the live-monitor HTML page for a fleet snapshot.
 *
 * The page reloads itself on a configured interval via XHR polling; the
 * `<meta http-equiv="refresh">` is a no-JS fallback. All string assembly uses
 * `+` so the output stays ES5/old-WebKit clean.
 */
export function renderMonitorHtml(
  snapshot: FleetSnapshot,
  cfg: Pick<KindleConfig, "refreshIntervalSeconds" | "accessToken">,
): string {
  var sec = String(cfg.refreshIntervalSeconds);
  var tq = cfg.accessToken ? "?token=" + cfg.accessToken : "";
  var iso = new Date(snapshot.generatedAt).toISOString().substring(0, 19) + "Z";
  var activeCount = String(snapshot.agents.length);
  var idleClass = snapshot.idle ? "completed" : "thinking";
  var idleText = snapshot.idle ? "IDLE" : "ACTIVE";
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
    + '<div class="header clearfix">'
    + '<div class="title">KaijiBot Fleet Monitor</div>'
    + '<div class="meta">Generated: ' + iso + " | Active: " + activeCount
    + ' | <span class="status-' + idleClass + '">' + idleText + "</span></div>"
    + "</div>"
    + '<div class="nav"><a href="/kindle/map' + tq + '">Cognitive Map</a></div>'
    + '<div class="lane-note">Lane/queue depth unavailable (plugin-boundary).</div>'
    + cards
    + '<div class="footer">'
    + "PNG renderer: " + pngCap + " | Auto-refresh: " + sec + "s"
    + "</div>"
    + "<script>"
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
