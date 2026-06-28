/**
 * Shared HTML template tests for the Kindle Portal extension.
 *
 * T9: map-template tests (renderMapHtml).
 * T8: monitor-template tests (renderMonitorHtml) — added separately.
 */

import { describe, it, expect } from "vitest";
import { lintKindleHtml } from "./es5-lint.js";

// map-template will be imported once implemented
import { renderMapHtml } from "./map-template.js";
import { renderMonitorHtml } from "./monitor-template.js";
import type { FleetSnapshot, FleetAgent, RegisteredAgent } from "../types.js";

describe("renderMapHtml", () => {
  it("map html passes lintKindleHtml", () => {
    const html = renderMapHtml({ mapRefreshSeconds: 300 });
    expect(lintKindleHtml(html)).toEqual([]);
  });

  it("contains meta refresh with configured seconds", () => {
    const html = renderMapHtml({ mapRefreshSeconds: 300 });
    expect(html).toContain('http-equiv="refresh"');
    expect(html).toContain('content="300"');
  });

  it("references the SVG via an <img> tag (no inline <svg>)", () => {
    const html = renderMapHtml({ mapRefreshSeconds: 300 });
    expect(html).toContain("<img");
    expect(html).toContain('src="/kindle/api/map.svg');
    expect(html).not.toContain("<svg");
    expect(html).not.toContain("map.png");
  });

  it("renders tab bar with Monitor link and active Map span", () => {
    const html = renderMapHtml({ mapRefreshSeconds: 300 });
    expect(html).toContain('class="tabs"');
    expect(html).toContain('class="tab"');
    expect(html).toContain('class="tab tab-active"');
    expect(html).toContain(">Monitor</a>");
    expect(html).toContain(">Map</span>");
  });

  it("renders zoom links for 100%, 150%, 200%, 300%", () => {
    const html = renderMapHtml({ mapRefreshSeconds: 300 });
    expect(html).toContain("100%</a>");
    expect(html).toContain("150%</a>");
    expect(html).toContain("200%</a>");
    expect(html).toContain("300%</a>");
    expect(html).toContain("/kindle/map?zoom=100");
    expect(html).toContain("/kindle/map?zoom=150");
    expect(html).toContain("/kindle/map?zoom=200");
    expect(html).toContain("/kindle/map?zoom=300");
  });

  it("marks the current zoom level as active", () => {
    const html100 = renderMapHtml({ mapRefreshSeconds: 300 }, { zoom: 100 });
    expect(html100).toContain('zoom-link active" href="/kindle/map?zoom=100');

    const html200 = renderMapHtml({ mapRefreshSeconds: 300 }, { zoom: 200 });
    expect(html200).toContain('zoom-link active" href="/kindle/map?zoom=200');
    // Non-active levels do NOT carry the active class.
    expect(html200).not.toContain('active" href="/kindle/map?zoom=100');
  });

  it("includes wiki toggle link that preserves zoom", () => {
    const html = renderMapHtml({ mapRefreshSeconds: 300 }, { zoom: 150 });
    expect(html).toContain("Wiki");
    // Toggling wiki from a zoom=150 state should keep zoom=150.
    expect(html).toContain("/kindle/map?zoom=150&wiki=1");
  });

  it("img src includes zoom param when provided", () => {
    const html = renderMapHtml({ mapRefreshSeconds: 300 }, { zoom: 200 });
    expect(html).toContain('src="/kindle/api/map.svg?zoom=200');
  });

  it("img src includes wiki=1 when wiki is enabled", () => {
    const html = renderMapHtml({ mapRefreshSeconds: 300 }, { wiki: true });
    expect(html).toContain("wiki=1");
    expect(html).toContain('src="/kindle/api/map.svg?zoom=100&wiki=1');
  });

  it("contains NO javascript (no <script> tag, no onclick)", () => {
    const html = renderMapHtml({ mapRefreshSeconds: 300 });
    expect(html).not.toContain("<script");
    expect(html).not.toContain("</script>");
    expect(html).not.toContain("onclick");
    expect(html).not.toContain("function ");
    expect(html).not.toContain("var ");
  });

  it("contains link back to monitor via tab and footer", () => {
    const html = renderMapHtml({ mapRefreshSeconds: 300 });
    expect(html).toContain('href="/kindle/"');
    expect(html).toContain(">Monitor</a>");
  });

  it("includes accessToken in tab link and img src when configured", () => {
    const html = renderMapHtml({
      mapRefreshSeconds: 300,
      accessToken: "s3cret",
    });
    expect(html).toContain("token=s3cret");
    expect(html).toContain('href="/kindle/?token=s3cret"');
    expect(html).toContain("src=\"/kindle/api/map.svg?zoom=100&token=s3cret");
  });

  it("omits token query when accessToken undefined", () => {
    const html = renderMapHtml({ mapRefreshSeconds: 300 });
    expect(html).toContain('href="/kindle/"');
    expect(html).not.toContain("token=");
  });

  it("uses serif font stack", () => {
    const html = renderMapHtml({ mapRefreshSeconds: 300 });
    expect(html).toContain('font-family: "Bookerly"');
  });

  it("has lang attribute", () => {
    const html = renderMapHtml({ mapRefreshSeconds: 300 });
    expect(html).toContain('<html lang="en">');
  });

  it("has charset meta", () => {
    const html = renderMapHtml({ mapRefreshSeconds: 300 });
    expect(html).toContain('<meta charset="utf-8">');
  });

  it("DOCTYPE present", () => {
    const html = renderMapHtml({ mapRefreshSeconds: 300 });
    expect(html.toLowerCase().startsWith("<!doctype html>")).toBe(true);
  });

  it("mapRefreshSeconds=60 produces content='60'", () => {
    const html = renderMapHtml({ mapRefreshSeconds: 60 });
    expect(html).toContain('content="60"');
  });

  it("no template literals (no backticks)", () => {
    const html = renderMapHtml({ mapRefreshSeconds: 300 });
    expect(html).not.toContain("`");
  });

  it("img is inside a scrollable container", () => {
    const html = renderMapHtml({ mapRefreshSeconds: 300 });
    expect(html).toContain('class="scroller"');
    expect(html).toContain("overflow: auto");
  });

  it("img has no inline width style (uses natural SVG dimensions)", () => {
    const html = renderMapHtml({ mapRefreshSeconds: 300 });
    // The img tag should not set a width style — it relies on the SVG's
    // natural dimensions which change with the zoom param.
    const imgMatch = html.match(/<img[^>]*>/);
    expect(imgMatch).not.toBeNull();
    expect(imgMatch![0]).not.toContain("width:");
    expect(imgMatch![0]).not.toContain("width=");
  });
});

describe("renderMonitorHtml", () => {
  const GEN_AT = 1719500000000;
  const cfg = { refreshIntervalSeconds: 15 };
  const cfgWithToken = { refreshIntervalSeconds: 15, accessToken: "s3cret" };

  const emptySnapshot: FleetSnapshot = {
    agents: [],
    lanes: [],
    laneSupport: "unavailable",
    idle: true,
    generatedAt: GEN_AT,
  };

  function makeAgent(over: Partial<FleetAgent> = {}): FleetAgent {
    return {
      runId: "run-1",
      status: "thinking",
      toolCallCount: 0,
      startedAt: GEN_AT,
      lastEventAt: GEN_AT,
      ...over,
    };
  }

  function snapshotWith(agents: FleetAgent[], idle = false): FleetSnapshot {
    return {
      agents,
      lanes: [],
      laneSupport: "unavailable",
      idle,
      generatedAt: GEN_AT,
    };
  }

  function makeRegisteredAgent(over: Partial<RegisteredAgent> = {}): RegisteredAgent {
    return {
      id: "main",
      model: "zai/glm-5.2",
      isDefault: true,
      status: "idle",
      sessionCount: 5,
      ...over,
    };
  }

  it("monitor html passes lintKindleHtml", () => {
    const html = renderMonitorHtml(emptySnapshot, cfg);
    expect(lintKindleHtml(html)).toEqual([]);
  });

  it("renders tab bar with Monitor active and Map link", () => {
    const html = renderMonitorHtml(emptySnapshot, cfg);
    expect(html).toContain('class="tabs"');
    expect(html).toContain("tab-active");
    expect(html).toContain(">Monitor</span>");
    expect(html).toContain('href="/kindle/map');
  });

  it("renders idle state when no active agents", () => {
    const html = renderMonitorHtml(emptySnapshot, cfg);
    expect(html).toContain("IDLE");
  });

  it("renders ACTIVE when agents present", () => {
    const html = renderMonitorHtml(snapshotWith([makeAgent({ sessionLabel: "A1" })]), cfg);
    expect(html).toContain("ACTIVE");
  });

  it("status symbol mapping: thinking=■", () => {
    const html = renderMonitorHtml(snapshotWith([makeAgent({ sessionLabel: "A1", status: "thinking" })]), cfg);
    expect(html).toContain("■ THINKING");
  });

  it("status symbol mapping: tool_calling=▶", () => {
    const html = renderMonitorHtml(
      snapshotWith([makeAgent({ sessionLabel: "A1", status: "tool_calling" })]),
      cfg,
    );
    expect(html).toContain("▶ TOOL CALLING");
  });

  it("status symbol mapping: completed=✓", () => {
    const html = renderMonitorHtml(
      snapshotWith([makeAgent({ sessionLabel: "A1", status: "completed" })]),
      cfg,
    );
    expect(html).toContain("✓ COMPLETED");
  });

  it("status symbol mapping: failed=✗", () => {
    const html = renderMonitorHtml(snapshotWith([makeAgent({ sessionLabel: "A1", status: "failed" })]), cfg);
    expect(html).toContain("✗ FAILED");
  });

  it("calculates elapsed seconds from startedAt", () => {
    const snap: FleetSnapshot = {
      agents: [makeAgent({ sessionLabel: "A1", startedAt: GEN_AT - 60000 })],
      lanes: [],
      laneSupport: "unavailable",
      idle: false,
      generatedAt: GEN_AT,
    };
    const html = renderMonitorHtml(snap, cfg);
    expect(html).toContain("60s ago");
  });

  it("renders lane-unavailable note", () => {
    const html = renderMonitorHtml(emptySnapshot, cfg);
    expect(html).toContain("Lane/queue depth unavailable");
  });

  it("includes XHR polling script with configured interval", () => {
    const html = renderMonitorHtml(emptySnapshot, { refreshIntervalSeconds: 15 });
    expect(html).toContain("15000");
    expect(html).toContain("XMLHttpRequest");
  });

  it("includes accessToken in polling URL when configured", () => {
    const html = renderMonitorHtml(emptySnapshot, cfgWithToken);
    expect(html).toContain("?token=s3cret");
    expect(html).toContain("/kindle/api/fleet");
  });

  it("omits token when accessToken undefined", () => {
    const html = renderMonitorHtml(emptySnapshot, cfg);
    expect(html).toContain('"/kindle/api/fleet"');
    expect(html).not.toContain("?token");
  });

  it("renders cost with 4 decimal places", () => {
    const html = renderMonitorHtml(
      snapshotWith([makeAgent({ sessionLabel: "A1", estimatedCostUsd: 0.04321 })]),
      cfg,
    );
    expect(html).toContain("0.0432");
  });

  it("renders 'unknown' for missing model", () => {
    const html = renderMonitorHtml(snapshotWith([makeAgent({ sessionLabel: "A1" })]), cfg);
    expect(html).toContain("Model: unknown");
  });

  it("includes link to map page", () => {
    const html = renderMonitorHtml(emptySnapshot, cfgWithToken);
    expect(html).toContain('href="/kindle/map');
    expect(html).toContain("?token=s3cret");
  });

  it("includes pngCapability in footer", () => {
    const snap: FleetSnapshot = { ...emptySnapshot, pngCapability: "graphviz-dot" };
    const html = renderMonitorHtml(snap, cfg);
    expect(html).toContain("graphviz-dot");
  });

  it("renders zoom buttons A- and A+", () => {
    const html = renderMonitorHtml(emptySnapshot, cfg);
    expect(html).toContain("A-");
    expect(html).toContain("A+");
  });

  it("declares zoomIn and zoomOut JS functions", () => {
    const html = renderMonitorHtml(emptySnapshot, cfg);
    expect(html).toContain("function zoomIn");
    expect(html).toContain("function zoomOut");
  });

  it("DOCTYPE and charset present", () => {
    const html = renderMonitorHtml(emptySnapshot, cfg);
    expect(html.toLowerCase().startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('<meta charset="utf-8">');
  });

  it("uses serif font stack in CSS", () => {
    const html = renderMonitorHtml(emptySnapshot, cfg);
    expect(html).toContain('font-family: "Bookerly"');
  });

  it("uses 30px base font", () => {
    const html = renderMonitorHtml(emptySnapshot, cfg);
    expect(html).toContain("font-size: 30px");
  });

  it("declares zoomLevel starting at 30", () => {
    const html = renderMonitorHtml(emptySnapshot, cfg);
    expect(html).toContain("var zoomLevel = 30;");
  });

  it("renders usage metrics row with AGENTS, TOKENS, COST labels", () => {
    const html = renderMonitorHtml(snapshotWith([makeAgent({ sessionLabel: "A1" })]), cfg);
    expect(html).toContain('class="metrics-row');
    expect(html).toContain("AGENTS");
    expect(html).toContain("TOKENS");
    expect(html).toContain("COST");
  });

  it("renders COGNITIVE STATUS, AGENTS, and ACTIVE SESSIONS section headers", () => {
    const html = renderMonitorHtml(emptySnapshot, cfg);
    expect(html).toContain("COGNITIVE STATUS");
    expect(html).toContain("AGENTS");
    expect(html).toContain("ACTIVE SESSIONS");
    expect(html).toContain("section-h");
  });

  it("renders cognitive stat counts and labels", () => {
    const html = renderMonitorHtml(emptySnapshot, cfg);
    expect(html).toContain("DOMAINS");
    expect(html).toContain("CORRECTIONS");
    expect(html).toContain("SKILLS");
  });

  it("renders stat-bar for cognitive visualization", () => {
    const html = renderMonitorHtml(emptySnapshot, cfg);
    expect(html).toContain("stat-bar");
    expect(html).toContain("stat-bar-fill");
  });

  it("renders 'No active sessions' when no active runs", () => {
    const html = renderMonitorHtml(emptySnapshot, cfg);
    expect(html).toContain("No active sessions");
  });

  it("shows registered agent IDs, not UUIDs", () => {
    const agents: RegisteredAgent[] = [
      makeRegisteredAgent({ id: "main", sessionCount: 42 }),
      makeRegisteredAgent({ id: "testagent", isDefault: false, sessionCount: 1 }),
    ];
    const html = renderMonitorHtml(emptySnapshot, cfg, agents);
    expect(html).toContain("main");
    expect(html).toContain("testagent");
    expect(html).not.toContain("f6fecfcf");
    expect(html).not.toContain("run-1");
  });

  it("marks registered agent as ACTIVE when snapshot has matching agentId", () => {
    const agents: RegisteredAgent[] = [
      makeRegisteredAgent({ id: "main", status: "idle" }),
    ];
    const snap = snapshotWith([makeAgent({ agentId: "main", sessionLabel: "A1" })]);
    const html = renderMonitorHtml(snap, cfg, agents);
    expect(html).toContain("● ACTIVE");
  });

  it("shows idle registered agent with ○ IDLE", () => {
    const agents: RegisteredAgent[] = [
      makeRegisteredAgent({ id: "testagent", status: "idle" }),
    ];
    const html = renderMonitorHtml(emptySnapshot, cfg, agents);
    expect(html).toContain("○ IDLE");
  });

  it("renders session count for registered agents", () => {
    const agents: RegisteredAgent[] = [
      makeRegisteredAgent({ id: "main", sessionCount: 42 }),
    ];
    const html = renderMonitorHtml(emptySnapshot, cfg, agents);
    expect(html).toContain("42 sessions");
  });

  it("renders '1 session' singular for single-session agent", () => {
    const agents: RegisteredAgent[] = [
      makeRegisteredAgent({ id: "testagent", sessionCount: 1 }),
    ];
    const html = renderMonitorHtml(emptySnapshot, cfg, agents);
    expect(html).toContain("1 session");
  });

  it("renders relative time for lastActiveAt", () => {
    const agents: RegisteredAgent[] = [
      makeRegisteredAgent({ id: "main", lastActiveAt: Date.now() - 120000 }),
    ];
    const html = renderMonitorHtml(emptySnapshot, cfg, agents);
    expect(html).toContain("ago");
  });

  it("does not show runId UUIDs when agentId is available", () => {
    const snap = snapshotWith([
      makeAgent({ runId: "f6fecfcf-uuid-1234", agentId: "main", sessionLabel: "A1" }),
    ]);
    const html = renderMonitorHtml(snap, cfg);
    expect(html).toContain("main");
    expect(html).not.toContain("f6fecfcf");
  });
});
