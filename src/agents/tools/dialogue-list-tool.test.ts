import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock resolveAgentWorkspaceDir to return a controlled temp directory
const workspaceDir: string[] = [];
vi.mock("../agent-scope.js", () => ({
  resolveAgentWorkspaceDir: (_cfg: unknown, _agentId: string) => workspaceDir[0],
}));

// Mock loadConfig to avoid reading real config
vi.mock("../../config/config.js", () => ({
  loadConfig: vi.fn(() => ({})),
}));

import { createDialogueListTool } from "./dialogue-list-tool.js";

function parseDetails(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && "details" in raw) {
    return (raw as { details: Record<string, unknown> }).details;
  }
  return raw as Record<string, unknown>;
}

describe("createDialogueListTool", () => {
  const tool = createDialogueListTool();
  let tmpDir: string;
  let dialogueDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "dialogue-list-test-"));
    dialogueDir = path.join(tmpDir, "memory", "dialogues");
    await fs.mkdir(dialogueDir, { recursive: true });
    workspaceDir[0] = tmpDir;
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
    workspaceDir[0] = "";
  });

  async function writeDialogue(filename: string, content = ""): Promise<void> {
    await fs.writeFile(path.join(dialogueDir, filename), content, "utf-8");
  }

  it("has correct tool name and label", () => {
    expect(tool.name).toBe("dialogue_list");
    expect(tool.label).toBe("Dialogue List");
  });

  it("returns empty list when dialogues dir is empty", async () => {
    const raw = await tool.execute("tc_0", {});
    const result = parseDetails(raw);
    expect(result.count).toBe(0);
    expect(result.dialogues).toEqual([]);
  });

  it("returns empty list when dialogues dir does not exist", async () => {
    workspaceDir[0] = path.join(tmpDir, "nonexistent");
    const raw = await tool.execute("tc_0", {});
    const result = parseDetails(raw);
    expect(result.count).toBe(0);
    expect(result.dialogues).toEqual([]);
  });

  it("lists dialogue files with parsed metadata", async () => {
    await writeDialogue("2026-01-15-0930.md");
    const raw = await tool.execute("tc_0", {});
    const result = parseDetails(raw);
    expect(result.count).toBe(1);
    const list = result.dialogues as Array<Record<string, string>>;
    expect(list[0].date).toBe("2026-01-15");
    expect(list[0].time).toBe("09:30");
    expect(list[0].filename).toBe("2026-01-15-0930.md");
    expect(list[0].path).toBe("memory/dialogues/2026-01-15-0930.md");
  });

  it("sorts by date descending (newest first)", async () => {
    await writeDialogue("2026-01-10-0800.md");
    await writeDialogue("2026-01-20-1500.md");
    await writeDialogue("2026-01-15-1200.md");
    const raw = await tool.execute("tc_0", {});
    const result = parseDetails(raw);
    expect(result.count).toBe(3);
    const list = result.dialogues as Array<Record<string, string>>;
    expect(list[0].date).toBe("2026-01-20");
    expect(list[1].date).toBe("2026-01-15");
    expect(list[2].date).toBe("2026-01-10");
  });

  it("filters by dateFrom", async () => {
    await writeDialogue("2026-01-10-0800.md");
    await writeDialogue("2026-01-15-1200.md");
    await writeDialogue("2026-01-20-1500.md");
    const raw = await tool.execute("tc_0", { dateFrom: "2026-01-15" });
    const result = parseDetails(raw);
    expect(result.count).toBe(2);
    const list = result.dialogues as Array<Record<string, string>>;
    expect(list[0].date).toBe("2026-01-20");
    expect(list[1].date).toBe("2026-01-15");
  });

  it("filters by dateTo", async () => {
    await writeDialogue("2026-01-10-0800.md");
    await writeDialogue("2026-01-15-1200.md");
    await writeDialogue("2026-01-20-1500.md");
    const raw = await tool.execute("tc_0", { dateTo: "2026-01-15" });
    const result = parseDetails(raw);
    expect(result.count).toBe(2);
    const list = result.dialogues as Array<Record<string, string>>;
    expect(list[0].date).toBe("2026-01-15");
    expect(list[1].date).toBe("2026-01-10");
  });

  it("filters by dateFrom and dateTo combined", async () => {
    await writeDialogue("2026-01-10-0800.md");
    await writeDialogue("2026-01-15-1200.md");
    await writeDialogue("2026-01-20-1500.md");
    const raw = await tool.execute("tc_0", {
      dateFrom: "2026-01-12",
      dateTo: "2026-01-18",
    });
    const result = parseDetails(raw);
    expect(result.count).toBe(1);
    const list = result.dialogues as Array<Record<string, string>>;
    expect(list[0].date).toBe("2026-01-15");
  });

  it("respects limit", async () => {
    for (let i = 1; i <= 5; i++) {
      await writeDialogue(`2026-01-${String(i).padStart(2, "0")}-0900.md`);
    }
    const raw = await tool.execute("tc_0", { limit: 3 });
    const result = parseDetails(raw);
    expect(result.count).toBe(3);
    // Newest first
    const list = result.dialogues as Array<Record<string, string>>;
    expect(list[0].date).toBe("2026-01-05");
  });

  it("defaults limit to 20", async () => {
    for (let i = 1; i <= 25; i++) {
      const day = String(i).padStart(2, "0");
      await writeDialogue(`2026-01-${day}-0900.md`);
    }
    const raw = await tool.execute("tc_0", {});
    const result = parseDetails(raw);
    expect(result.count).toBe(20);
  });

  it("skips malformed filenames", async () => {
    await writeDialogue("2026-01-15-0930.md");
    await writeDialogue("not-a-dialogue.txt");
    await writeDialogue("bad-pattern.md");
    await writeDialogue("2026-01-15.md");
    await writeDialogue("2026-01-15-0930-some-topic.md"); // old format, should be skipped
    const raw = await tool.execute("tc_0", {});
    const result = parseDetails(raw);
    expect(result.count).toBe(1);
  });

  it("skips non-md files", async () => {
    await writeDialogue("2026-01-15-0930.md");
    await fs.writeFile(path.join(dialogueDir, "2026-01-15-0930.txt"), "");
    const raw = await tool.execute("tc_0", {});
    const result = parseDetails(raw);
    expect(result.count).toBe(1);
  });
});
