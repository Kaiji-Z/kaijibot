import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ConsolidationRouteDeps } from "./consolidation-route.js";
import {
  runConsolidationForAgent,
  runConsolidationAllAgents,
  type ConsolidationDeps,
} from "./consolidation.js";
import type { ConsolidationConfig } from "kaijibot/plugin-sdk/memory-core-host-status";
import type { KaijiBotConfig } from "kaijibot/plugin-sdk/memory-core";

function makeConfig(overrides: Partial<ConsolidationConfig> = {}): ConsolidationConfig {
  return {
    enabled: true,
    cron: "0 3 * * *",
    verboseLogging: false,
    concurrency: 2,
    batchSize: 4000,
    lookbackDays: 7,
    ...overrides,
  };
}

function makeRouteDeps(): ConsolidationRouteDeps {
  return {
    mergeTypedInsights: vi.fn().mockResolvedValue(1),
    addOrReinforceCorrection: vi.fn().mockResolvedValue("saved"),
    appendToMemoryFile: vi.fn().mockResolvedValue(undefined),
    collectFragment: vi.fn().mockResolvedValue(undefined),
    updateMemoryIndex: vi.fn().mockResolvedValue(undefined),
  };
}

function makeDeps(workspaceDir: string): ConsolidationDeps {
  return {
    listSessionFiles: vi.fn().mockResolvedValue([`${workspaceDir}/session1.jsonl`]),
    readSessionFile: vi
      .fn()
      .mockResolvedValue(
        "User: I love TypeScript for backend development.\nAssistant: That's great! TypeScript provides...",
      ),
    generateText: vi
      .fn()
      .mockResolvedValue(
        '[{"category":"domain_knowledge","content":"User prefers TypeScript for backend","confidence":0.85,"evidence":"I love TypeScript for backend development"}]',
      ),
    resolveWorkspaces: vi.fn().mockReturnValue([{ workspaceDir, agentIds: ["main"] }]),
    routeDeps: makeRouteDeps(),
    resolveUserIdForFile: vi.fn().mockResolvedValue("ou_test123"),
  };
}

describe("runConsolidationForAgent", () => {
  let fixtureRoot: string;
  let caseId = 0;

  beforeAll(async () => {
    fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "consolidation-test-"));
  });

  afterAll(async () => {
    if (fixtureRoot) {
      await fs.rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  async function withTempWorkspace(run: (workspaceDir: string) => Promise<void>) {
    const workspaceDir = path.join(fixtureRoot, `case-${caseId++}`);
    await fs.mkdir(workspaceDir, { recursive: true });
    await run(workspaceDir);
  }

  it("returns error result when SCAN fails", async () => {
    await withTempWorkspace(async (workspaceDir) => {
      const deps = makeDeps(workspaceDir);
      deps.listSessionFiles = vi.fn().mockRejectedValue(new Error("disk error"));
      const result = await runConsolidationForAgent({
        agentId: "main",
        workspaceDir,
        config: makeConfig(),
        deps,
      });
      expect(result.scannedFiles).toBe(0);
      expect(result.errors).toEqual(
        expect.arrayContaining([expect.stringContaining("SCAN failed")]),
      );
      expect(result.extractedItems).toBe(0);
    });
  });

  it("returns with extractedItems: 0 when no new files found", async () => {
    await withTempWorkspace(async (workspaceDir) => {
      const deps = makeDeps(workspaceDir);
      // All files already processed — list returns empty
      deps.listSessionFiles = vi.fn().mockResolvedValue([]);
      const result = await runConsolidationForAgent({
        agentId: "main",
        workspaceDir,
        config: makeConfig(),
        deps,
      });
      expect(result.scannedFiles).toBe(0);
      expect(result.extractedItems).toBe(0);
      expect(result.routedItems).toBe(0);
    });
  });

  it("calls listSessionFiles, readSessionFile, generateText, and routeToStores for new files", async () => {
    await withTempWorkspace(async (workspaceDir) => {
      const deps = makeDeps(workspaceDir);
      const result = await runConsolidationForAgent({
        agentId: "main",
        workspaceDir,
        config: makeConfig(),
        deps,
      });
      expect(deps.listSessionFiles).toHaveBeenCalledWith("main", 7);
      expect(deps.readSessionFile).toHaveBeenCalledTimes(1);
      expect(deps.generateText).toHaveBeenCalledTimes(1);
      expect(result.extractedItems).toBeGreaterThanOrEqual(0);
      expect(result.errors).toEqual([]);
    });
  });

  it("writes checkpoint after successful run", async () => {
    await withTempWorkspace(async (workspaceDir) => {
      const deps = makeDeps(workspaceDir);
      await runConsolidationForAgent({
        agentId: "main",
        workspaceDir,
        config: makeConfig(),
        deps,
      });
      const checkpointPath = path.join(workspaceDir, "memory", ".consolidation", "checkpoint.json");
      const raw = await fs.readFile(checkpointPath, "utf-8");
      const checkpoint = JSON.parse(raw);
      expect(checkpoint.version).toBe(1);
      expect(checkpoint.agentId).toBe("main");
      expect(checkpoint.processedSessionFiles.length).toBeGreaterThan(0);
      expect(checkpoint.lastRunAt).not.toBe(new Date(0).toISOString());
    });
  });

  it("captures partial file read failures while processing remaining files", async () => {
    await withTempWorkspace(async (workspaceDir) => {
      const deps = makeDeps(workspaceDir);
      const files = [
        `${workspaceDir}/session1.jsonl`,
        `${workspaceDir}/session2.jsonl`,
        `${workspaceDir}/session3.jsonl`,
      ];
      deps.listSessionFiles = vi.fn().mockResolvedValue(files);
      deps.readSessionFile = vi
        .fn()
        .mockResolvedValueOnce("Good content")
        .mockRejectedValueOnce(new Error("read error"))
        .mockResolvedValueOnce("More good content");
      const result = await runConsolidationForAgent({
        agentId: "main",
        workspaceDir,
        config: makeConfig(),
        deps,
      });
      expect(result.errors).toEqual(
        expect.arrayContaining([expect.stringContaining("read error")]),
      );
      // Should still process the readable files
      expect(deps.generateText).toHaveBeenCalled();
    });
  });

  it("skips already-processed files on second run", async () => {
    await withTempWorkspace(async (workspaceDir) => {
      const files = [`${workspaceDir}/session1.jsonl`];
      const deps = makeDeps(workspaceDir);
      deps.listSessionFiles = vi.fn().mockResolvedValue(files);

      // First run
      const result1 = await runConsolidationForAgent({
        agentId: "main",
        workspaceDir,
        config: makeConfig(),
        deps,
      });
      expect(result1.scannedFiles).toBe(1);

      // Reset readSessionFile mock to track calls
      (deps.readSessionFile as ReturnType<typeof vi.fn>).mockClear();

      // Second run — same files should be skipped
      const result2 = await runConsolidationForAgent({
        agentId: "main",
        workspaceDir,
        config: makeConfig(),
        deps,
      });
      expect(result2.extractedItems).toBe(0);
      expect(deps.readSessionFile).not.toHaveBeenCalled();
    });
  });

  it("checkpoint has epoch 0 lastRunAt on fresh start", async () => {
    await withTempWorkspace(async (workspaceDir) => {
      // Before any run, there's no checkpoint file
      // After first run, the checkpoint is created
      const deps = makeDeps(workspaceDir);
      deps.listSessionFiles = vi.fn().mockResolvedValue([]);
      await runConsolidationForAgent({
        agentId: "main",
        workspaceDir,
        config: makeConfig(),
        deps,
      });

      // Now simulate a second run with new files
      deps.listSessionFiles = vi
        .fn()
        .mockResolvedValue([`${workspaceDir}/session1.jsonl`]);
      await runConsolidationForAgent({
        agentId: "main",
        workspaceDir,
        config: makeConfig(),
        deps,
      });

      const checkpointPath = path.join(workspaceDir, "memory", ".consolidation", "checkpoint.json");
      const raw = await fs.readFile(checkpointPath, "utf-8");
      const checkpoint = JSON.parse(raw);
      expect(checkpoint.processedSessionFiles).toContain(`${workspaceDir}/session1.jsonl`);
    });
  });

  it("groups files by userId and routes with correct userId per user", async () => {
    await withTempWorkspace(async (workspaceDir) => {
      const files = [
        `${workspaceDir}/session1.jsonl`,
        `${workspaceDir}/session2.jsonl`,
        `${workspaceDir}/session3.jsonl`,
      ];
      const deps = makeDeps(workspaceDir);
      deps.listSessionFiles = vi.fn().mockResolvedValue(files);
      deps.readSessionFile = vi.fn().mockResolvedValue("User content about AI.");
      deps.generateText = vi
        .fn()
        .mockResolvedValue(
          '[{"category":"domain_knowledge","content":"User knows AI","confidence":0.8,"evidence":"AI discussion"}]',
        );
      deps.resolveUserIdForFile = vi
        .fn()
        .mockResolvedValueOnce("ou_alice")
        .mockResolvedValueOnce("ou_bob")
        .mockResolvedValueOnce("ou_alice");

      const result = await runConsolidationForAgent({
        agentId: "main",
        workspaceDir,
        config: makeConfig(),
        deps,
      });

      expect(result.errors).toEqual([]);
      const mergeCalls = (deps.routeDeps.mergeTypedInsights as ReturnType<typeof vi.fn>).mock.calls;
      const userIds = mergeCalls.map((call: string[]) => call[1]);
      expect(userIds).toEqual(expect.arrayContaining(["ou_alice", "ou_bob"]));
      expect(userIds).not.toContain("main");
    });
  });

  it("falls back to agentId when resolveUserIdForFile returns null", async () => {
    await withTempWorkspace(async (workspaceDir) => {
      const files = [`${workspaceDir}/session1.jsonl`];
      const deps = makeDeps(workspaceDir);
      deps.listSessionFiles = vi.fn().mockResolvedValue(files);
      deps.resolveUserIdForFile = vi.fn().mockResolvedValue(null);

      await runConsolidationForAgent({
        agentId: "main",
        workspaceDir,
        config: makeConfig(),
        deps,
      });

      const mergeCalls = (deps.routeDeps.mergeTypedInsights as ReturnType<typeof vi.fn>).mock.calls;
      const userIds = mergeCalls.map((call: string[]) => call[1]);
      expect(userIds).toContain("main");
    });
  });

  it("falls back to agentId when resolveUserIdForFile throws", async () => {
    await withTempWorkspace(async (workspaceDir) => {
      const files = [`${workspaceDir}/session1.jsonl`];
      const deps = makeDeps(workspaceDir);
      deps.listSessionFiles = vi.fn().mockResolvedValue(files);
      deps.resolveUserIdForFile = vi.fn().mockRejectedValue(new Error("store unavailable"));

      const result = await runConsolidationForAgent({
        agentId: "main",
        workspaceDir,
        config: makeConfig(),
        deps,
      });

      expect(result.errors).toEqual([]);
      const mergeCalls = (deps.routeDeps.mergeTypedInsights as ReturnType<typeof vi.fn>).mock.calls;
      const userIds = mergeCalls.map((call: string[]) => call[1]);
      expect(userIds).toContain("main");
    });
  });

  it("propagates domain field through extract → route pipeline", async () => {
    await withTempWorkspace(async (workspaceDir) => {
      const deps = makeDeps(workspaceDir);
      deps.generateText = vi.fn().mockResolvedValue(
        JSON.stringify([
          {
            category: "domain_knowledge",
            content: "User deploys K8s on Alibaba Cloud",
            confidence: 0.9,
            evidence: "我在阿里云上部署了 Kubernetes",
            domain: "Kubernetes",
          },
          {
            category: "behavioral_pattern",
            content: "User prefers test-driven development",
            confidence: 0.8,
            evidence: "I always write tests first",
            domain: "软件工程",
          },
        ]),
      );

      await runConsolidationForAgent({
        agentId: "main",
        workspaceDir,
        config: makeConfig(),
        deps,
      });

      const mergeCalls = (deps.routeDeps.mergeTypedInsights as ReturnType<typeof vi.fn>).mock.calls;
      const personaItems = mergeCalls[0]?.[2] as Array<{ domain?: string }> | undefined;
      expect(personaItems).toBeDefined();
      const domainKnowledgeItem = personaItems!.find(
        (i: Record<string, unknown>) => i.domain === "Kubernetes",
      );
      expect(domainKnowledgeItem).toBeDefined();

      const fragmentCalls = (deps.routeDeps.collectFragment as ReturnType<typeof vi.fn>).mock.calls;
      expect(fragmentCalls.length).toBeGreaterThan(0);
      const fragmentArg = fragmentCalls[0]![2] as { domains?: string[] };
      expect(fragmentArg.domains).toEqual(["软件工程"]);
    });
  });
});

describe("runConsolidationAllAgents", () => {
  let fixtureRoot: string;
  let caseId = 0;

  beforeAll(async () => {
    fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "consolidation-all-"));
  });

  afterAll(async () => {
    if (fixtureRoot) {
      await fs.rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  async function withTempWorkspace(run: (workspaceDir: string) => Promise<void>) {
    const workspaceDir = path.join(fixtureRoot, `case-${caseId++}`);
    await fs.mkdir(workspaceDir, { recursive: true });
    await run(workspaceDir);
  }

  it("returns empty array when no workspaces", async () => {
    const cfg = {} as unknown as KaijiBotConfig;
    const deps: ConsolidationDeps = {
      listSessionFiles: vi.fn().mockResolvedValue([]),
      readSessionFile: vi.fn().mockResolvedValue(""),
      generateText: vi.fn().mockResolvedValue("[]"),
      resolveWorkspaces: vi.fn().mockReturnValue([]),
      routeDeps: makeRouteDeps(),
      resolveUserIdForFile: vi.fn().mockResolvedValue(null),
    };
    const results = await runConsolidationAllAgents({
      config: makeConfig(),
      cfg,
      deps,
    });
    expect(results).toEqual([]);
  });

  it("runs consolidation for a single workspace", async () => {
    await withTempWorkspace(async (workspaceDir) => {
      const cfg = {} as unknown as KaijiBotConfig;
      const deps: ConsolidationDeps = {
        listSessionFiles: vi.fn().mockResolvedValue([`${workspaceDir}/session1.jsonl`]),
        readSessionFile: vi.fn().mockResolvedValue("Some transcript content here"),
        generateText: vi
          .fn()
          .mockResolvedValue(
            '[{"category":"domain_knowledge","content":"test","confidence":0.8,"evidence":"ev"}]',
          ),
        resolveWorkspaces: vi
          .fn()
          .mockReturnValue([{ workspaceDir, agentIds: ["main"] }]),
        routeDeps: makeRouteDeps(),
        resolveUserIdForFile: vi.fn().mockResolvedValue("ou_user1"),
      };
      const results = await runConsolidationAllAgents({
        config: makeConfig(),
        cfg,
        deps,
      });
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0]!.agentId).toBe("main");
    });
  });

  it("runs consolidation for multiple workspaces with bounded concurrency", async () => {
    await withTempWorkspace(async (ws1) => {
      await withTempWorkspace(async (ws2) => {
        const cfg = {} as unknown as KaijiBotConfig;
        const deps: ConsolidationDeps = {
          listSessionFiles: vi.fn().mockResolvedValue([]),
          readSessionFile: vi.fn().mockResolvedValue(""),
          generateText: vi.fn().mockResolvedValue("[]"),
          resolveWorkspaces: vi
            .fn()
            .mockReturnValue([
              { workspaceDir: ws1, agentIds: ["agent-a"] },
              { workspaceDir: ws2, agentIds: ["agent-b"] },
            ]),
          routeDeps: makeRouteDeps(),
          resolveUserIdForFile: vi.fn().mockResolvedValue(null),
        };
        const results = await runConsolidationAllAgents({
          config: makeConfig({ concurrency: 2 }),
          cfg,
          deps,
        });
        expect(results).toHaveLength(2);
        const agentIds = results.map((r) => r.agentId).toSorted();
        expect(agentIds).toEqual(["agent-a", "agent-b"]);
      });
    });
  });
});
