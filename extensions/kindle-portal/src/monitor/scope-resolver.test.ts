import { describe, expect, it, vi } from "vitest";
import {
  resolveActiveUser,
  type LoadSessionStore,
  type SessionStoreSnapshot,
} from "./scope-resolver.js";

/**
 * Scope resolver — decides which user's persona to surface on the cognitive map.
 *
 * These tests exercise the three scope modes (last-active / specific-user /
 * all-users), userId extraction rules, and resilience to store failures.
 */
describe("resolveActiveUser", () => {
  describe("last-active scope", () => {
    it("picks entry with max updatedAt across agents", async () => {
      const store: SessionStoreSnapshot = {
        agents: [
          {
            agentId: "agent-a",
            sessions: [
              {
                sessionKey: "agent:main:feishu:direct:ou_aaa@feishu",
                updatedAt: 1000,
              },
              {
                sessionKey: "agent:main:feishu:direct:ou_bbb@feishu",
                updatedAt: 5000,
              },
            ],
          },
          {
            agentId: "agent-b",
            sessions: [
              {
                sessionKey: "agent:main:feishu:direct:ou_ccc@feishu",
                updatedAt: 3000,
              },
            ],
          },
        ],
      };
      const loadStore: LoadSessionStore = vi.fn().mockResolvedValue(store);

      const result = await resolveActiveUser(loadStore, "last-active", {});

      expect(result).toEqual({ agentId: "agent-a", userId: "ou_bbb" });
    });

    it("extracts ou_ userId from sessionKey", async () => {
      const store: SessionStoreSnapshot = {
        agents: [
          {
            agentId: "agent-main",
            sessions: [
              {
                sessionKey: "agent:main:feishu:direct:ou_abc@feishu",
                updatedAt: 9000,
              },
            ],
          },
        ],
      };
      const loadStore: LoadSessionStore = vi.fn().mockResolvedValue(store);

      const result = await resolveActiveUser(loadStore, "last-active", {});

      expect(result).toEqual({ agentId: "agent-main", userId: "ou_abc" });
    });

    it("falls back to origin.from when no ou_ prefix", async () => {
      const store: SessionStoreSnapshot = {
        agents: [
          {
            agentId: "agent-web",
            sessions: [
              {
                sessionKey: "webhook:foo",
                updatedAt: 7000,
                origin: { from: "ou_xyz" },
              },
            ],
          },
        ],
      };
      const loadStore: LoadSessionStore = vi.fn().mockResolvedValue(store);

      const result = await resolveActiveUser(loadStore, "last-active", {});

      expect(result).toEqual({ agentId: "agent-web", userId: "ou_xyz" });
    });

    it("skips entries with no extractable userId", async () => {
      // First entry has higher updatedAt but no userId — should be skipped
      // in favor of the second entry with an ou_ prefix.
      const store: SessionStoreSnapshot = {
        agents: [
          {
            agentId: "agent-cron",
            sessions: [
              {
                sessionKey: "cron:job",
                updatedAt: 9999,
              },
              {
                sessionKey: "agent:main:feishu:direct:ou_skip@feishu",
                updatedAt: 1000,
              },
            ],
          },
        ],
      };
      const loadStore: LoadSessionStore = vi.fn().mockResolvedValue(store);

      const result = await resolveActiveUser(loadStore, "last-active", {});

      expect(result).toEqual({ agentId: "agent-cron", userId: "ou_skip" });
    });

    it("returns null when store empty", async () => {
      const store: SessionStoreSnapshot = { agents: [] };
      const loadStore: LoadSessionStore = vi.fn().mockResolvedValue(store);

      const result = await resolveActiveUser(loadStore, "last-active", {});

      expect(result).toBeNull();
    });

    it("returns null when no sessions have ou_ userId", async () => {
      const store: SessionStoreSnapshot = {
        agents: [
          {
            agentId: "agent-x",
            sessions: [
              { sessionKey: "cron:job1", updatedAt: 1000 },
              { sessionKey: "cron:job2", updatedAt: 2000 },
            ],
          },
        ],
      };
      const loadStore: LoadSessionStore = vi.fn().mockResolvedValue(store);

      const result = await resolveActiveUser(loadStore, "last-active", {});

      expect(result).toBeNull();
    });
  });

  describe("specific-user scope", () => {
    it("returns matching agentId+userId", async () => {
      const store: SessionStoreSnapshot = {
        agents: [
          {
            agentId: "agent-a",
            sessions: [
              { sessionKey: "agent:other:ou_zzz@feishu", updatedAt: 1000 },
            ],
          },
          {
            agentId: "agent-b",
            sessions: [
              { sessionKey: "agent:main:feishu:direct:ou_abc@feishu", updatedAt: 2000 },
            ],
          },
        ],
      };
      const loadStore: LoadSessionStore = vi.fn().mockResolvedValue(store);

      const result = await resolveActiveUser(loadStore, "specific-user", { userId: "ou_abc" });

      expect(result).toEqual({ agentId: "agent-b", userId: "ou_abc" });
    });

    it("returns null when userId not found in any agent", async () => {
      const store: SessionStoreSnapshot = {
        agents: [
          {
            agentId: "agent-a",
            sessions: [
              { sessionKey: "agent:main:ou_other@feishu", updatedAt: 1000 },
            ],
          },
        ],
      };
      const loadStore: LoadSessionStore = vi.fn().mockResolvedValue(store);

      const result = await resolveActiveUser(loadStore, "specific-user", { userId: "ou_abc" });

      expect(result).toBeNull();
    });

    it("returns null when cfg.userId undefined", async () => {
      const store: SessionStoreSnapshot = {
        agents: [
          {
            agentId: "agent-a",
            sessions: [
              { sessionKey: "agent:main:ou_abc@feishu", updatedAt: 1000 },
            ],
          },
        ],
      };
      const loadStore: LoadSessionStore = vi.fn().mockResolvedValue(store);

      const result = await resolveActiveUser(loadStore, "specific-user", {});

      expect(result).toBeNull();
    });
  });

  describe("all-users scope", () => {
    it("returns null always", async () => {
      const store: SessionStoreSnapshot = {
        agents: [
          {
            agentId: "agent-a",
            sessions: [
              { sessionKey: "agent:main:ou_abc@feishu", updatedAt: 1000 },
            ],
          },
        ],
      };
      const loadStore: LoadSessionStore = vi.fn().mockResolvedValue(store);

      const result = await resolveActiveUser(loadStore, "all-users", {});

      expect(result).toBeNull();
      // Per spec: caller handles enumeration for all-users, so the store
      // should not even be consulted. Verify no calls to loadStore.
      expect(loadStore).not.toHaveBeenCalled();
    });
  });

  describe("resilience", () => {
    it("loadStore throwing is caught and returns null", async () => {
      const loadStore: LoadSessionStore = vi.fn().mockRejectedValue(new Error("disk unavailable"));
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const result = await resolveActiveUser(loadStore, "last-active", {});

      expect(result).toBeNull();
      // Resilience path should log a warning so operators can diagnose.
      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });
});
