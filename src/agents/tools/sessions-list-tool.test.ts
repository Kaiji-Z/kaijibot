import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  gatewayCall: vi.fn(),
  createAgentToAgentPolicy: vi.fn(() => ({})),
  createSessionVisibilityGuard: vi.fn(async () => ({
    check: () => ({ allowed: true }),
  })),
  resolveEffectiveSessionToolsVisibility: vi.fn(() => "all"),
  resolveSandboxedSessionToolContext: vi.fn(() => ({
    mainKey: "main",
    alias: "main",
    requesterInternalKey: undefined,
    restrictToSpawned: false,
  })),
}));

vi.mock("../../gateway/call.js", () => ({
  callGateway: (opts: unknown) => mocks.gatewayCall(opts),
}));

vi.mock("./sessions-helpers.js", async (importActual) => {
  const actual = await importActual<typeof import("./sessions-helpers.js")>();
  return {
    ...actual,
    createAgentToAgentPolicy: () => mocks.createAgentToAgentPolicy(),
    createSessionVisibilityGuard: async () => await mocks.createSessionVisibilityGuard(),
    resolveEffectiveSessionToolsVisibility: () => mocks.resolveEffectiveSessionToolsVisibility(),
    resolveSandboxedSessionToolContext: () => mocks.resolveSandboxedSessionToolContext(),
  };
});

describe("sessions-list-tool", () => {
  let createSessionsListTool: typeof import("./sessions-list-tool.js").createSessionsListTool;

  beforeAll(async () => {
    ({ createSessionsListTool } = await import("./sessions-list-tool.js"));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createAgentToAgentPolicy.mockReturnValue({});
    mocks.createSessionVisibilityGuard.mockResolvedValue({
      check: () => ({ allowed: true }),
    });
    mocks.resolveEffectiveSessionToolsVisibility.mockReturnValue("all");
    mocks.resolveSandboxedSessionToolContext.mockReturnValue({
      mainKey: "main",
      alias: "main",
      requesterInternalKey: undefined,
      restrictToSpawned: false,
    });
  });

  it("keeps deliveryContext.threadId in sessions_list results", async () => {
    mocks.gatewayCall.mockImplementation(async (opts: unknown) => {
      const request = opts as { method?: string };
      if (request.method === "sessions.list") {
        return {
          path: "/tmp/sessions.json",
          sessions: [
            {
              key: "agent:main:dashboard:child",
              kind: "direct",
              sessionId: "sess-dashboard-child",
              deliveryContext: {
                channel: "discord",
                to: "discord:child",
                accountId: "acct-1",
                threadId: "thread-1",
              },
            },
            {
              key: "agent:main:telegram:topic",
              kind: "direct",
              sessionId: "sess-telegram-topic",
              deliveryContext: {
                channel: "telegram",
                to: "telegram:topic",
                accountId: "acct-2",
                threadId: 271,
              },
            },
          ],
        };
      }
      return {};
    });
    const tool = createSessionsListTool({ config: {} as never });

    const result = await tool.execute("call-1", {});
    const details = result.details as {
      sessions?: Array<{
        deliveryContext?: {
          channel?: string;
          to?: string;
          accountId?: string;
          threadId?: string | number;
        };
      }>;
    };

    expect(details.sessions?.[0]?.deliveryContext).toEqual({
      channel: "discord",
      to: "discord:child",
      accountId: "acct-1",
      threadId: "thread-1",
    });
    expect(details.sessions?.[1]?.deliveryContext).toEqual({
      channel: "telegram",
      to: "telegram:topic",
      accountId: "acct-2",
      threadId: 271,
    });
  });

  it("keeps numeric deliveryContext.threadId in sessions_list results", async () => {
    mocks.gatewayCall.mockImplementation(async (opts: unknown) => {
      const request = opts as { method?: string };
      if (request.method === "sessions.list") {
        return {
          path: "/tmp/sessions.json",
          sessions: [
            {
              key: "agent:main:telegram:group:-100123:topic:99",
              kind: "group",
              sessionId: "sess-telegram-topic",
              deliveryContext: {
                channel: "telegram",
                to: "-100123",
                accountId: "acct-1",
                threadId: 99,
              },
            },
          ],
        };
      }
      return {};
    });
    const tool = createSessionsListTool({ config: {} as never });

    const result = await tool.execute("call-2", {});
    const details = result.details as {
      sessions?: Array<{
        deliveryContext?: {
          channel?: string;
          to?: string;
          accountId?: string;
          threadId?: string | number;
        };
      }>;
    };

    expect(details.sessions?.[0]?.deliveryContext).toEqual({
      channel: "telegram",
      to: "-100123",
      accountId: "acct-1",
      threadId: 99,
    });
  });

  it("keeps live session setting metadata in sessions_list results", async () => {
    mocks.gatewayCall.mockImplementation(async (opts: unknown) => {
      const request = opts as { method?: string };
      if (request.method === "sessions.list") {
        return {
          path: "/tmp/sessions.json",
          sessions: [
            {
              key: "main",
              kind: "direct",
              sessionId: "sess-main",
              thinkingLevel: "high",
              fastMode: true,
              verboseLevel: "on",
              reasoningLevel: "deep",
              elevatedLevel: "on",
              responseUsage: "full",
            },
          ],
        };
      }
      return {};
    });
    const tool = createSessionsListTool({ config: {} as never });

    const result = await tool.execute("call-3", {});
    const details = result.details as {
      sessions?: Array<{
        thinkingLevel?: string;
        fastMode?: boolean;
        verboseLevel?: string;
        reasoningLevel?: string;
        elevatedLevel?: string;
        responseUsage?: string;
      }>;
    };

    expect(details.sessions?.[0]).toMatchObject({
      thinkingLevel: "high",
      fastMode: true,
      verboseLevel: "on",
      reasoningLevel: "deep",
      elevatedLevel: "on",
      responseUsage: "full",
    });
  });

  describe("includeArchived", () => {
    let tmpDir: string;

    beforeEach(async () => {
      tmpDir = await fs.mkdtemp(path.join("/tmp", "sl-test-"));
    });

    afterAll(async () => {});

    it("does not include archived rows when includeArchived is false/default", async () => {
      const sessionsDir = path.join(tmpDir, "sessions");
      await fs.mkdir(sessionsDir, { recursive: true });
      await fs.writeFile(
        path.join(sessionsDir, "sess-old1.jsonl.reset.2026-05-11T10-30-00.000Z"),
        "",
      );

      mocks.gatewayCall.mockImplementation(async (opts: unknown) => {
        const request = opts as { method?: string };
        if (request.method === "sessions.list") {
          return {
            path: path.join(sessionsDir, "sessions.json"),
            sessions: [
              {
                key: "main",
                kind: "direct",
                sessionId: "sess-live",
                updatedAt: 1000,
              },
            ],
          };
        }
        return {};
      });
      const tool = createSessionsListTool({ config: {} as never });

      const result = await tool.execute("call-arch-false", {});
      const details = result.details as {
        count?: number;
        sessions?: Array<{ key?: string; kind?: string }>;
      };

      expect(details.count).toBe(1);
      expect(details.sessions?.every((s) => !s.key?.startsWith("archived:"))).toBe(true);
    });

    it("includes archived .reset. sessions when includeArchived is true", async () => {
      const sessionsDir = path.join(tmpDir, "sessions");
      await fs.mkdir(sessionsDir, { recursive: true });
      const archiveFile = "sess-archived1.jsonl.reset.2026-05-11T10-30-00.000Z";
      await fs.writeFile(path.join(sessionsDir, archiveFile), "");

      mocks.gatewayCall.mockImplementation(async (opts: unknown) => {
        const request = opts as { method?: string };
        if (request.method === "sessions.list") {
          return {
            path: path.join(sessionsDir, "sessions.json"),
            sessions: [
              {
                key: "main",
                kind: "direct",
                sessionId: "sess-live",
                updatedAt: Date.now(),
              },
            ],
          };
        }
        return {};
      });
      const tool = createSessionsListTool({ config: {} as never });

      const result = await tool.execute("call-arch-true", { includeArchived: true });
      const details = result.details as {
        count?: number;
        sessions?: Array<{
          key?: string;
          kind?: string;
          status?: string;
          sessionId?: string;
          transcriptPath?: string;
          updatedAt?: number;
        }>;
      };

      expect(details.count).toBe(2);
      const archived = details.sessions?.find((s) => s.key === "archived:sess-arc");
      expect(archived).toBeDefined();
      expect(archived?.kind).toBe("other");
      expect(archived?.status).toBe("done");
      expect(archived?.sessionId).toBe("sess-archived1");
      expect(archived?.transcriptPath).toBe(path.join(sessionsDir, archiveFile));
      expect(typeof archived?.updatedAt).toBe("number");
    });

    it("includes archived .deleted. sessions when includeArchived is true", async () => {
      const sessionsDir = path.join(tmpDir, "sessions");
      await fs.mkdir(sessionsDir, { recursive: true });
      const archiveFile = "sess-deleted1.jsonl.deleted.2026-05-10T12-00-00.000Z";
      await fs.writeFile(path.join(sessionsDir, archiveFile), "");

      mocks.gatewayCall.mockImplementation(async (opts: unknown) => {
        const request = opts as { method?: string };
        if (request.method === "sessions.list") {
          return {
            path: path.join(sessionsDir, "sessions.json"),
            sessions: [],
          };
        }
        return {};
      });
      const tool = createSessionsListTool({ config: {} as never });

      const result = await tool.execute("call-arch-deleted", { includeArchived: true });
      const details = result.details as {
        count?: number;
        sessions?: Array<{ key?: string; sessionId?: string }>;
      };

      expect(details.count).toBe(1);
      expect(details.sessions?.[0]?.key).toBe("archived:sess-del");
      expect(details.sessions?.[0]?.sessionId).toBe("sess-deleted1");
    });

    it("deduplicates: archived sessionId matching live session is skipped", async () => {
      const sessionsDir = path.join(tmpDir, "sessions");
      await fs.mkdir(sessionsDir, { recursive: true });
      await fs.writeFile(
        path.join(sessionsDir, "sess-dedup.jsonl.reset.2026-05-11T10-30-00.000Z"),
        "",
      );

      mocks.gatewayCall.mockImplementation(async (opts: unknown) => {
        const request = opts as { method?: string };
        if (request.method === "sessions.list") {
          return {
            path: path.join(sessionsDir, "sessions.json"),
            sessions: [
              {
                key: "main",
                kind: "direct",
                sessionId: "sess-dedup",
                updatedAt: 9999,
              },
            ],
          };
        }
        return {};
      });
      const tool = createSessionsListTool({ config: {} as never });

      const result = await tool.execute("call-arch-dedup", { includeArchived: true });
      const details = result.details as {
        count?: number;
        sessions?: Array<{ key?: string; sessionId?: string }>;
      };

      expect(details.count).toBe(1);
      expect(details.sessions?.[0]?.key).toBe("main");
    });

    it("gracefully skips archival scan when storePath is '(multiple)'", async () => {
      mocks.gatewayCall.mockImplementation(async (opts: unknown) => {
        const request = opts as { method?: string };
        if (request.method === "sessions.list") {
          return {
            path: "(multiple)",
            sessions: [
              {
                key: "main",
                kind: "direct",
                sessionId: "sess-live",
                updatedAt: 1000,
              },
            ],
          };
        }
        return {};
      });
      const tool = createSessionsListTool({ config: {} as never });

      const result = await tool.execute("call-arch-multi", { includeArchived: true });
      const details = result.details as {
        count?: number;
        sessions?: Array<{ key?: string }>;
      };

      expect(details.count).toBe(1);
      expect(details.sessions?.[0]?.key).toBe("main");
    });

    it("gracefully skips archival scan when storePath is undefined", async () => {
      mocks.gatewayCall.mockImplementation(async (opts: unknown) => {
        const request = opts as { method?: string };
        if (request.method === "sessions.list") {
          return {
            path: undefined,
            sessions: [
              {
                key: "main",
                kind: "direct",
                sessionId: "sess-live",
                updatedAt: 1000,
              },
            ],
          };
        }
        return {};
      });
      const tool = createSessionsListTool({ config: {} as never });

      const result = await tool.execute("call-arch-nopath", { includeArchived: true });
      const details = result.details as { count?: number };

      expect(details.count).toBe(1);
    });

    it("skips non-archive .jsonl files", async () => {
      const sessionsDir = path.join(tmpDir, "sessions");
      await fs.mkdir(sessionsDir, { recursive: true });
      await fs.writeFile(path.join(sessionsDir, "sess-active.jsonl"), "");
      await fs.writeFile(
        path.join(sessionsDir, "sess-archived.jsonl.reset.2026-05-11T10-30-00.000Z"),
        "",
      );

      mocks.gatewayCall.mockImplementation(async (opts: unknown) => {
        const request = opts as { method?: string };
        if (request.method === "sessions.list") {
          return {
            path: path.join(sessionsDir, "sessions.json"),
            sessions: [],
          };
        }
        return {};
      });
      const tool = createSessionsListTool({ config: {} as never });

      const result = await tool.execute("call-arch-filter", { includeArchived: true });
      const details = result.details as {
        count?: number;
        sessions?: Array<{ key?: string; sessionId?: string }>;
      };

      expect(details.count).toBe(1);
      expect(details.sessions?.[0]?.sessionId).toBe("sess-archived");
    });
  });
});
