import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSuiteTempRootTracker } from "../test-helpers/temp-dir.js";
import { ConfigClobberProtectionError, createConfigIO } from "./io.js";

describe("config io clobber protection", () => {
  const suiteRootTracker = createSuiteTempRootTracker({ prefix: "kaijibot-clobber-" });
  const silentLogger = { warn: () => {}, error: () => {} };

  async function withSuiteHome<T>(fn: (home: string) => Promise<T>): Promise<T> {
    const home = await suiteRootTracker.make("case");
    return fn(home);
  }

  beforeAll(async () => {
    await suiteRootTracker.setup();
  });

  afterAll(async () => {
    await suiteRootTracker.cleanup();
  });

  async function seedHealthState(params: {
    home: string;
    configPath: string;
    lastKnownGoodBytes: number;
    lastKnownGoodGatewayMode: string;
  }): Promise<void> {
    const healthPath = path.join(params.home, ".kaijibot", "logs", "config-health.json");
    await fs.mkdir(path.dirname(healthPath), { recursive: true });
    const healthState = {
      entries: {
        [params.configPath]: {
          lastKnownGood: {
            hash: "deadbeef".repeat(8),
            bytes: params.lastKnownGoodBytes,
            mtimeMs: Date.now(),
            ctimeMs: Date.now(),
            dev: "0",
            ino: "0",
            mode: 384,
            nlink: 1,
            uid: 1000,
            gid: 1000,
            hasMeta: true,
            gatewayMode: params.lastKnownGoodGatewayMode,
            observedAt: new Date().toISOString(),
          },
          lastObservedSuspiciousSignature: null,
        },
      },
    };
    await fs.writeFile(healthPath, JSON.stringify(healthState), "utf-8");
  }

  it("refuses to write a stub that drops gateway.mode and shrinks >50% vs lastKnownGood", async () => {
    await withSuiteHome(async (home) => {
      const configPath = path.join(home, ".kaijibot", "kaijibot.json");
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      await seedHealthState({
        home,
        configPath,
        lastKnownGoodBytes: 5000,
        lastKnownGoodGatewayMode: "local",
      });

      const io = createConfigIO({
        env: {} as NodeJS.ProcessEnv,
        homedir: () => home,
        logger: silentLogger,
      });

      await expect(io.writeConfigFile({ meta: { lastTouchedAt: "2026-07-18" } })).rejects.toThrow(
        ConfigClobberProtectionError,
      );
      await expect(io.writeConfigFile({ meta: { lastTouchedAt: "2026-07-18" } })).rejects.toThrow(
        /Refusing to shrink kaijibot\.json from 5000 bytes/,
      );
    });
  });

  it("allows the same shrink when allowConfigClobberShrink option is true", async () => {
    await withSuiteHome(async (home) => {
      const configPath = path.join(home, ".kaijibot", "kaijibot.json");
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      await seedHealthState({
        home,
        configPath,
        lastKnownGoodBytes: 5000,
        lastKnownGoodGatewayMode: "local",
      });

      const io = createConfigIO({
        env: {} as NodeJS.ProcessEnv,
        homedir: () => home,
        logger: silentLogger,
      });

      await expect(
        io.writeConfigFile(
          { meta: { lastTouchedAt: "2026-07-18" } },
          { allowConfigClobberShrink: true },
        ),
      ).resolves.toEqual({ persistedHash: expect.any(String) });
    });
  });

  it("allows the same shrink when KAIJIBOT_ALLOW_CONFIG_CLOBBER_SHRINK=1 is set", async () => {
    await withSuiteHome(async (home) => {
      const configPath = path.join(home, ".kaijibot", "kaijibot.json");
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      await seedHealthState({
        home,
        configPath,
        lastKnownGoodBytes: 5000,
        lastKnownGoodGatewayMode: "local",
      });

      const io = createConfigIO({
        env: { KAIJIBOT_ALLOW_CONFIG_CLOBBER_SHRINK: "1" } as NodeJS.ProcessEnv,
        homedir: () => home,
        logger: silentLogger,
      });

      await expect(io.writeConfigFile({ meta: { lastTouchedAt: "2026-07-18" } })).resolves.toEqual({
        persistedHash: expect.any(String),
      });
    });
  });

  it("does not trigger when lastKnownGood has no gatewayMode", async () => {
    await withSuiteHome(async (home) => {
      const configPath = path.join(home, ".kaijibot", "kaijibot.json");
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      await seedHealthState({
        home,
        configPath,
        lastKnownGoodBytes: 5000,
        lastKnownGoodGatewayMode: "",
      });

      const io = createConfigIO({
        env: {} as NodeJS.ProcessEnv,
        homedir: () => home,
        logger: silentLogger,
      });

      await expect(io.writeConfigFile({ meta: { lastTouchedAt: "2026-07-18" } })).resolves.toEqual({
        persistedHash: expect.any(String),
      });
    });
  });

  it("does not trigger when gateway.mode is preserved in the next payload", async () => {
    await withSuiteHome(async (home) => {
      const configPath = path.join(home, ".kaijibot", "kaijibot.json");
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      await seedHealthState({
        home,
        configPath,
        lastKnownGoodBytes: 2000,
        lastKnownGoodGatewayMode: "local",
      });

      const io = createConfigIO({
        env: {} as NodeJS.ProcessEnv,
        homedir: () => home,
        logger: silentLogger,
      });

      await expect(io.writeConfigFile({ gateway: { mode: "local" } })).resolves.toEqual({
        persistedHash: expect.any(String),
      });
    });
  });
});
