import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KaijiBotConfig } from "../../config/config.js";

const loadConfig = vi.hoisted(() => vi.fn(() => ({}) as KaijiBotConfig));
const resolveDefaultAgentId = vi.hoisted(() => vi.fn(() => "main"));
const resolveAgentWorkspaceDir = vi.hoisted(() =>
  vi.fn((_cfg: KaijiBotConfig, _agentId: string) => "/tmp/kaijibot"),
);
const resolveMemorySearchConfig = vi.hoisted(() =>
  vi.fn<(_cfg: KaijiBotConfig, _agentId: string) => { enabled: boolean } | null>(() => ({
    enabled: true,
  })),
);
const getMemorySearchManager = vi.hoisted(() => vi.fn());
const removeGroundedShortTermCandidates = vi.hoisted(() => vi.fn());

vi.mock("../../config/config.js", () => ({
  loadConfig,
}));

vi.mock("../../agents/agent-scope.js", () => ({
  resolveDefaultAgentId,
  resolveAgentWorkspaceDir,
}));

vi.mock("../../agents/memory-search.js", () => ({
  resolveMemorySearchConfig,
}));

vi.mock("../../plugins/memory-runtime.js", () => ({
  getActiveMemorySearchManager: getMemorySearchManager,
}));

vi.mock("./doctor.memory-core-runtime.js", () => ({
  removeGroundedShortTermCandidates,
}));

import { doctorHandlers } from "./doctor.js";

const invokeDoctorMemoryStatus = async (
  respond: ReturnType<typeof vi.fn>,
  context?: { cron?: { list?: ReturnType<typeof vi.fn> } },
) => {
  const cronList =
    context?.cron?.list ??
    vi.fn(async () => {
      return [];
    });
  await doctorHandlers["doctor.memory.status"]({
    req: {} as never,
    params: {} as never,
    respond: respond as never,
    context: {
      cron: {
        list: cronList,
      },
    } as never,
    client: null,
    isWebchatConnect: () => false,
  });
};

const invokeDoctorMemoryResetGroundedShortTerm = async (respond: ReturnType<typeof vi.fn>) => {
  await doctorHandlers["doctor.memory.resetGroundedShortTerm"]({
    req: {} as never,
    params: {} as never,
    respond: respond as never,
    context: {} as never,
    client: null,
    isWebchatConnect: () => false,
  });
};

const expectEmbeddingErrorResponse = (respond: ReturnType<typeof vi.fn>, error: string) => {
  expect(respond).toHaveBeenCalledWith(
    true,
    expect.objectContaining({
      agentId: "main",
      embedding: {
        ok: false,
        error,
      },
    }),
    undefined,
  );
};

describe("doctor.memory.status", () => {
  beforeEach(() => {
    loadConfig.mockClear();
    resolveDefaultAgentId.mockClear();
    resolveAgentWorkspaceDir.mockReset().mockReturnValue("/tmp/kaijibot");
    resolveMemorySearchConfig.mockReset().mockReturnValue({ enabled: true });
    getMemorySearchManager.mockReset();
    removeGroundedShortTermCandidates.mockReset();
  });

  it("returns gateway embedding probe status for the default agent", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    getMemorySearchManager.mockResolvedValue({
      manager: {
        status: () => ({ provider: "gemini" }),
        probeEmbeddingAvailability: vi.fn().mockResolvedValue({ ok: true }),
        close,
      },
    });
    const respond = vi.fn();

    await invokeDoctorMemoryStatus(respond);

    expect(getMemorySearchManager).toHaveBeenCalledWith({
      cfg: expect.any(Object),
      agentId: "main",
      purpose: "status",
    });
    expect(respond).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        agentId: "main",
        provider: "gemini",
        embedding: { ok: true },
      }),
      undefined,
    );
    expect(close).toHaveBeenCalled();
  });

  it("returns unavailable when memory manager is missing", async () => {
    getMemorySearchManager.mockResolvedValue({
      manager: null,
      error: "memory search unavailable",
    });
    const respond = vi.fn();

    await invokeDoctorMemoryStatus(respond);

    expectEmbeddingErrorResponse(respond, "memory search unavailable");
  });

  it("returns probe failure when manager probe throws", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    getMemorySearchManager.mockResolvedValue({
      manager: {
        status: () => ({ provider: "openai" }),
        probeEmbeddingAvailability: vi.fn().mockRejectedValue(new Error("timeout")),
        close,
      },
    });
    const respond = vi.fn();

    await invokeDoctorMemoryStatus(respond);

    expectEmbeddingErrorResponse(respond, "gateway memory probe failed: timeout");
    expect(close).toHaveBeenCalled();
  });
});

describe("doctor.memory resetGroundedShortTerm", () => {
  beforeEach(() => {
    loadConfig.mockClear();
    resolveDefaultAgentId.mockClear();
    resolveAgentWorkspaceDir.mockReset().mockReturnValue("/tmp/kaijibot");
    removeGroundedShortTermCandidates.mockReset();
  });

  it("clears grounded-only staged short-term entries", async () => {
    resolveAgentWorkspaceDir.mockReturnValue("/tmp/kaijibot");
    removeGroundedShortTermCandidates.mockResolvedValue({
      removed: 3,
      storePath: "/tmp/kaijibot/memory/.dreams/short-term-recall.json",
    });
    const respond = vi.fn();

    await invokeDoctorMemoryResetGroundedShortTerm(respond);

    expect(removeGroundedShortTermCandidates).toHaveBeenCalledWith({
      workspaceDir: "/tmp/kaijibot",
    });
    expect(respond).toHaveBeenCalledWith(
      true,
      {
        agentId: "main",
        action: "resetGroundedShortTerm",
        removedShortTermEntries: 3,
      },
      undefined,
    );
  });
});
