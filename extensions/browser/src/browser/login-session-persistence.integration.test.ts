import fs from "node:fs";
/**
 * T6 — login-proxy session persistence across a runner restart.
 *
 * Real headless Chrome (Chrome for Testing via playwright-core's user cache,
 * or any system Chromium) against a local test page: a cookie established in
 * the agent profile's persistent user-data-dir must survive stop + relaunch.
 *
 * Skips when no Chromium executable is available (the CI ubuntu runners and
 * dev machines with `node node_modules/playwright-core/cli.js install
 * chromium` run it for real).
 */
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright-core";
import { expect, it } from "vitest";
import { launchKaijiBotChrome, stopKaijiBotChrome } from "./chrome.js";
import { resolveBrowserConfig, type ResolvedBrowserProfile } from "./config.js";

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
  // System chrome first (CI), playwright-core user cache second (dev machines).
  const systemCandidates = [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
  ];
  const system = systemCandidates.find((candidate) => fs.existsSync(candidate));
  if (system) {
    return system;
  }
  return findChromiumExecutable();
}

const executablePath = findAnyExecutable();
const maybeIt = executablePath ? it : it.skip;

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

async function waitForPortFree(port: number, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const stillBound = await new Promise<boolean>((resolve) => {
      const probe = net.connect({ port, host: "127.0.0.1" });
      probe.on("error", () => resolve(false));
      probe.on("connect", () => {
        probe.destroy();
        resolve(true);
      });
    });
    if (!stillBound) {
      return;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`CDP port ${port} still in use after ${timeoutMs}ms`);
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

type TestServer = {
  origin: string;
  close: () => Promise<void>;
};

function startLoginTestServer(sessionToken: string): Promise<TestServer> {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname === "/login") {
      // Persistent cookie (Max-Age), like a real "stay logged in" session —
      // session cookies (no Max-Age) die with the browser process by design.
      res.writeHead(200, {
        "Content-Type": "text/html",
        "Set-Cookie": `kaijibot_session=${sessionToken}; Path=/; Max-Age=604800; HttpOnly`,
      });
      res.end("<html><body>logged in</body></html>");
      return;
    }
    const cookie = req.headers.cookie ?? "";
    const match = /kaijibot_session=([^;]+)/.exec(cookie);
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<html><body>session:${match?.[1] ?? "anonymous"}</body></html>`);
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

maybeIt(
  "keeps the manually established login session across a browser restart",
  { timeout: 180_000 },
  async () => {
    const sessionToken = `t6-${Date.now().toString(36)}`;
    const server = await startLoginTestServer(sessionToken);
    const cdpPort = await listenOnFreePort();

    const resolved = resolveBrowserConfig({
      enabled: true,
      headless: true,
      noSandbox: true,
      executablePath: executablePath ?? undefined,
    });
    const profile: ResolvedBrowserProfile = {
      name: "agent-t6-persistence",
      cdpPort,
      cdpUrl: `http://127.0.0.1:${cdpPort}`,
      cdpHost: "127.0.0.1",
      cdpIsLoopback: true,
      color: "#0066CC",
      driver: "kaijibot",
      attachOnly: false,
    };

    let running = await launchKaijiBotChrome(resolved, profile);
    try {
      // "Manual login": the login page sets the session cookie in the profile.
      let pw = await chromium.connectOverCDP(`http://localhost:${cdpPort}`);
      let context = pw.contexts()[0] ?? (await pw.newContext());
      let page = await context.newPage();
      await page.goto(`${server.origin}/login`);
      const loginBody = await page.textContent("body");
      expect(loginBody).toContain("logged in");
      await page.goto(`${server.origin}/whoami`);
      const whoamiAfterLogin = await page.textContent("body");
      expect(whoamiAfterLogin).toContain(`session:${sessionToken}`);
      await pw.close();

      // Runner restart: stop Chrome, relaunch on the same persistent profile.
      await stopKaijiBotChrome(running);
      await waitForChromeExit(running.proc);
      await waitForPortFree(cdpPort);
      running = await launchKaijiBotChrome(resolved, profile);

      pw = await chromium.connectOverCDP(`http://localhost:${cdpPort}`);
      context = pw.contexts()[0] ?? (await pw.newContext());
      page = await context.newPage();
      await page.goto(`${server.origin}/whoami`);
      const whoamiAfterRestart = await page.textContent("body");
      expect(whoamiAfterRestart).toContain(`session:${sessionToken}`);
      await pw.close();
    } finally {
      await stopKaijiBotChrome(running).catch(() => {});
      await server.close();
    }
  },
);
