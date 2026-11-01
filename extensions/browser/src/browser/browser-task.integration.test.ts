import fs from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
/**
 * T7 — a cognitive task with a real browser step, unattended.
 *
 * Cross-boundary integration (extensions lane; boundary checks exempt test
 * files): the M1 task system (core: TaskStore + TaskRunner + the PRODUCTION
 * step driver) drives a step whose "agent turn" performs a REAL browser
 * action against a local test page on the agent's persistent profile, then
 * closes the handshake with the real task_step_report tool. The result must
 * carry the extracted page content through the checkpointed lifecycle and
 * the terminal delivery.
 *
 * Skips when no Chromium executable is available (CI ubuntu runners and dev
 * machines with `node node_modules/playwright-core/cli.js install chromium`
 * run it for real).
 */
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTaskStepReportTool } from "../../../../src/agents/tools/task-tool.js";
import { TaskRunner } from "../../../../src/cognitive/tasks/runner.js";
import { createTaskSafely } from "../../../../src/cognitive/tasks/service.js";
import { createProductionStepDriver } from "../../../../src/cognitive/tasks/step-driver.js";
import { TaskStore } from "../../../../src/cognitive/tasks/store.js";
import type { KaijiBotConfig } from "../../../../src/config/config.js";
import { launchKaijiBotChrome, stopKaijiBotChrome, type RunningChrome } from "./chrome.js";
import type { ResolvedBrowserConfig, ResolvedBrowserProfile } from "./config.js";

function findChromiumExecutable(): string | null {
  const cacheDir = path.join(os.homedir(), ".cache", "ms-playwright");
  try {
    const candidates = fs
      .readdirSync(cacheDir)
      .filter((name) => name.startsWith("chromium-"))
      .toSorted()
      .toReversed()
      .flatMap((name) => {
        const base = path.join(cacheDir, name);
        return [
          path.join(base, "chrome-linux64", "chrome"),
          path.join(base, "chrome-linux", "chrome"),
        ];
      })
      .filter((candidate) => fs.existsSync(candidate));
    return candidates[0] ?? null;
  } catch {
    return null;
  }
}

function findAnyExecutable(): string | null {
  const systemCandidates = [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
  ];
  return systemCandidates.find((candidate) => fs.existsSync(candidate)) ?? findChromiumExecutable();
}

const executablePath = findAnyExecutable();
const maybeIt = executablePath ? it : it.skip;

const AGENT = "main";
const USER = "ou_browsere2e";
const SESSION_KEY = `agent:${AGENT}:${USER}`;

function listenOnFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      server.close(() => resolve(port));
    });
  });
}

function startContentServer(
  marker: string,
): Promise<{ origin: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`<html><body>页面内容标记 ${marker}</body></html>`);
  });
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as { port: number };
      resolve({
        origin: `http://127.0.0.1:${address.port}`,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}

function waitForChromeExit(
  proc: { exitCode: number | null; signalCode: string | null } & NodeJS.EventEmitter,
  timeoutMs = 20_000,
): Promise<void> {
  if (proc.exitCode !== null || proc.signalCode != null) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("chrome did not exit after stop")), timeoutMs);
    proc.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

describe("browser-step task e2e (T7)", () => {
  let storeDir: string;
  let store: TaskStore;
  let enqueued: Array<{ text: string; contextKey?: string; sessionKey: string }>;
  let heartbeats: Array<{ reason: string; sessionKey: string }>;
  let server: { origin: string; close: () => Promise<void> };
  let running: RunningChrome | undefined;
  let cdpPort: number;

  beforeAll(async () => {
    const marker = `T7-${Date.now().toString(36)}`;
    server = await startContentServer(marker);
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(() => {
    storeDir = mkdtempSync(path.join(os.tmpdir(), "kaijibot-t7-store-"));
    store = new TaskStore(storeDir);
    enqueued = [];
    heartbeats = [];
    running = undefined;
  });

  afterEach(async () => {
    if (running) {
      await stopKaijiBotChrome(running);
      await waitForChromeExit(running.proc);
      running = undefined;
    }
    rmSync(storeDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function config(): KaijiBotConfig {
    return {
      cognitive: { enabled: true, tasks: { enabled: true } },
    } as unknown as KaijiBotConfig;
  }

  function makeRunner(): TaskRunner {
    const stepDriver = createProductionStepDriver({
      sessionKey: SESSION_KEY,
      enqueueSystemEvent: (text, options) => {
        enqueued.push({ text, contextKey: options.contextKey, sessionKey: options.sessionKey });
        return true;
      },
      requestHeartbeatNow: (opts) => {
        heartbeats.push({ reason: opts.reason, sessionKey: opts.sessionKey });
      },
    });
    return new TaskRunner({
      store,
      runStep: stepDriver,
      deliver: async (task, message) => {
        enqueued.push({
          text: `[Task Result] ${message}`,
          contextKey: `task-result:${task.id}`,
          sessionKey: SESSION_KEY,
        });
        heartbeats.push({ reason: "cognitive-task", sessionKey: SESSION_KEY });
      },
    });
  }

  maybeIt(
    "opens the local test page, extracts content, and completes unattended",
    { timeout: 180_000 },
    async () => {
      // The agent's persistent-profile browser is running (started earlier —
      // e.g. by a login session or a previous step).
      cdpPort = await listenOnFreePort();
      const resolved: ResolvedBrowserConfig = {
        enabled: true,
        evaluateEnabled: true,
        controlPort: 18791,
        cdpPortRangeStart: 18800,
        cdpPortRangeEnd: 18899,
        cdpProtocol: "http",
        cdpHost: "127.0.0.1",
        cdpIsLoopback: true,
        remoteCdpTimeoutMs: 1500,
        remoteCdpHandshakeTimeoutMs: 3000,
        color: "#FF4500",
        headless: true,
        noSandbox: true,
        attachOnly: false,
        proxyEnabled: true,
        defaultProfile: "kaijibot",
        profiles: {},
        extraArgs: [],
        executablePath: executablePath ?? undefined,
      };
      const profile: ResolvedBrowserProfile = {
        name: "agent-t7-browser-step",
        cdpPort,
        cdpUrl: `http://127.0.0.1:${cdpPort}`,
        cdpHost: "127.0.0.1",
        cdpIsLoopback: true,
        color: "#0066CC",
        driver: "kaijibot",
        attachOnly: false,
      };
      running = await launchKaijiBotChrome(resolved, profile);

      // Task creation through the service (flag on, healthy persona).
      const created = await createTaskSafely(
        { store, config: config(), loadPersona: async () => undefined },
        AGENT,
        USER,
        { goal: "打开本地测试页并提取内容", maxSteps: 3 },
      );
      expect(created.ok).toBe(true);
      const task = created.ok ? created.task : undefined;
      expect(task?.status).toBe("queued");

      // Unattended run: the step's agent turn performs the REAL browser step
      // (navigate + extract on the agent profile) and closes the handshake
      // with the real task_step_report tool.
      const runner = makeRunner();
      const tickPromise = runner.tick(AGENT, USER);
      const reportTool = createTaskStepReportTool();

      await vi.waitFor(() => {
        expect(
          heartbeats.filter((h) => h.reason === "cognitive-task").length,
        ).toBeGreaterThanOrEqual(1);
      });

      const pw = await chromium.connectOverCDP(`http://localhost:${cdpPort}`);
      const context = pw.contexts()[0] ?? (await pw.newContext());
      const page = await context.newPage();
      await page.goto(`${server.origin}/content`);
      const extracted = (await page.textContent("body")) ?? "";
      await pw.close();

      const report = await reportTool.execute("report-1", {
        taskId: task!.id,
        stepIndex: 1,
        summary: `已从本地测试页提取内容：${extracted.trim()}`,
        done: true,
      });
      expect(JSON.parse((report.content[0] as { text: string }).text).status).toBe("recorded");
      expect(await tickPromise).toBe(1);

      // Lifecycle + delivery carry the extracted content.
      const final = await store.get(AGENT, USER, task!.id);
      expect(final?.status).toBe("done");
      expect(final?.budget.usedSteps).toBe(1);
      expect(final?.result).toContain("页面内容标记");
      const deliveries = enqueued.filter((e) => e.text.includes("[Task Result]"));
      expect(deliveries).toHaveLength(1);
      expect(deliveries[0]!.text).toContain("页面内容标记");
      const stepPrompts = enqueued.filter((e) => e.text.includes("[Task Step"));
      expect(stepPrompts).toHaveLength(1);
      expect(stepPrompts[0]!.text).toContain("打开本地测试页并提取内容");

      // Nothing left runnable.
      expect(await runner.tick(AGENT, USER)).toBe(0);
    },
  );
});
