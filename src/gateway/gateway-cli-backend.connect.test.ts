import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { clearConfigCache, clearRuntimeConfigSnapshot } from "../config/config.js";
import { clearSessionStoreCacheForTest } from "../config/sessions/store.js";
import { captureEnv } from "../test-utils/env.js";
import {
  connectTestGatewayClient,
  ensurePairedTestGatewayClientIdentity,
  getFreeGatewayPort,
} from "./gateway-cli-backend.live-helpers.js";
import { startGatewayServer } from "./server.js";

const GATEWAY_CONNECT_TIMEOUT_MS = 90_000;

describe("gateway cli backend connect", () => {
  afterEach(() => {
    clearRuntimeConfigSnapshot();
    clearConfigCache();
    clearSessionStoreCacheForTest();
  });

  it(
    "connects a same-process test gateway client in minimal mode",
    async () => {
      const envSnapshot = captureEnv([
        "HOME",
        "KAIJIBOT_STATE_DIR",
        "KAIJIBOT_CONFIG_PATH",
        "KAIJIBOT_GATEWAY_TOKEN",
        "KAIJIBOT_SKIP_CHANNELS",
        "KAIJIBOT_SKIP_PROVIDERS",
        "KAIJIBOT_SKIP_GMAIL_WATCHER",
        "KAIJIBOT_SKIP_CRON",
        "KAIJIBOT_SKIP_CANVAS_HOST",
        "KAIJIBOT_SKIP_BROWSER_CONTROL_SERVER",
        "KAIJIBOT_BUNDLED_PLUGINS_DIR",
        "KAIJIBOT_TEST_MINIMAL_GATEWAY",
      ]);

      const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), "kaijibot-gateway-connect-home-"));
      const configPath = path.join(tempHome, ".kaijibot", "kaijibot.json");
      const bundledPluginsDir = path.join(tempHome, "kaijibot-test-no-bundled-extensions");
      const token = `test-${Date.now()}`;
      process.env.HOME = tempHome;
      process.env.KAIJIBOT_STATE_DIR = path.join(tempHome, ".kaijibot");
      process.env.KAIJIBOT_CONFIG_PATH = configPath;
      process.env.KAIJIBOT_GATEWAY_TOKEN = token;
      process.env.KAIJIBOT_SKIP_CHANNELS = "1";
      process.env.KAIJIBOT_SKIP_PROVIDERS = "1";
      process.env.KAIJIBOT_SKIP_GMAIL_WATCHER = "1";
      process.env.KAIJIBOT_SKIP_CRON = "1";
      process.env.KAIJIBOT_SKIP_CANVAS_HOST = "1";
      process.env.KAIJIBOT_SKIP_BROWSER_CONTROL_SERVER = "1";
      process.env.KAIJIBOT_BUNDLED_PLUGINS_DIR = bundledPluginsDir;
      process.env.KAIJIBOT_TEST_MINIMAL_GATEWAY = "1";
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      await fs.mkdir(bundledPluginsDir, { recursive: true });
      await fs.writeFile(
        configPath,
        `${JSON.stringify({ gateway: { auth: { mode: "token", token } } }, null, 2)}\n`,
      );
      clearRuntimeConfigSnapshot();
      clearConfigCache();
      clearSessionStoreCacheForTest();

      const deviceIdentity = await ensurePairedTestGatewayClientIdentity();
      const port = await getFreeGatewayPort();
      const server = await startGatewayServer(port, {
        bind: "loopback",
        auth: { mode: "token", token },
        controlUiEnabled: false,
      });
      let client: Awaited<ReturnType<typeof connectTestGatewayClient>> | undefined;

      try {
        client = await connectTestGatewayClient({
          url: `ws://127.0.0.1:${port}`,
          token,
          deviceIdentity,
        });
        const health = await client.request<{ ok?: boolean }>("health", undefined, {
          timeoutMs: 5_000,
        });
        expect(health).toMatchObject({
          ok: true,
        });
      } finally {
        await client?.stopAndWait({ timeoutMs: 1_000 }).catch(() => {});
        await server.close({ reason: "gateway connect regression complete" });
        await fs.rm(tempHome, { recursive: true, force: true });
        envSnapshot.restore();
      }
    },
    GATEWAY_CONNECT_TIMEOUT_MS,
  );
});
