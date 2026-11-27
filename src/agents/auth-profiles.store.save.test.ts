import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { resolveAuthStatePath, resolveAuthStorePath } from "./auth-profiles/paths.js";
import {
  clearRuntimeAuthProfileStoreSnapshots,
  ensureAuthProfileStore,
  replaceRuntimeAuthProfileStoreSnapshots,
  saveAuthProfileStore,
} from "./auth-profiles/store.js";
import type { AuthProfileStore } from "./auth-profiles/types.js";
import { markAuthProfileUsed } from "./auth-profiles/usage.js";

vi.mock("./auth-profiles/external-auth.js", () => ({
  overlayExternalAuthProfiles: <T>(store: T) => store,
  shouldPersistExternalAuthProfile: () => true,
}));

describe("saveAuthProfileStore", () => {
  it("strips plaintext when keyRef/tokenRef are present", async () => {
    const agentDir = await fs.mkdtemp(path.join(os.tmpdir(), "kaijibot-auth-save-"));
    try {
      const store: AuthProfileStore = {
        version: 1,
        profiles: {
          "openai:default": {
            type: "api_key",
            provider: "openai",
            key: "sk-runtime-value",
            keyRef: { source: "env", provider: "default", id: "OPENAI_API_KEY" },
          },
          "github-copilot:default": {
            type: "token",
            provider: "github-copilot",
            token: "gh-runtime-token",
            tokenRef: { source: "env", provider: "default", id: "GITHUB_TOKEN" },
          },
          "anthropic:default": {
            type: "api_key",
            provider: "anthropic",
            key: "sk-anthropic-plain",
          },
        },
      };

      saveAuthProfileStore(store, agentDir);

      const parsed = JSON.parse(await fs.readFile(resolveAuthStorePath(agentDir), "utf8")) as {
        profiles: Record<
          string,
          { key?: string; keyRef?: unknown; token?: string; tokenRef?: unknown }
        >;
      };

      expect(parsed.profiles["openai:default"]?.key).toBeUndefined();
      expect(parsed.profiles["openai:default"]?.keyRef).toEqual({
        source: "env",
        provider: "default",
        id: "OPENAI_API_KEY",
      });

      expect(parsed.profiles["github-copilot:default"]?.token).toBeUndefined();
      expect(parsed.profiles["github-copilot:default"]?.tokenRef).toEqual({
        source: "env",
        provider: "default",
        id: "GITHUB_TOKEN",
      });

      expect(parsed.profiles["anthropic:default"]?.key).toBe("sk-anthropic-plain");
    } finally {
      await fs.rm(agentDir, { recursive: true, force: true });
    }
  });

  it("refreshes the runtime snapshot when a saved store rotates oauth tokens", async () => {
    const agentDir = await fs.mkdtemp(path.join(os.tmpdir(), "kaijibot-auth-save-runtime-"));
    try {
      replaceRuntimeAuthProfileStoreSnapshots([
        {
          agentDir,
          store: {
            version: 1,
            profiles: {
              "anthropic:default": {
                type: "oauth",
                provider: "anthropic",
                access: "access-1",
                refresh: "refresh-1",
                expires: 1,
              },
            },
          },
        },
      ]);

      expect(ensureAuthProfileStore(agentDir).profiles["anthropic:default"]).toMatchObject({
        access: "access-1",
        refresh: "refresh-1",
      });

      const rotatedStore: AuthProfileStore = {
        version: 1,
        profiles: {
          "anthropic:default": {
            type: "oauth",
            provider: "anthropic",
            access: "access-2",
            refresh: "refresh-2",
            expires: 2,
          },
        },
      };

      saveAuthProfileStore(rotatedStore, agentDir);

      expect(ensureAuthProfileStore(agentDir).profiles["anthropic:default"]).toMatchObject({
        access: "access-2",
        refresh: "refresh-2",
      });

      const persisted = JSON.parse(await fs.readFile(resolveAuthStorePath(agentDir), "utf8")) as {
        profiles: Record<string, { access?: string; refresh?: string }>;
      };
      expect(persisted.profiles["anthropic:default"]).toMatchObject({
        access: "access-2",
        refresh: "refresh-2",
      });
    } finally {
      clearRuntimeAuthProfileStoreSnapshots();
      await fs.rm(agentDir, { recursive: true, force: true });
    }
  });

  it("writes runtime scheduling state to auth-state.json only", async () => {
    const agentDir = await fs.mkdtemp(path.join(os.tmpdir(), "kaijibot-auth-save-state-"));
    try {
      const store: AuthProfileStore = {
        version: 1,
        profiles: {
          "anthropic:default": {
            type: "api_key",
            provider: "anthropic",
            key: "sk-anthropic-plain",
          },
        },
        order: {
          anthropic: ["anthropic:default"],
        },
        lastGood: {
          anthropic: "anthropic:default",
        },
        usageStats: {
          "anthropic:default": {
            lastUsed: 123,
          },
        },
      };

      saveAuthProfileStore(store, agentDir);

      const authProfiles = JSON.parse(
        await fs.readFile(resolveAuthStorePath(agentDir), "utf8"),
      ) as {
        profiles: Record<string, unknown>;
        order?: unknown;
        lastGood?: unknown;
        usageStats?: unknown;
      };
      expect(authProfiles.profiles["anthropic:default"]).toBeDefined();
      expect(authProfiles.order).toBeUndefined();
      expect(authProfiles.lastGood).toBeUndefined();
      expect(authProfiles.usageStats).toBeUndefined();

      const authState = JSON.parse(await fs.readFile(resolveAuthStatePath(agentDir), "utf8")) as {
        order?: Record<string, string[]>;
        lastGood?: Record<string, string>;
        usageStats?: Record<string, { lastUsed?: number }>;
      };
      expect(authState.order?.anthropic).toEqual(["anthropic:default"]);
      expect(authState.lastGood?.anthropic).toBe("anthropic:default");
      expect(authState.usageStats?.["anthropic:default"]?.lastUsed).toBe(123);
    } finally {
      await fs.rm(agentDir, { recursive: true, force: true });
    }
  });

  it("leaves auth-profiles.json untouched when only usage state changed", async () => {
    const agentDir = await fs.mkdtemp(path.join(os.tmpdir(), "kaijibot-auth-save-usage-"));
    try {
      const store: AuthProfileStore = {
        version: 1,
        profiles: {
          "anthropic:default": {
            type: "api_key",
            provider: "anthropic",
            key: "sk-anthropic-plain",
          },
        },
      };
      saveAuthProfileStore(store, agentDir);
      const authPath = resolveAuthStorePath(agentDir);
      const firstWrite = await fs.readFile(authPath, "utf8");
      const stale = new Date("2026-01-01T00:00:00Z");
      await fs.utimes(authPath, stale, stale);

      const lastUsed = 1_767_225_600_000;
      saveAuthProfileStore(
        { ...store, usageStats: { "anthropic:default": { lastUsed } } },
        agentDir,
      );

      expect(Math.trunc((await fs.stat(authPath)).mtimeMs)).toBe(stale.getTime());
      expect(await fs.readFile(authPath, "utf8")).toBe(firstWrite);
      const authState = JSON.parse(await fs.readFile(resolveAuthStatePath(agentDir), "utf8")) as {
        usageStats?: Record<string, { lastUsed?: number }>;
      };
      expect(authState.usageStats?.["anthropic:default"]?.lastUsed).toBe(lastUsed);
    } finally {
      clearRuntimeAuthProfileStoreSnapshots();
      await fs.rm(agentDir, { recursive: true, force: true });
    }
  });

  it("does not move auth-profiles.json's mtime when a turn records profile usage", async () => {
    const agentDir = await fs.mkdtemp(path.join(os.tmpdir(), "kaijibot-auth-save-mark-used-"));
    try {
      const store: AuthProfileStore = {
        version: 1,
        profiles: {
          "anthropic:default": {
            type: "api_key",
            provider: "anthropic",
            key: "sk-anthropic-plain",
          },
        },
      };
      saveAuthProfileStore(store, agentDir);
      const authPath = resolveAuthStorePath(agentDir);
      const firstWrite = await fs.readFile(authPath, "utf8");
      const stale = new Date("2026-01-01T00:00:00Z");
      await fs.utimes(authPath, stale, stale);
      const before = Date.now();

      await markAuthProfileUsed({ store, profileId: "anthropic:default", agentDir });

      expect(Math.trunc((await fs.stat(authPath)).mtimeMs)).toBe(stale.getTime());
      expect(await fs.readFile(authPath, "utf8")).toBe(firstWrite);
      const authState = JSON.parse(await fs.readFile(resolveAuthStatePath(agentDir), "utf8")) as {
        usageStats?: Record<string, { lastUsed?: number }>;
      };
      expect(authState.usageStats?.["anthropic:default"]?.lastUsed).toBeGreaterThanOrEqual(before);
    } finally {
      clearRuntimeAuthProfileStoreSnapshots();
      await fs.rm(agentDir, { recursive: true, force: true });
    }
  });

  it("rewrites auth-profiles.json when a credential changes", async () => {
    const agentDir = await fs.mkdtemp(path.join(os.tmpdir(), "kaijibot-auth-save-rotate-"));
    try {
      const store: AuthProfileStore = {
        version: 1,
        profiles: {
          "anthropic:default": {
            type: "api_key",
            provider: "anthropic",
            key: "sk-anthropic-plain",
          },
        },
      };
      saveAuthProfileStore(store, agentDir);
      const authPath = resolveAuthStorePath(agentDir);
      const stale = new Date("2026-01-01T00:00:00Z");
      await fs.utimes(authPath, stale, stale);

      saveAuthProfileStore(
        {
          ...store,
          profiles: {
            "anthropic:default": {
              type: "api_key",
              provider: "anthropic",
              key: "sk-anthropic-rotated",
            },
          },
        },
        agentDir,
      );

      expect((await fs.stat(authPath)).mtimeMs).toBeGreaterThan(stale.getTime());
      expect(JSON.parse(await fs.readFile(authPath, "utf8"))).toMatchObject({
        profiles: { "anthropic:default": { key: "sk-anthropic-rotated" } },
      });
    } finally {
      clearRuntimeAuthProfileStoreSnapshots();
      await fs.rm(agentDir, { recursive: true, force: true });
    }
  });
});
