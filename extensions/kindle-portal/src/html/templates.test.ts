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

  it("renders zoom links for 25%, 50%, 100%, 200%, 400%", () => {
    const html = renderMapHtml({ mapRefreshSeconds: 300 });
    expect(html).toContain("25%</a>");
    expect(html).toContain("50%</a>");
    expect(html).toContain("100%</a>");
    expect(html).toContain("200%</a>");
    expect(html).toContain("400%</a>");
    expect(html).toContain("/kindle/map?zoom=25");
    expect(html).toContain("/kindle/map?zoom=50");
    expect(html).toContain("/kindle/map?zoom=100");
    expect(html).toContain("/kindle/map?zoom=200");
    expect(html).toContain("/kindle/map?zoom=400");
  });

  it("does not render old zoom levels (150%, 300%)", () => {
    const html = renderMapHtml({ mapRefreshSeconds: 300 });
    expect(html).not.toContain("150%");
    expect(html).not.toContain("300%");
  });

  it("marks the current zoom level as active", () => {
    const html50 = renderMapHtml({ mapRefreshSeconds: 300 }, { zoom: 50 });
    expect(html50).toContain('zoom-link active" href="/kindle/map?zoom=50');

    const html100 = renderMapHtml({ mapRefreshSeconds: 300 }, { zoom: 100 });
    expect(html100).toContain('zoom-link active" href="/kindle/map?zoom=100');
    // Non-active levels do NOT carry the active class.
    expect(html100).not.toContain('active" href="/kindle/map?zoom=50');
  });

  it("defaults to zoom=50 when no zoom provided", () => {
    const html = renderMapHtml({ mapRefreshSeconds: 300 });
    expect(html).toContain('src="/kindle/api/map.svg?zoom=50');
  });

  it("includes wiki toggle link that preserves zoom", () => {
    const html = renderMapHtml({ mapRefreshSeconds: 300 }, { zoom: 100 });
    expect(html).toContain("Wiki");
    // Toggling wiki from a zoom=100 state should keep zoom=100.
    expect(html).toContain("/kindle/map?zoom=100&wiki=1");
  });

  it("img src includes zoom param when provided", () => {
    const html = renderMapHtml({ mapRefreshSeconds: 300 }, { zoom: 200 });
    expect(html).toContain('src="/kindle/api/map.svg?zoom=200');
  });

  it("img src includes wiki=1 when wiki is enabled", () => {
    const html = renderMapHtml({ mapRefreshSeconds: 300 }, { wiki: true });
    expect(html).toContain("wiki=1");
    expect(html).toContain('src="/kindle/api/map.svg?zoom=50&wiki=1');
  });

  it("renders cognitive stats line when cognitive data provided", () => {
    const html = renderMapHtml(
      { mapRefreshSeconds: 300 },
      { cognitive: { domains: 110, insights: 50, corrections: 25, skills: 2 } },
    );
    expect(html).toContain('class="cognitive-stats"');
    expect(html).toContain("110 domains");
    expect(html).toContain("25 corrections");
    expect(html).toContain("2 skills");
  });

  it("omits cognitive stats line when no cognitive data", () => {
    const html = renderMapHtml({ mapRefreshSeconds: 300 });
    expect(html).not.toContain('<div class="cognitive-stats">');
    expect(html).not.toContain("domains \u00b7");
    expect(html).not.toContain("corrections \u00b7");
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
    expect(html).toContain("src=\"/kindle/api/map.svg?zoom=50&token=s3cret");
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

  it("page title is 'Knowledge Graph'", () => {
    const html = renderMapHtml({ mapRefreshSeconds: 300 });
    expect(html).toContain("<title>KaijiBot Knowledge Graph</title>");
    expect(html).toContain(">Knowledge Graph<");
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

  it("includes link to map page", () => {
    const html = renderMonitorHtml(emptySnapshot, cfgWithToken);
    expect(html).toContain('href="/kindle/map');
    expect(html).toContain("?token=s3cret");
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

  it("renders TOKENS TODAY and COST TODAY metrics labels", () => {
    const snap: FleetSnapshot = {
      ...emptySnapshot,
      usage: {
        totalTokens: 0,
        totalCostUsd: 0,
        sessionCount: 0,
        todayTokens: 302000,
        todayCostUsd: 0.05,
        todaySessions: 3,
      },
    };
    const html = renderMonitorHtml(snap, cfg);
    expect(html).toContain('class="metrics-row');
    expect(html).toContain("TOKENS TODAY");
    expect(html).toContain("COST TODAY");
  });

  it("formats today tokens with K suffix", () => {
    const snap: FleetSnapshot = {
      ...emptySnapshot,
      usage: {
        totalTokens: 0,
        totalCostUsd: 0,
        sessionCount: 0,
        todayTokens: 302000,
        todayCostUsd: 0,
        todaySessions: 0,
      },
    };
    const html = renderMonitorHtml(snap, cfg);
    expect(html).toContain("302K");
  });

  it("formats today cost with dollar sign and 2 decimals", () => {
    const snap: FleetSnapshot = {
      ...emptySnapshot,
      usage: {
        totalTokens: 0,
        totalCostUsd: 0,
        sessionCount: 0,
        todayTokens: 0,
        todayCostUsd: 0.05,
        todaySessions: 0,
      },
    };
    const html = renderMonitorHtml(snap, cfg);
    expect(html).toContain("$0.05");
  });

  it("renders quota bar when providerQuota is provided", () => {
    const snap: FleetSnapshot = {
      ...emptySnapshot,
      providerQuota: {
        provider: "zai",
        displayName: "ZAI",
        usedPercent: 78,
      },
    };
    const html = renderMonitorHtml(snap, cfg);
    expect(html).toContain("quota-section");
    expect(html).toContain("quota-bar");
    expect(html).toContain("quota-fill");
    expect(html).toContain("width:78%");
    expect(html).toContain("78% used");
  });

  it("renders 'Provider quota unavailable' when providerQuota is null", () => {
    const snap: FleetSnapshot = {
      ...emptySnapshot,
      providerQuota: null,
    };
    const html = renderMonitorHtml(snap, cfg);
    expect(html).toContain("Provider quota unavailable");
    expect(html).not.toContain('class="quota-fill"');
  });

  it("renders 'Provider quota unavailable' when providerQuota is undefined", () => {
    const html = renderMonitorHtml(emptySnapshot, cfg);
    expect(html).toContain("Provider quota unavailable");
    expect(html).not.toContain('class="quota-fill"');
  });

  it("agent cards always show registered agents even when idle", () => {
    const agents: RegisteredAgent[] = [
      makeRegisteredAgent({ id: "main", sessionCount: 55 }),
      makeRegisteredAgent({ id: "testagent", isDefault: false, sessionCount: 1 }),
    ];
    const html = renderMonitorHtml(emptySnapshot, cfg, agents);
    expect(html).toContain("agent-card");
    expect(html).toContain(">main<");
    expect(html).toContain(">testagent<");
    expect(html).toContain("55 sessions");
    expect(html).toContain("1 session");
  });

  it("marks registered agent as ACTIVE when snapshot has matching agentId", () => {
    const agents: RegisteredAgent[] = [
      makeRegisteredAgent({ id: "main", status: "idle" }),
    ];
    const snap = snapshotWith([makeAgent({ agentId: "main", sessionLabel: "A1" })]);
    const html = renderMonitorHtml(snap, cfg, agents);
    expect(html).toContain("\u25cf ACTIVE");
  });

  it("shows idle registered agent with IDLE marker", () => {
    const agents: RegisteredAgent[] = [
      makeRegisteredAgent({ id: "testagent", status: "idle" }),
    ];
    const html = renderMonitorHtml(emptySnapshot, cfg, agents);
    expect(html).toContain("\u25cb IDLE");
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

  it("does not contain cognitive stats display", () => {
    const html = renderMonitorHtml(emptySnapshot, cfg);
    expect(html).not.toContain("COGNITIVE STATUS");
    expect(html).not.toContain("DOMAINS");
    expect(html).not.toContain("CORRECTIONS");
    expect(html).not.toContain("SKILLS");
  });

  it("does not contain stat-bar visualization", () => {
    const html = renderMonitorHtml(emptySnapshot, cfg);
    expect(html).not.toContain("stat-bar");
    expect(html).not.toContain("stat-bar-fill");
  });

  it("does not contain lane note", () => {
    const html = renderMonitorHtml(emptySnapshot, cfg);
    expect(html).not.toContain("Lane/queue");
    expect(html).not.toContain("lane-note");
  });

  it("does not contain old AGENTS/TOKENS/COST metrics labels", () => {
    const html = renderMonitorHtml(emptySnapshot, cfg);
    expect(html).not.toContain(">AGENTS<");
    expect(html).not.toContain(">TOKENS<");
    expect(html).not.toContain(">COST<");
  });

  it("no template literals (no backticks)", () => {
    const html = renderMonitorHtml(emptySnapshot, cfg);
    expect(html).not.toContain("`");
  });
});
