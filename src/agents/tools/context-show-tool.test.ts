import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createContextShowTool } from "./context-show-tool.js";

let workspaceDir: string;
let configDir: string;
let origStateDir: string | undefined;

function extractText(result: { content: Array<{ type: string; text?: string }> }): string {
  const textBlock = result.content.find((c) => c.type === "text");
  return textBlock?.text ?? "";
}

beforeEach(() => {
  workspaceDir = mkdtempSync(join(tmpdir(), "ctx-show-ws-"));
  configDir = mkdtempSync(join(tmpdir(), "ctx-show-cfg-"));
  origStateDir = process.env.KAIJIBOT_STATE_DIR;
  process.env.KAIJIBOT_STATE_DIR = configDir;

  writeFileSync(join(workspaceDir, "AGENTS.md"), "# AGENTS\nTest workspace rules.\nUse cron for scheduling.");
  writeFileSync(join(workspaceDir, "SOUL.md"), "# SOUL\nYou are a helpful assistant.");
  writeFileSync(join(workspaceDir, "MEMORY.md"), "# Memory\nThis should not appear in output.");

  mkdirSync(join(configDir, "cognitive", "persona", "main"), { recursive: true });
});

afterEach(() => {
  if (origStateDir !== undefined) {
    process.env.KAIJIBOT_STATE_DIR = origStateDir;
  } else {
    delete process.env.KAIJIBOT_STATE_DIR;
  }
  rmSync(workspaceDir, { recursive: true, force: true });
  rmSync(configDir, { recursive: true, force: true });
});

describe("context_show tool", () => {
  it("returns null when cognitive is disabled", () => {
    const tool = createContextShowTool({
      config: { cognitive: { enabled: false } },
      workspaceDir,
      agentId: "main",
    });
    expect(tool).toBeNull();
  });

  it("returns text result with L1/L2/L3 section headers", async () => {
    const tool = createContextShowTool({
      workspaceDir,
      agentId: "main",
      sessionKey: "feishu:sender:ou_test:main",
    })!;
    const result = await tool.execute("test-call", {});
    const text = extractText(result);
    expect(text).toContain("=== L1 System Prompt");
    expect(text).toContain("=== L2 Workspace Files");
    expect(text).toContain("=== L3 Cognitive Data");
  });

  it("includes L2 file content for bootstrap files", async () => {
    const tool = createContextShowTool({ workspaceDir, agentId: "main" })!;
    const text = extractText(await tool.execute("test-call", {}));
    expect(text).toContain("Test workspace rules.");
    expect(text).toContain("You are a helpful assistant.");
  });

  it("does not mention MEMORY.md in output", async () => {
    const tool = createContextShowTool({ workspaceDir, agentId: "main" })!;
    const text = extractText(await tool.execute("test-call", {}));
    expect(text).not.toContain("MEMORY.md");
    expect(text).not.toContain("consolidation-managed");
    expect(text).not.toContain("This should not appear in output.");
  });

  it("includes token estimates for L2 files", async () => {
    const tool = createContextShowTool({ workspaceDir, agentId: "main" })!;
    const text = extractText(await tool.execute("test-call", {}));
    expect(text).toMatch(/~\d+ tok/);
    expect(text).toContain("chars");
  });

  it("includes L1 full system prompt text", async () => {
    const tool = createContextShowTool({ workspaceDir, agentId: "main" })!;
    const text = extractText(await tool.execute("test-call", {}));
    expect(text).toContain("=== L1 System Prompt");
    expect(text).toContain("full text");
    expect(text).toMatch(/~\d+ tokens/);
  });

  it("handles missing workspace gracefully", async () => {
    const tool = createContextShowTool({ workspaceDir: undefined, agentId: "main" })!;
    const text = extractText(await tool.execute("test-call", {}));
    expect(text).toContain("No workspace directory");
  });

  it("shows corrections when store has data", async () => {
    mkdirSync(join(configDir, "cognitive", "corrections", "main"), { recursive: true });
    writeFileSync(
      join(configDir, "cognitive", "corrections", "main", "operator.json"),
      JSON.stringify({
        corrections: [
          {
            id: "test-1",
            domain: "coding",
            trigger: "writing code",
            mistake: "used var",
            correction: "use const",
            provenance: "self",
            reinforcedCount: 2,
            createdAt: Date.now(),
            lastReinforced: Date.now(),
          },
        ],
      }),
    );

    const tool = createContextShowTool({
      workspaceDir,
      agentId: "main",
      sessionKey: "feishu:sender:ou_test:main",
    })!;
    const text = extractText(await tool.execute("test-call", {}));
    expect(text).toContain("Corrections");
    expect(text).toContain("coding");
    expect(text).toContain("use const");
  });

  it("has correct tool metadata", () => {
    const tool = createContextShowTool({ workspaceDir, agentId: "main" })!;
    expect(tool.name).toBe("context_show");
    expect(tool.label).toBe("Context Show");
    expect(tool.description).toBeTruthy();
    expect(tool.parameters).toBeDefined();
  });
});
