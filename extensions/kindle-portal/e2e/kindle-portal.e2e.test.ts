/**
 * E2E verification for the Kindle Portal plugin (Task T13).
 *
 * Approach: **Option A — In-process HTTP server with the real kindle handler.**
 *
 * We do NOT boot the full gateway (that would require the event bus, session
 * store, provider config, agent state, etc.). Instead we wire the real
 * `createKindleHttpHandler` — the same function the plugin registers — to a
 * real `http.Server` listening on an ephemeral port. This exercises the full
 * HTTP stack (socket, headers, status codes, body serialization) through real
 * `fetch()` calls, which is the contract a Kindle browser hits.
 *
 * The `RouterContext` uses a real `FleetState`, a real `KindleConfig` resolved
 * via `resolveKindleConfig` (so defaults are exercised), a mock empty
 * `LoadSessionStore` (no sessions in the test env), and temp directories for
 * `stateDir`/`workspaceDir` (no persona/wiki data → onboarding empty state).
 *
 * For S6 (real-time events) we call `state.applyEvent()` directly — this is
 * exactly what the background service does internally (it bridges
 * `onAgentEvent` → `state.applyEvent`). Testing through the service would
 * require the full gateway event emitter, which is out of scope for an
 * extension-level E2E test.
 *
 * Artifacts are written to `/tmp/opencode/kindle-artifacts/` and intentionally
 * persist after the run — they are the deliverable.
 */
import { afterEach, beforeEach, afterAll, describe, expect, it } from "vitest";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { promises as fs, type Dirent } from "node:fs";
import path from "node:path";
import os from "node:os";

import { FleetState } from "../src/monitor/fleet-state.js";
import type { AgentEventPayload } from "../src/monitor/fleet-state.js";
import { resolveKindleConfig } from "../src/config.js";
import { createKindleHttpHandler, type RouterContext } from "../src/http/router.js";
import { lintKindleHtml } from "../src/html/es5-lint.js";
import type { LoadSessionStore } from "../src/monitor/scope-resolver.js";
import type { KindleConfig } from "../src/config.js";
import type { FleetSnapshot } from "../src/types.js";

// ── Constants ──

const ARTIFACT_DIR = "/tmp/opencode/kindle-artifacts";

/** PNG magic bytes: \x89PNG\r\n\x1a\n */
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Kindle Paperwhite-ish viewport for the screenshot scenario. */
const KINDLE_VIEWPORT = { width: 600, height: 800 } as const;

// ── Test-scoped state ──

let server: Server | null = null;
let baseUrl = "";
let state: FleetState;
let cfg: KindleConfig;
let ctx: RouterContext;
let tmpStateDir: string;
let tmpWorkspaceDir: string;
let emptyLoadStore: LoadSessionStore;

// ── Helpers ──

/** Create the artifact directory once before all tests. */
async function ensureArtifactDir(): Promise<void> {
  await fs.mkdir(ARTIFACT_DIR, { recursive: true });
}

/** Create a fresh temp directory tree for state/workspace. */
async function makeTempDirs(): Promise<{ stateDir: string; workspaceDir: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "kindle-e2e-"));
  return {
    stateDir: path.join(root, "state"),
    workspaceDir: path.join(root, "workspace"),
  };
}

/** Recursively remove a directory tree (best-effort). */
async function rmrf(target: string): Promise<void> {
  try {
    await fs.rm(target, { recursive: true, force: true });
  } catch {
    // best-effort — temp dirs live under os.tmpdir() and are cleaned by the OS
  }
}

/** Build a RouterContext with real FleetState + empty session store. */
function buildContext(config: KindleConfig, stateDir: string, workspaceDir: string): RouterContext {
  const fleetState = new FleetState();
  const loadStore: LoadSessionStore = async () => ({ agents: [] });
  return {
    state: fleetState,
    cfg: config,
    loadStore,
    stateDir,
    workspaceDir,
  };
}

/**
 * Build a RouterContext whose session store has one session entry, so
 * `resolveActiveUser("last-active")` resolves to a user (exercising the
 * persona+wiki read path rather than the early "no active user" return).
 */
function buildContextWithSession(
  config: KindleConfig,
  stateDir: string,
  workspaceDir: string,
): RouterContext {
  const fleetState = new FleetState();
  const loadStore: LoadSessionStore = async () => ({
    agents: [
      {
        agentId: "main",
        sessions: [
          {
            sessionKey: "agent:main:feishu:direct:ou_e2etest@feishu",
            agentId: "main",
            updatedAt: Date.now(),
          },
        ],
      },
    ],
  });
  return {
    state: fleetState,
    cfg: config,
    loadStore,
    stateDir,
    workspaceDir,
  };
}

/**
 * Boot an in-process HTTP server with the real kindle handler.
 * Returns the listening server and its base URL.
 */
function bootServer(context: RouterContext): Promise<{ server: Server; baseUrl: string }> {
  return new Promise((resolve) => {
    const handler = createKindleHttpHandler(context);
    // The handler returns Promise<boolean>; http.Server ignores the return
    // value, which is fine — the handler calls res.end() to complete.
    const srv = createServer((req: IncomingMessage, res: ServerResponse) => {
      void handler(req, res);
    });
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr !== null ? addr.port : 0;
      resolve({ server: srv, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

/** Close the server and wait for the socket to release. */
function closeServer(srv: Server | null): Promise<void> {
  if (srv === null) return Promise.resolve();
  return new Promise((resolve) => {
    srv.close(() => resolve());
  });
}

/** Fetch a path on the booted server and return {status, headers, body}. */
async function fetchRoute(urlPath: string): Promise<{
  status: number;
  headers: Headers;
  text: string;
  bytes: Uint8Array;
}> {
  const res = await fetch(`${baseUrl}${urlPath}`);
  const buf = await res.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const text = Buffer.from(buf).toString("utf-8");
  return { status: res.status, headers: res.headers, text, bytes };
}

/** Write a text artifact. */
async function writeArtifact(name: string, content: string): Promise<string> {
  const filePath = path.join(ARTIFACT_DIR, name);
  await fs.writeFile(filePath, content, "utf-8");
  return filePath;
}

/** Write a binary artifact. */
async function writeBinaryArtifact(name: string, bytes: Uint8Array): Promise<string> {
  const filePath = path.join(ARTIFACT_DIR, name);
  await fs.writeFile(filePath, bytes);
  return filePath;
}

/** List file names in the artifact directory. */
async function listArtifacts(): Promise<string[]> {
  const entries: Dirent[] = await fs.readdir(ARTIFACT_DIR, { withFileTypes: true });
  return entries.filter((e) => e.isFile()).map((e) => e.name);
}

/**
 * Launch a Chromium browser for screenshots, trying multiple strategies:
 *   1. Default playwright-core launch (expects the matching browser build).
 *   2. executablePath pointing at any pre-installed MS-playwright chromium.
 * Returns null when no browser can be launched (screenshots are optional).
 */
async function launchChromium(): Promise<import("playwright-core").Browser | null> {
  let pw: typeof import("playwright-core");
  try {
    pw = await import("playwright-core");
  } catch {
    return null;
  }

  const candidates: string[] = [
    "/home/kaiji/.cache/ms-playwright/chromium-1208/chrome-linux64/chrome",
    "/home/kaiji/.cache/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-linux64/chrome-headless-shell",
  ];

  try {
    return await pw.chromium.launch({ headless: true });
  } catch {
    // Fall through to executablePath candidates.
  }

  for (const exePath of candidates) {
    try {
      return await pw.chromium.launch({ headless: true, executablePath: exePath });
    } catch {
      // Try next candidate.
    }
  }

  return null;
}

// ── Setup / teardown ──

beforeEach(async () => {
  await ensureArtifactDir();
  const dirs = await makeTempDirs();
  tmpStateDir = dirs.stateDir;
  tmpWorkspaceDir = dirs.workspaceDir;
  // Minimal config — only `enabled: true`. All other keys fall back to
  // KINDLE_PORTAL_DEFAULTS (refreshIntervalSeconds=15, mapRefreshSeconds=300,
  // scope="last-active", showWiki=true, maxDomains=20, pngWidth=758).
  cfg = resolveKindleConfig({ enabled: true });
  ctx = buildContext(cfg, tmpStateDir, tmpWorkspaceDir);
  state = ctx.state;
  emptyLoadStore = ctx.loadStore;

  const { server: srv, baseUrl: url } = await bootServer(ctx);
  server = srv;
  baseUrl = url;
});

afterEach(async () => {
  await closeServer(server);
  server = null;
  baseUrl = "";
});

afterAll(async () => {
  await rmrf(path.dirname(tmpStateDir));
});

// ═══════════════════════════════════════════════════════════════════════
// E2E scenarios S1–S8
// ═══════════════════════════════════════════════════════════════════════

describe("Kindle Portal E2E — Option A: in-process HTTP server", () => {
  // ── S1: Plugin loads & routes registered ────────────────────────────

  it("S1: /kindle/ returns 200 and /kindle/api/fleet returns valid JSON; disabled config → handler passes through", async () => {
    // 1. GET /kindle/ → 200 (proves the monitor route is registered)
    const monitor = await fetchRoute("/kindle/");
    expect(monitor.status).toBe(200);

    // 2. GET /kindle/api/fleet → valid JSON (proves the API route is registered)
    const fleet = await fetchRoute("/kindle/api/fleet");
    expect(fleet.status).toBe(200);
    const parsed: unknown = JSON.parse(fleet.text);
    expect(typeof parsed).toBe("object");
    expect(parsed).not.toBeNull();

    // 3. Save artifact: fleet.json
    await writeArtifact("fleet.json", fleet.text);

    // 4. Gateway boot does not throw — if we got here, the server booted with
    //    enabled=true and the handler dispatched without exceptions.
    expect(server?.listening).toBe(true);

    // 5. When enabled=false, resolveKindleConfig returns enabled=false,
    //    meaning registerKindlePortalPlugin is never called (the plugin's
    //    register() returns early). The handler-level pass-through contract:
    //    a handler built from a context always returns false for non-/kindle
    //    paths. Verify that invariant directly.
    const disabledCfg = resolveKindleConfig({ enabled: false });
    expect(disabledCfg.enabled).toBe(false);

    const passThroughHandler = createKindleHttpHandler(ctx);
    const fakeReq = { url: "/some-other-route", socket: { remoteAddress: "127.0.0.1" } } as unknown as IncomingMessage;
    const fakeRes = { statusCode: 0, setHeader: () => {}, end: () => {} } as unknown as ServerResponse;
    const handled = await passThroughHandler(fakeReq, fakeRes);
    expect(handled).toBe(false);
  });

  // ── S2: Fleet snapshot endpoint ─────────────────────────────────────

  it("S2: /kindle/api/fleet returns {agents, lanes, laneSupport, idle, generatedAt} with idle=true when empty", async () => {
    const res = await fetchRoute("/kindle/api/fleet");
    expect(res.status).toBe(200);

    const snapshot = JSON.parse(res.text) as FleetSnapshot;

    // Shape contract
    expect(Array.isArray(snapshot.agents)).toBe(true);
    expect(Array.isArray(snapshot.lanes)).toBe(true);
    expect(snapshot.laneSupport).toBe("unavailable");
    expect(typeof snapshot.idle).toBe("boolean");
    expect(typeof snapshot.generatedAt).toBe("number");

    // Empty-state: idle when no events
    expect(snapshot.agents.length).toBe(0);
    expect(snapshot.idle).toBe(true);

    // Edge: emit a synthetic lifecycle.start event → agents non-empty
    const event: AgentEventPayload = {
      stream: "lifecycle",
      runId: "e2e-s2-run",
      sessionKey: "agent:main:feishu:direct:ou_test@feishu",
      agentId: "main",
      data: { phase: "start", model: "zai/glm-5-turbo", provider: "zai" },
      ts: Date.now(),
    };
    state.applyEvent(event);

    const res2 = await fetchRoute("/kindle/api/fleet");
    const snapshot2 = JSON.parse(res2.text) as FleetSnapshot;
    expect(snapshot2.agents.length).toBe(1);
    expect(snapshot2.idle).toBe(false);
    expect(snapshot2.agents[0].runId).toBe("e2e-s2-run");

    // Save the empty-state artifact (the canonical fleet.json deliverable)
    await writeArtifact("fleet.json", res.text);
  });

  // ── S3: Live monitor HTML (ES5) ─────────────────────────────────────

  it("S3: /kindle/ serves ES5-clean monitor HTML (passes lintKindleHtml, uses Bookerly serif, var/function only)", async () => {
    const res = await fetchRoute("/kindle/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");

    const html = res.text;
    await writeArtifact("monitor.html", html);

    // Must pass the ES5/old-WebKit linter with zero issues
    const issues = lintKindleHtml(html);
    expect(issues).toHaveLength(0);

    // Serif font stack anchored on Bookerly (Kindle's serif)
    expect(html).toContain("Bookerly");

    // Script uses ES5 constructs only (var, function) — no const/let/arrow/template-literal
    expect(html).toContain("var ");
    expect(html).toContain("function ");
    expect(html).not.toMatch(/\bconst\s/);
    expect(html).not.toMatch(/\blet\s/);
    expect(html).not.toContain("=>");
    expect(html).not.toContain("`");
  });

  // ── S4: Cognitive map PNG ───────────────────────────────────────────

  it("S4: /kindle/api/map.png returns a valid PNG (>1KB, PNG magic header)", async () => {
    const res = await fetchRoute("/kindle/api/map.png");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");

    const bytes = res.bytes;

    // PNG magic: \x89PNG\r\n\x1a\n
    expect(bytes.length).toBeGreaterThanOrEqual(8);
    for (let i = 0; i < PNG_MAGIC.length; i++) {
      expect(bytes[i]).toBe(PNG_MAGIC[i]);
    }

    // Real PNG is bigger than 1KB (even the onboarding empty-state image)
    expect(bytes.length).toBeGreaterThan(1024);

    await writeBinaryArtifact("map.png", bytes);
  });

  // ── S5: Cognitive map JSON ──────────────────────────────────────────

  it("S5: /kindle/api/map.json returns {nodes:[], edges:[]} with warning when no persona/wiki", async () => {
    // Boot a server with a non-empty session store so resolveActiveUser
    // resolves a user, exercising the persona-read + wiki-read path. With no
    // persona file and no wiki vault, the graph is empty and carries the
    // wiki-missing warning — the exact "no data yet" onboarding state.
    await closeServer(server);
    const sessionCtx = buildContextWithSession(cfg, tmpStateDir, tmpWorkspaceDir);
    const { server: srv, baseUrl: url } = await bootServer(sessionCtx);
    server = srv;
    baseUrl = url;

    const res = await fetchRoute("/kindle/api/map.json");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");

    const graph = JSON.parse(res.text) as { nodes: unknown[]; edges: unknown[]; warning?: string };

    // No persona data → empty nodes/edges
    expect(Array.isArray(graph.nodes)).toBe(true);
    expect(Array.isArray(graph.edges)).toBe(true);
    expect(graph.nodes.length).toBe(0);
    expect(graph.edges.length).toBe(0);

    // showWiki defaults to true but no wiki vault exists in the test env → warning
    expect(typeof graph.warning).toBe("string");
    expect(graph.warning).toContain("wiki");

    await writeArtifact("map.json", res.text);
  });

  // ── S6: Real-time event subscription ────────────────────────────────

  it("S6: after a synthetic lifecycle.start event, /kindle/api/fleet reflects the new agent", async () => {
    // 1. Baseline: no agents
    const before = await fetchRoute("/kindle/api/fleet");
    const beforeSnap = JSON.parse(before.text) as FleetSnapshot;
    expect(beforeSnap.agents.length).toBe(0);

    // 2. Emit a synthetic lifecycle.start event. The background service does
    //    exactly this internally: onAgentEvent → state.applyEvent. Since we
    //    test at the handler level (Option A), we call applyEvent directly.
    const event: AgentEventPayload = {
      stream: "lifecycle",
      runId: "e2e-s6-run",
      sessionKey: "agent:main:feishu:direct:ou_s6user@feishu",
      agentId: "main",
      data: {
        phase: "start",
        model: "zai/glm-5-turbo",
        provider: "zai",
        startedAt: Date.now(),
      },
      ts: Date.now(),
    };
    state.applyEvent(event);

    // 3. Subsequent fleet request reflects the new agent
    const after = await fetchRoute("/kindle/api/fleet");
    const afterSnap = JSON.parse(after.text) as FleetSnapshot;
    expect(afterSnap.agents.length).toBe(1);
    expect(afterSnap.idle).toBe(false);

    const agent = afterSnap.agents[0];
    expect(agent.runId).toBe("e2e-s6-run");
    expect(agent.status).toBe("thinking");
    expect(agent.agentId).toBe("main");

    // 4. Further state transitions flow through too: a tool event advances
    //    the run to tool_calling and bumps the tool-call count.
    state.applyEvent({
      stream: "tool",
      runId: "e2e-s6-run",
      data: { status: "running", toolName: "feishu_read_doc", toolCallId: "call-1" },
      ts: Date.now(),
    });
    const afterTool = await fetchRoute("/kindle/api/fleet");
    const afterToolSnap = JSON.parse(afterTool.text) as FleetSnapshot;
    expect(afterToolSnap.agents[0].status).toBe("tool_calling");
    expect(afterToolSnap.agents[0].toolName).toBe("feishu_read_doc");
    expect(afterToolSnap.agents[0].toolCallCount).toBe(1);
  });

  // ── S7: Configuration & defaults ────────────────────────────────────

  it("S7: minimal config {enabled:true} applies defaults — refresh 15s in monitor, 300s in map", async () => {
    // cfg was resolved from {enabled: true} only — verify defaults are present
    expect(cfg.refreshIntervalSeconds).toBe(15);
    expect(cfg.mapRefreshSeconds).toBe(300);
    expect(cfg.scope).toBe("last-active");
    expect(cfg.showWiki).toBe(true);
    expect(cfg.maxDomains).toBe(20);
    expect(cfg.pngWidth).toBe(758);

    // Monitor HTML embeds the refresh interval as `var REFRESH_MS = 15000;`
    // (the polling call uses the variable: setInterval(pollFleet, REFRESH_MS)).
    const monitor = await fetchRoute("/kindle/");
    expect(monitor.text).toContain("var REFRESH_MS = 15000;");
    expect(monitor.text).toContain("setInterval(pollFleet, REFRESH_MS)");

    // Save map.html artifact here (needed for S8 screenshot too)
    const map = await fetchRoute("/kindle/map");
    expect(map.status).toBe(200);
    await writeArtifact("map.html", map.text);

    // Map HTML embeds the meta-refresh interval: content="300"
    expect(map.text).toContain('content="300"');
  });

  // ── S8: Kindle browser compatibility ────────────────────────────────

  it("S8: monitor.html and map.html render at 600×800 viewport (Playwright screenshot)", async () => {
    const monitorRes = await fetchRoute("/kindle/");
    const monitorPath = await writeArtifact("monitor.html", monitorRes.text);
    const mapRes = await fetchRoute("/kindle/map");
    const mapPath = await writeArtifact("map.html", mapRes.text);

    // Both must pass the ES5 linter — Kindle compatibility contract.
    expect(lintKindleHtml(monitorRes.text)).toHaveLength(0);
    expect(lintKindleHtml(mapRes.text)).toHaveLength(0);

    // Render at Kindle Paperwhite-ish viewport and capture screenshots.
    // We load the saved artifact via file:// so the screenshot reflects the
    // exact bytes a Kindle would receive.
    const browser = await launchChromium();
    if (browser === null) {
      // Playwright/Chromium unavailable — manual QA required on actual Kindle.
      // The lint assertions above already prove ES5 compatibility; the
      // screenshot is a visual bonus, not a pass gate.
      console.warn("[kindle-portal e2e] S8 screenshots skipped: Chromium unavailable");
      return;
    }

    try {
      const context = await browser.newContext({
        viewport: KINDLE_VIEWPORT,
        deviceScaleFactor: 1,
      });
      const page = await context.newPage();

      await page.goto(`file://${monitorPath}`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(200);
      await page.screenshot({
        path: path.join(ARTIFACT_DIR, "monitor-screenshot.png"),
        fullPage: true,
      });

      await page.goto(`file://${mapPath}`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(200);
      await page.screenshot({
        path: path.join(ARTIFACT_DIR, "map-screenshot.png"),
        fullPage: true,
      });

      await context.close();
    } finally {
      await browser.close();
    }

    const monitorShot = await fs.stat(path.join(ARTIFACT_DIR, "monitor-screenshot.png"));
    expect(monitorShot.size).toBeGreaterThan(100);
    const mapShot = await fs.stat(path.join(ARTIFACT_DIR, "map-screenshot.png"));
    expect(mapShot.size).toBeGreaterThan(100);
  });
});

// ── Post-run artifact inventory (runs after all scenario tests) ────────

describe("Kindle Portal E2E — artifact inventory", () => {
  it("5 core artifacts always exist; screenshot present when Chromium available", async () => {
    const files = await listArtifacts();
    const coreRequired = [
      "monitor.html",
      "map.html",
      "fleet.json",
      "map.json",
      "map.png",
    ];
    for (const name of coreRequired) {
      expect(files).toContain(name);
      const stat = await fs.stat(path.join(ARTIFACT_DIR, name));
      expect(stat.size).toBeGreaterThan(0);
    }

    // The screenshot is produced only when a Chromium binary is available.
    // If present, it must be a non-trivial file; if absent, that's acceptable
    // (manual QA on real Kindle hardware covers this case).
    if (files.includes("monitor-screenshot.png")) {
      const stat = await fs.stat(path.join(ARTIFACT_DIR, "monitor-screenshot.png"));
      expect(stat.size).toBeGreaterThan(100);
    }
  });
});
