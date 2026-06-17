import { describe, expect, it, vi, beforeEach } from "vitest";
import type { KaijiBotConfig } from "../config/config.js";
import type { HookStatusEntry, HookStatusReport } from "../hooks/hooks-status.js";
import type { RuntimeEnv } from "../runtime.js";
import type { WizardPrompter } from "../wizard/prompts.js";
import { setupInternalHooks } from "./onboard-hooks.js";

// Mock hook discovery modules
vi.mock("../hooks/hooks-status.js", () => ({
  buildWorkspaceHookStatus: vi.fn(),
}));

vi.mock("../agents/agent-scope.js", () => ({
  resolveAgentWorkspaceDir: vi.fn().mockReturnValue("/mock/workspace"),
  resolveDefaultAgentId: vi.fn().mockReturnValue("main"),
}));

describe("onboard-hooks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const createMockPrompter = (): WizardPrompter => ({
    confirm: vi.fn().mockResolvedValue(true),
    note: vi.fn().mockResolvedValue(undefined),
    intro: vi.fn().mockResolvedValue(undefined),
    outro: vi.fn().mockResolvedValue(undefined),
    text: vi.fn().mockResolvedValue(""),
    select: vi.fn().mockResolvedValue(""),
    multiselect: vi.fn().mockResolvedValue([]),
    progress: vi.fn().mockReturnValue({
      stop: vi.fn(),
      update: vi.fn(),
    }),
  });

  const createMockRuntime = (): RuntimeEnv => ({
    log: vi.fn(),
    error: vi.fn(),
    exit: vi.fn(),
  });

  const createMockHook = (
    params: {
      name: string;
      description: string;
      filePath: string;
      baseDir: string;
      handlerPath: string;
      hookKey: string;
      emoji: string;
      events: string[];
    },
    eligible: boolean,
  ) => ({
    blockedReason: (eligible
      ? undefined
      : "missing requirements") as HookStatusEntry["blockedReason"],
    ...params,
    source: "kaijibot-bundled" as const,
    pluginId: undefined,
    homepage: undefined,
    always: false,
    enabledByConfig: eligible,
    requirementsSatisfied: eligible,
    loadable: eligible,
    managedByPlugin: false,
    requirements: {
      bins: [],
      anyBins: [],
      env: [],
      config: ["workspace.dir"],
      os: [],
    },
    missing: {
      bins: [],
      anyBins: [],
      env: [],
      config: eligible ? [] : ["workspace.dir"],
      os: [],
    },
    configChecks: [],
    install: [],
  });

  const createMockHookReport = (eligible = true): HookStatusReport => ({
    workspaceDir: "/mock/workspace",
    managedHooksDir: "/mock/.kaijibot/hooks",
    hooks: [
      createMockHook(
        {
          name: "session-memory",
          description: "Save session context to memory when /new or /reset command is issued",
          filePath: "/mock/workspace/hooks/session-memory/HOOK.md",
          baseDir: "/mock/workspace/hooks/session-memory",
          handlerPath: "/mock/workspace/hooks/session-memory/handler.js",
          hookKey: "session-memory",
          emoji: "💾",
          events: ["command:new", "command:reset"],
        },
        eligible,
      ),
      createMockHook(
        {
          name: "command-logger",
          description: "Log all command events to a centralized audit file",
          filePath: "/mock/workspace/hooks/command-logger/HOOK.md",
          baseDir: "/mock/workspace/hooks/command-logger",
          handlerPath: "/mock/workspace/hooks/command-logger/handler.js",
          hookKey: "command-logger",
          emoji: "📝",
          events: ["command"],
        },
        eligible,
      ),
    ],
  });

  async function runSetupInternalHooks(params: { cfg?: KaijiBotConfig; eligible?: boolean }) {
    const { buildWorkspaceHookStatus } = await import("../hooks/hooks-status.js");
    vi.mocked(buildWorkspaceHookStatus).mockReturnValue(
      createMockHookReport(params.eligible ?? true),
    );

    const cfg = params.cfg ?? {};
    const prompter = createMockPrompter();
    const runtime = createMockRuntime();
    const result = await setupInternalHooks(cfg, runtime, prompter);
    return { result, cfg, prompter };
  }

  describe("setupInternalHooks", () => {
    it("auto-enables all eligible hooks", async () => {
      const { result } = await runSetupInternalHooks({});

      expect(result.hooks?.internal?.enabled).toBe(true);
      expect(result.hooks?.internal?.entries).toEqual({
        "session-memory": { enabled: true },
        "command-logger": { enabled: true },
      });
    });

    it("returns config unchanged when no eligible hooks", async () => {
      const { result, cfg, prompter } = await runSetupInternalHooks({
        eligible: false,
      });

      expect(result).toEqual(cfg);
      expect(prompter.note).not.toHaveBeenCalled();
    });

    it("preserves existing hooks config", async () => {
      const cfg: KaijiBotConfig = {
        hooks: {
          enabled: true,
          path: "/webhook",
          token: "existing-token",
        },
      };
      const { result } = await runSetupInternalHooks({ cfg });

      expect(result.hooks?.enabled).toBe(true);
      expect(result.hooks?.path).toBe("/webhook");
      expect(result.hooks?.token).toBe("existing-token");
      expect(result.hooks?.internal?.enabled).toBe(true);
      expect(result.hooks?.internal?.entries).toEqual({
        "session-memory": { enabled: true },
        "command-logger": { enabled: true },
      });
    });

    it("does not prompt user for selection", async () => {
      const { prompter } = await runSetupInternalHooks({});

      expect(prompter.multiselect).not.toHaveBeenCalled();
      expect(prompter.confirm).not.toHaveBeenCalled();
    });

    it("shows confirmation note with enabled hooks", async () => {
      const { prompter } = await runSetupInternalHooks({});

      const noteCalls = (prompter.note as ReturnType<typeof vi.fn>).mock.calls;
      expect(noteCalls).toHaveLength(1);
      expect(noteCalls[0][0]).toContain("Enabled 2 hooks: session-memory, command-logger");
      expect(noteCalls[0][0]).toMatch(/hooks list/);
    });
  });
});
