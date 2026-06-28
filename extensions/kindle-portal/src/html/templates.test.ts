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
import type { FleetSnapshot, FleetAgent, MapGraph } from "../types.js";

describe("renderMapHtml", () => {
  const emptyGraph: MapGraph = { nodes: [], edges: [] };

  const sampleGraph: MapGraph = {
    nodes: [
      { id: "ai", label: "AI", kind: "domain", strength: 0.8 },
      { id: "rust", label: "Rust", kind: "domain", strength: 0.6 },
      {
        id: "embedding",
        label: "Vector Embeddings",
        kind: "concept",
        strength: 0.5,
      },
    ],
    edges: [{ from: "ai", to: "rust", label: "related" }],
  };

  it("map html passes lintKindleHtml", () => {
    const html = renderMapHtml(sampleGraph, { mapRefreshSeconds: 300 });
    expect(lintKindleHtml(html)).toEqual([]);
  });

  it("contains meta refresh with configured seconds", () => {
    const html = renderMapHtml(sampleGraph, { mapRefreshSeconds: 300 });
    expect(html).toContain('http-equiv="refresh"');
    expect(html).toContain('content="300"');
  });

  it("embeds an inline SVG (no img / no map.png reference)", () => {
    const html = renderMapHtml(sampleGraph, { mapRefreshSeconds: 300 });
    expect(html).toContain("<svg");
    expect(html).not.toContain("map.png");
    expect(html).not.toContain("<img");
  });

  it("svg carries a viewBox attribute (enables JS zoom)", () => {
    const html = renderMapHtml(sampleGraph, { mapRefreshSeconds: 300 });
    expect(html).toContain("viewBox");
  });

  it("svg contains a domain-layer group (renderMapGraphSvg output)", () => {
    const html = renderMapHtml(sampleGraph, { mapRefreshSeconds: 300 });
    expect(html).toContain('<g id="domain-layer"');
  });

  it("renders zoom buttons A- and A+", () => {
    const html = renderMapHtml(sampleGraph, { mapRefreshSeconds: 300 });
    expect(html).toContain("A-");
    expect(html).toContain("A+");
  });

  it("exposes a wiki toggle calling toggleWiki()", () => {
    const html = renderMapHtml(sampleGraph, { mapRefreshSeconds: 300 });
    expect(html).toContain("toggleWiki");
  });

  it("contains link back to monitor", () => {
    const html = renderMapHtml(sampleGraph, { mapRefreshSeconds: 300 });
    expect(html).toContain('href="/kindle/');
  });

  it("includes accessToken in monitor link when configured", () => {
    const html = renderMapHtml(sampleGraph, {
      mapRefreshSeconds: 300,
      accessToken: "s3cret",
    });
    expect(html).toContain("?token=s3cret");
  });

  it("omits token query when accessToken undefined", () => {
    const html = renderMapHtml(sampleGraph, { mapRefreshSeconds: 300 });
    expect(html).toContain('href="/kindle/"');
  });

  it("uses serif font stack", () => {
    const html = renderMapHtml(sampleGraph, { mapRefreshSeconds: 300 });
    expect(html).toContain('font-family: "Bookerly"');
  });

  it("has lang attribute", () => {
    const html = renderMapHtml(sampleGraph, { mapRefreshSeconds: 300 });
    expect(html).toContain('<html lang="en">');
  });

  it("has charset meta", () => {
    const html = renderMapHtml(sampleGraph, { mapRefreshSeconds: 300 });
    expect(html).toContain('<meta charset="utf-8">');
  });

  it("DOCTYPE present", () => {
    const html = renderMapHtml(sampleGraph, { mapRefreshSeconds: 300 });
    expect(html.toLowerCase().startsWith("<!doctype html>")).toBe(true);
  });

  it("mapRefreshSeconds=60 produces content='60'", () => {
    const html = renderMapHtml(sampleGraph, { mapRefreshSeconds: 60 });
    expect(html).toContain('content="60"');
  });

  it("no template literals (no backticks)", () => {
    const html = renderMapHtml(sampleGraph, { mapRefreshSeconds: 300 });
    expect(html).not.toContain("`");
  });

  it("renders node counts in footer", () => {
    const html = renderMapHtml(sampleGraph, { mapRefreshSeconds: 300 });
    expect(html).toContain("2 domains");
    expect(html).toContain("1 wiki nodes");
    expect(html).toContain("1 edges");
  });

  it("empty graph still renders valid lint-clean html", () => {
    const html = renderMapHtml(emptyGraph, { mapRefreshSeconds: 300 });
    expect(lintKindleHtml(html)).toEqual([]);
    expect(html).toContain("<svg");
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

  it("monitor html passes lintKindleHtml", () => {
    const html = renderMonitorHtml(emptySnapshot, cfg);
    expect(lintKindleHtml(html)).toEqual([]);
  });

  it("renders idle state when no active agents", () => {
    const html = renderMonitorHtml(emptySnapshot, cfg);
    expect(html).toContain("No active agents");
    expect(html).toContain("IDLE");
  });

  it("renders ACTIVE when agents present", () => {
    const html = renderMonitorHtml(snapshotWith([makeAgent({ sessionLabel: "A1" })]), cfg);
    expect(html).toContain("ACTIVE");
  });

  it("renders 3 agent cards for 3-agent snapshot", () => {
    const snap = snapshotWith([
      makeAgent({ runId: "r1", sessionLabel: "Agent 1" }),
      makeAgent({ runId: "r2", sessionLabel: "Agent 2" }),
      makeAgent({ runId: "r3", sessionLabel: "Agent 3" }),
    ]);
    const html = renderMonitorHtml(snap, cfg);
    expect(html).toContain("Agent 1");
    expect(html).toContain("Agent 2");
    expect(html).toContain("Agent 3");
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

  it("truncates long session labels with ellipsis", () => {
    const longLabel = "A".repeat(50);
    const html = renderMonitorHtml(snapshotWith([makeAgent({ sessionLabel: longLabel })]), cfg);
    expect(html).toContain("A".repeat(40) + "...");
    expect(html).not.toContain(longLabel);
  });

  it("prepends [STALE] for stale agents", () => {
    const html = renderMonitorHtml(snapshotWith([makeAgent({ sessionLabel: "A1", stale: true })]), cfg);
    expect(html).toContain("[STALE]");
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
});
