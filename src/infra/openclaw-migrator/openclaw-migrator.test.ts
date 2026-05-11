import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createTrackedTempDirs } from "../../test-utils/tracked-temp-dirs.js";
import { detectMigrationSource, detectScenario } from "./detect.js";
import { enumerateSourceAgents, enumerateSourceSkills } from "./agent-enumeration.js";
import { runFreshMigration, runImportMigration, runMigration } from "./index.js";
import { migrateConfig } from "./migrate-config.js";
import { migrateSessions } from "./migrate-sessions.js";
import { migrateSkills } from "./migrate-skills.js";
import { migrateWorkspace } from "./migrate-workspace.js";
import type { DataType, MigrationOptions, MigrationSource } from "./types.js";

const tempDirs = createTrackedTempDirs();
const createTempDir = () => tempDirs.make("kaijibot-openclaw-migrator-test-");

afterEach(async () => {
  await tempDirs.cleanup();
});

function makeSource(dir: string, brand: MigrationSource["brand"] = "openclaw"): MigrationSource {
  const configFilename = `${brand}.json`;
  return {
    dir,
    brand,
    configPath: path.join(dir, configFilename),
    configFilename,
  };
}

function defaultOptions(overrides?: Partial<MigrationOptions>): MigrationOptions {
  return {
    dryRun: false,
    overwrite: false,
    migrateSecrets: false,
    ...overrides,
  };
}

// ─── detect.ts ────────────────────────────────────────────────────────────────

describe("detectMigrationSource", () => {
  it("detects ~/.openclaw with openclaw.json", async () => {
    const root = await createTempDir();
    const openclawDir = path.join(root, ".openclaw");
    await fs.mkdir(openclawDir, { recursive: true });
    await fs.writeFile(path.join(openclawDir, "openclaw.json"), "{}");

    const result = detectMigrationSource(() => root);

    expect(result).not.toBeNull();
    expect(result!.brand).toBe("openclaw");
    expect(result!.dir).toBe(openclawDir);
    expect(result!.configFilename).toBe("openclaw.json");
  });

  it("detects ~/.clawdbot with clawdbot.json", async () => {
    const root = await createTempDir();
    const clawdbotDir = path.join(root, ".clawdbot");
    await fs.mkdir(clawdbotDir, { recursive: true });
    await fs.writeFile(path.join(clawdbotDir, "clawdbot.json"), "{}");

    const result = detectMigrationSource(() => root);

    expect(result).not.toBeNull();
    expect(result!.brand).toBe("clawdbot");
    expect(result!.configFilename).toBe("clawdbot.json");
  });

  it("detects ~/.moltbot with moltbot.json", async () => {
    const root = await createTempDir();
    const moltbotDir = path.join(root, ".moltbot");
    await fs.mkdir(moltbotDir, { recursive: true });
    await fs.writeFile(path.join(moltbotDir, "moltbot.json"), "{}");

    const result = detectMigrationSource(() => root);

    expect(result).not.toBeNull();
    expect(result!.brand).toBe("moltbot");
    expect(result!.configFilename).toBe("moltbot.json");
  });

  it("prefers openclaw over clawdbot when both exist", async () => {
    const root = await createTempDir();
    const openclawDir = path.join(root, ".openclaw");
    const clawdbotDir = path.join(root, ".clawdbot");
    await fs.mkdir(openclawDir, { recursive: true });
    await fs.mkdir(clawdbotDir, { recursive: true });
    await fs.writeFile(path.join(openclawDir, "openclaw.json"), "{}");
    await fs.writeFile(path.join(clawdbotDir, "clawdbot.json"), "{}");

    const result = detectMigrationSource(() => root);

    expect(result).not.toBeNull();
    expect(result!.brand).toBe("openclaw");
  });

  it("returns null when no source found", () => {
    const result = detectMigrationSource(() => "/nonexistent/path");
    expect(result).toBeNull();
  });

  it("returns null when dir exists but config file missing", async () => {
    const root = await createTempDir();
    const openclawDir = path.join(root, ".openclaw");
    await fs.mkdir(openclawDir, { recursive: true });
    const result = detectMigrationSource(() => root);
    expect(result).toBeNull();
  });
});

// ─── migrate-config.ts ────────────────────────────────────────────────────────

describe("migrateConfig", () => {
  it("creates new config from source with KaijiBot defaults", async () => {
    const sourceDir = await createTempDir();
    const targetDir = await createTempDir();
    const source = makeSource(sourceDir);

    await fs.writeFile(source.configPath, JSON.stringify({ agent: { model: "gpt-4" } }));

    const result = await migrateConfig(source, targetDir, defaultOptions());

    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]!.kind).toBe("create");

    const written = JSON.parse(
      await fs.readFile(path.join(targetDir, "kaijibot.json"), "utf-8"),
    ) as Record<string, unknown>;
    expect(written.agent).toEqual({ model: "gpt-4" });
    expect((written.cognitive as Record<string, unknown>).enabled).toBe(true);
  });

  it("merges cognitive defaults only for missing keys", async () => {
    const sourceDir = await createTempDir();
    const targetDir = await createTempDir();
    const source = makeSource(sourceDir);

    await fs.writeFile(
      source.configPath,
      JSON.stringify({ cognitive: { enabled: false } }),
    );

    await migrateConfig(source, targetDir, defaultOptions());

    const written = JSON.parse(
      await fs.readFile(path.join(targetDir, "kaijibot.json"), "utf-8"),
    ) as Record<string, unknown>;
    expect((written.cognitive as Record<string, unknown>).enabled).toBe(false);
    expect((written.cognitive as Record<string, unknown>).proactive).toBeDefined();
    expect((written.cognitive as Record<string, unknown>).insight).toBeDefined();
  });

  it("skips when target exists and not overwrite", async () => {
    const sourceDir = await createTempDir();
    const targetDir = await createTempDir();
    const source = makeSource(sourceDir);

    await fs.writeFile(source.configPath, JSON.stringify({ agent: { model: "gpt-4" } }));
    await fs.writeFile(
      path.join(targetDir, "kaijibot.json"),
      JSON.stringify({ existing: true }),
    );

    const result = await migrateConfig(source, targetDir, defaultOptions());

    expect(result.skipped).toHaveLength(1);
    expect(result.warnings).toHaveLength(1);
    expect(result.changes).toHaveLength(0);

    const targetContent = JSON.parse(
      await fs.readFile(path.join(targetDir, "kaijibot.json"), "utf-8"),
    ) as Record<string, unknown>;
    expect(targetContent.existing).toBe(true);
    expect(targetContent.agent).toBeUndefined();
  });

  it("skips when target content is identical", async () => {
    const sourceDir = await createTempDir();
    const targetDir = await createTempDir();
    const source = makeSource(sourceDir);

    const configContent = JSON.stringify({ agent: { model: "gpt-4" } });
    await fs.writeFile(source.configPath, configContent);
    await fs.writeFile(path.join(targetDir, "kaijibot.json"), configContent);

    const result = await migrateConfig(source, targetDir, defaultOptions());

    expect(result.skipped).toHaveLength(1);
    expect(result.changes).toHaveLength(0);
  });

  it("merges with existing when overwrite is true", async () => {
    const sourceDir = await createTempDir();
    const targetDir = await createTempDir();
    const source = makeSource(sourceDir);

    await fs.writeFile(source.configPath, JSON.stringify({ agent: { model: "gpt-4" } }));
    await fs.writeFile(
      path.join(targetDir, "kaijibot.json"),
      JSON.stringify({ existing: true }),
    );

    const result = await migrateConfig(
      source,
      targetDir,
      defaultOptions({ overwrite: true }),
    );

    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]!.kind).toBe("merge");

    const written = JSON.parse(
      await fs.readFile(path.join(targetDir, "kaijibot.json"), "utf-8"),
    ) as Record<string, unknown>;
    expect(written.existing).toBe(true);
    expect(written.agent).toBeDefined();
  });

  it("handles dry-run mode without writing", async () => {
    const sourceDir = await createTempDir();
    const targetDir = await createTempDir();
    const source = makeSource(sourceDir);

    await fs.writeFile(source.configPath, JSON.stringify({ agent: { model: "gpt-4" } }));

    const result = await migrateConfig(source, targetDir, defaultOptions({ dryRun: true }));

    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]!.detail).toContain("Would create");

    await expect(
      fs.readFile(path.join(targetDir, "kaijibot.json"), "utf-8"),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("returns warning when source config is unreadable", async () => {
    const sourceDir = await createTempDir();
    const targetDir = await createTempDir();
    const source = makeSource(sourceDir);

    const result = await migrateConfig(source, targetDir, defaultOptions());

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("Cannot read source config");
    expect(result.changes).toHaveLength(0);
  });
});

// ─── migrate-workspace.ts ─────────────────────────────────────────────────────

describe("migrateWorkspace", () => {
  it("copies workspace markdown files", async () => {
    const sourceDir = await createTempDir();
    const targetDir = await createTempDir();
    const source = makeSource(sourceDir);

    await fs.mkdir(path.join(sourceDir, "workspace"), { recursive: true });
    await fs.writeFile(path.join(sourceDir, "workspace", "SOUL.md"), "# Soul content");
    await fs.writeFile(path.join(sourceDir, "workspace", "IDENTITY.md"), "# Identity");
    await fs.writeFile(source.configPath, "{}");

    const result = await migrateWorkspace(source, targetDir, defaultOptions());

    expect(result.changes.length).toBeGreaterThanOrEqual(2);
    await expect(
      fs.readFile(path.join(targetDir, "workspace", "SOUL.md"), "utf-8"),
    ).resolves.toBe("# Soul content");
    await expect(
      fs.readFile(path.join(targetDir, "workspace", "IDENTITY.md"), "utf-8"),
    ).resolves.toBe("# Identity");
  });

  it("copies memory daily files", async () => {
    const sourceDir = await createTempDir();
    const targetDir = await createTempDir();
    const source = makeSource(sourceDir);

    await fs.mkdir(path.join(sourceDir, "workspace", "memory"), { recursive: true });
    await fs.writeFile(
      path.join(sourceDir, "workspace", "memory", "2025-01-01.md"),
      "# Daily log",
    );
    await fs.writeFile(source.configPath, "{}");

    const result = await migrateWorkspace(source, targetDir, defaultOptions());

    const copyChanges = result.changes.filter((c) => c.detail === "Copied file");
    expect(copyChanges.length).toBeGreaterThanOrEqual(1);
    await expect(
      fs.readFile(path.join(targetDir, "workspace", "memory", "2025-01-01.md"), "utf-8"),
    ).resolves.toBe("# Daily log");
  });

  it("copies memory topic files", async () => {
    const sourceDir = await createTempDir();
    const targetDir = await createTempDir();
    const source = makeSource(sourceDir);

    await fs.mkdir(path.join(sourceDir, "workspace", "memory", "topics"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(sourceDir, "workspace", "memory", "topics", "ai-research.md"),
      "# AI Research topic",
    );
    await fs.writeFile(source.configPath, "{}");

    const result = await migrateWorkspace(source, targetDir, defaultOptions());

    const topicChanges = result.changes.filter(
      (c) => c.target.includes("topics"),
    );
    expect(topicChanges.length).toBeGreaterThanOrEqual(1);
    await expect(
      fs.readFile(
        path.join(targetDir, "workspace", "memory", "topics", "ai-research.md"),
        "utf-8",
      ),
    ).resolves.toBe("# AI Research topic");
  });

  it("merges MEMORY.md without truncation", async () => {
    const sourceDir = await createTempDir();
    const targetDir = await createTempDir();
    const source = makeSource(sourceDir);

    await fs.mkdir(path.join(sourceDir, "workspace"), { recursive: true });
    await fs.writeFile(path.join(sourceDir, "workspace", "MEMORY.md"), "# Src Section\nSrc content");
    await fs.writeFile(source.configPath, "{}");

    const result = await migrateWorkspace(source, targetDir, defaultOptions());

    const mergeChanges = result.changes.filter((c) => c.kind === "merge");
    expect(mergeChanges).toHaveLength(1);
    await expect(
      fs.readFile(path.join(targetDir, "workspace", "MEMORY.md"), "utf-8"),
    ).resolves.toBe("# Src Section\nSrc content");
  });

  it("preserves MEMORY.md content exceeding 4KB without truncation", async () => {
    const sourceDir = await createTempDir();
    const targetDir = await createTempDir();
    const source = makeSource(sourceDir);

    // Build source MEMORY.md well over 4KB
    const sections: string[] = ["# Memory Index\n"];
    for (let i = 0; i < 50; i++) {
      sections.push(`## Section ${i}\n${"x".repeat(200)}\n`);
    }
    const largeContent = sections.join("\n");
    expect(Buffer.byteLength(largeContent, "utf-8")).toBeGreaterThan(4 * 1024);

    await fs.mkdir(path.join(sourceDir, "workspace"), { recursive: true });
    await fs.writeFile(path.join(sourceDir, "workspace", "MEMORY.md"), largeContent);
    await fs.writeFile(source.configPath, "{}");

    const result = await migrateWorkspace(source, targetDir, defaultOptions());

    const output = await fs.readFile(
      path.join(targetDir, "workspace", "MEMORY.md"),
      "utf-8",
    );
    expect(Buffer.byteLength(output, "utf-8")).toBe(Buffer.byteLength(largeContent, "utf-8"));
    expect(result.warnings).not.toContainEqual(
      expect.stringContaining("truncat"),
    );
  });

  it("merges large MEMORY.md with existing target preserving all sections", async () => {
    const sourceDir = await createTempDir();
    const targetDir = await createTempDir();
    const source = makeSource(sourceDir);

    // Source > 4KB with sections A, B, C
    const srcSections: string[] = [];
    for (const name of ["Section A", "Section B", "Section C"]) {
      srcSections.push(`## ${name}\n${"y".repeat(1500)}\n`);
    }
    const srcContent = srcSections.join("\n");
    expect(Buffer.byteLength(srcContent, "utf-8")).toBeGreaterThan(4 * 1024);

    // Target with sections D, E
    const dstContent = "## Section D\nD content\n\n## Section E\nE content";

    await fs.mkdir(path.join(sourceDir, "workspace"), { recursive: true });
    await fs.mkdir(path.join(targetDir, "workspace"), { recursive: true });
    await fs.writeFile(path.join(sourceDir, "workspace", "MEMORY.md"), srcContent);
    await fs.writeFile(path.join(targetDir, "workspace", "MEMORY.md"), dstContent);
    await fs.writeFile(source.configPath, "{}");

    const result = await migrateWorkspace(source, targetDir, defaultOptions());

    const merged = await fs.readFile(
      path.join(targetDir, "workspace", "MEMORY.md"),
      "utf-8",
    );
    expect(merged).toContain("Section A");
    expect(merged).toContain("Section B");
    expect(merged).toContain("Section C");
    expect(merged).toContain("Section D");
    expect(merged).toContain("Section E");
    expect(result.warnings).not.toContainEqual(
      expect.stringContaining("truncat"),
    );
  });

  it("skips identical files by SHA-256", async () => {
    const sourceDir = await createTempDir();
    const targetDir = await createTempDir();
    const source = makeSource(sourceDir);

    const content = "# Identical";
    await fs.mkdir(path.join(sourceDir, "workspace"), { recursive: true });
    await fs.mkdir(path.join(targetDir, "workspace"), { recursive: true });
    await fs.writeFile(path.join(sourceDir, "workspace", "SOUL.md"), content);
    await fs.writeFile(path.join(targetDir, "workspace", "SOUL.md"), content);
    await fs.writeFile(source.configPath, "{}");

    const result = await migrateWorkspace(
      source,
      targetDir,
      defaultOptions({ overwrite: true }),
    );

    const soulChanges = result.changes.filter((c) => c.target.includes("SOUL.md"));
    expect(soulChanges).toHaveLength(0);
  });

  it("skips existing files without overwrite flag", async () => {
    const sourceDir = await createTempDir();
    const targetDir = await createTempDir();
    const source = makeSource(sourceDir);

    await fs.mkdir(path.join(sourceDir, "workspace"), { recursive: true });
    await fs.mkdir(path.join(targetDir, "workspace"), { recursive: true });
    await fs.writeFile(path.join(sourceDir, "workspace", "SOUL.md"), "# Source");
    await fs.writeFile(path.join(targetDir, "workspace", "SOUL.md"), "# Target");
    await fs.writeFile(source.configPath, "{}");

    const result = await migrateWorkspace(source, targetDir, defaultOptions());

    const soulSkipped = result.skipped.filter((s) => s.includes("SOUL.md"));
    expect(soulSkipped).toHaveLength(1);

    await expect(
      fs.readFile(path.join(targetDir, "workspace", "SOUL.md"), "utf-8"),
    ).resolves.toBe("# Target");
  });

  it("migrates multi-agent workspaces from agents.list", async () => {
    const sourceDir = await createTempDir();
    const targetDir = await createTempDir();
    const source = makeSource(sourceDir);

    await fs.mkdir(path.join(sourceDir, "workspace-researcher"), { recursive: true });
    await fs.writeFile(
      path.join(sourceDir, "workspace-researcher", "SOUL.md"),
      "# Researcher soul",
    );
    await fs.writeFile(
      source.configPath,
      JSON.stringify({
        agents: {
          list: [{ id: "researcher" }],
        },
      }),
    );

    const result = await migrateWorkspace(source, targetDir, defaultOptions());

    const researcherChanges = result.changes.filter((c) =>
      c.target.includes("workspace-researcher"),
    );
    expect(researcherChanges.length).toBeGreaterThanOrEqual(1);
    await expect(
      fs.readFile(
        path.join(targetDir, "workspace-researcher", "SOUL.md"),
        "utf-8",
      ),
    ).resolves.toBe("# Researcher soul");
  });

  it("skips non-migratable QMD/vector store files", async () => {
    const sourceDir = await createTempDir();
    const targetDir = await createTempDir();
    const source = makeSource(sourceDir);

    await fs.mkdir(path.join(sourceDir, "workspace"), { recursive: true });
    await fs.mkdir(path.join(sourceDir, "workspace", ".qmd"), { recursive: true });
    await fs.mkdir(path.join(sourceDir, "workspace", ".vectors"), { recursive: true });
    await fs.writeFile(
      path.join(sourceDir, "workspace", "memory.db"),
      "binary data",
    );
    await fs.writeFile(source.configPath, "{}");

    const result = await migrateWorkspace(source, targetDir, defaultOptions());

    expect(result.skipped).toContainEqual(expect.stringContaining("memory.db"));
  });

  it("handles missing source workspace gracefully", async () => {
    const sourceDir = await createTempDir();
    const targetDir = await createTempDir();
    const source = makeSource(sourceDir);
    await fs.writeFile(source.configPath, "{}");

    const result = await migrateWorkspace(source, targetDir, defaultOptions());

    expect(result.changes).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });
});

// ─── migrate-skills.ts ────────────────────────────────────────────────────────

describe("migrateSkills", () => {
  it("copies skill directories with SKILL.md", async () => {
    const sourceDir = await createTempDir();
    const targetDir = await createTempDir();
    const source = makeSource(sourceDir);

    await fs.mkdir(path.join(sourceDir, "skills", "weather"), { recursive: true });
    await fs.writeFile(
      path.join(sourceDir, "skills", "weather", "SKILL.md"),
      "# Weather Skill\nGet weather info",
    );

    const result = await migrateSkills(source, targetDir, defaultOptions());

    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]!.kind).toBe("copy");
    await expect(
      fs.readFile(path.join(targetDir, "skills", "weather", "SKILL.md"), "utf-8"),
    ).resolves.toContain("Weather Skill");
  });

  it("adds migration banner for brand references", async () => {
    const sourceDir = await createTempDir();
    const targetDir = await createTempDir();
    const source = makeSource(sourceDir);

    await fs.mkdir(path.join(sourceDir, "skills", "github"), { recursive: true });
    await fs.writeFile(
      path.join(sourceDir, "skills", "github", "SKILL.md"),
      "# GitHub Skill\nUses OpenClaw for integration",
    );

    await migrateSkills(source, targetDir, defaultOptions());

    const written = await fs.readFile(
      path.join(targetDir, "skills", "github", "SKILL.md"),
      "utf-8",
    );
    expect(written).toContain("Migrated from OpenClaw");
    expect(written).toContain("OpenClaw");
  });

  it("skips existing skills without overwrite", async () => {
    const sourceDir = await createTempDir();
    const targetDir = await createTempDir();
    const source = makeSource(sourceDir);

    await fs.mkdir(path.join(sourceDir, "skills", "weather"), { recursive: true });
    await fs.writeFile(
      path.join(sourceDir, "skills", "weather", "SKILL.md"),
      "# Source Weather",
    );
    await fs.mkdir(path.join(targetDir, "skills", "weather"), { recursive: true });
    await fs.writeFile(
      path.join(targetDir, "skills", "weather", "SKILL.md"),
      "# Target Weather",
    );

    const result = await migrateSkills(source, targetDir, defaultOptions());

    expect(result.skipped).toHaveLength(1);
    await expect(
      fs.readFile(path.join(targetDir, "skills", "weather", "SKILL.md"), "utf-8"),
    ).resolves.toBe("# Target Weather");
  });

  it("backs up existing skill when overwrite is true", async () => {
    const sourceDir = await createTempDir();
    const targetDir = await createTempDir();
    const source = makeSource(sourceDir);

    await fs.mkdir(path.join(sourceDir, "skills", "weather"), { recursive: true });
    await fs.writeFile(
      path.join(sourceDir, "skills", "weather", "SKILL.md"),
      "# New Weather",
    );
    await fs.mkdir(path.join(targetDir, "skills", "weather"), { recursive: true });
    await fs.writeFile(
      path.join(targetDir, "skills", "weather", "SKILL.md"),
      "# Old Weather",
    );

    const result = await migrateSkills(
      source,
      targetDir,
      defaultOptions({ overwrite: true }),
    );

    const moveChanges = result.changes.filter((c) => c.kind === "move");
    const copyChanges = result.changes.filter((c) => c.kind === "copy");
    expect(moveChanges).toHaveLength(1);
    expect(moveChanges[0]!.detail).toContain("Backed up");
    expect(copyChanges).toHaveLength(1);

    await expect(
      fs.readFile(path.join(targetDir, "skills", "weather", "SKILL.md"), "utf-8"),
    ).resolves.toBe("# New Weather");
  });

  it("skips non-skill directories (no SKILL.md)", async () => {
    const sourceDir = await createTempDir();
    const targetDir = await createTempDir();
    const source = makeSource(sourceDir);

    await fs.mkdir(path.join(sourceDir, "skills", "notaskill"), { recursive: true });
    await fs.writeFile(
      path.join(sourceDir, "skills", "notaskill", "README.md"),
      "Just a readme",
    );

    const result = await migrateSkills(source, targetDir, defaultOptions());

    expect(result.changes).toHaveLength(0);
    await expect(
      fs.stat(path.join(targetDir, "skills", "notaskill")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("handles dry-run mode", async () => {
    const sourceDir = await createTempDir();
    const targetDir = await createTempDir();
    const source = makeSource(sourceDir);

    await fs.mkdir(path.join(sourceDir, "skills", "weather"), { recursive: true });
    await fs.writeFile(
      path.join(sourceDir, "skills", "weather", "SKILL.md"),
      "# Weather",
    );

    const result = await migrateSkills(
      source,
      targetDir,
      defaultOptions({ dryRun: true }),
    );

    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]!.detail).toContain("Would copy");
    await expect(
      fs.stat(path.join(targetDir, "skills")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});

// ─── migrate-sessions.ts ──────────────────────────────────────────────────────

describe("migrateSessions", () => {
  it("copies session store to correct agent directory", async () => {
    const sourceDir = await createTempDir();
    const targetDir = await createTempDir();
    const source = makeSource(sourceDir);

    const sessionData = { "desk": { sessionId: "s1", updatedAt: 100 } };
    await fs.mkdir(path.join(sourceDir, "sessions"), { recursive: true });
    await fs.writeFile(
      path.join(sourceDir, "sessions", "sessions.json"),
      JSON.stringify(sessionData),
    );

    const result = await migrateSessions(source, targetDir, defaultOptions());

    const copyChanges = result.changes.filter((c) => c.detail.includes("session store"));
    expect(copyChanges).toHaveLength(1);

    const written = JSON.parse(
      await fs.readFile(
        path.join(targetDir, "state", "agents", "main", "sessions", "sessions.json"),
        "utf-8",
      ),
    ) as Record<string, unknown>;
    expect(written["desk"]).toBeDefined();
  });

  it("merges session stores (most recently updated wins)", async () => {
    const sourceDir = await createTempDir();
    const targetDir = await createTempDir();
    const source = makeSource(sourceDir);

    await fs.mkdir(path.join(sourceDir, "sessions"), { recursive: true });
    await fs.writeFile(
      path.join(sourceDir, "sessions", "sessions.json"),
      JSON.stringify({
        key1: { sessionId: "newer", updatedAt: 200 },
        key2: { sessionId: "src-only", updatedAt: 100 },
      }),
    );

    const targetSessionDir = path.join(
      targetDir, "state", "agents", "main", "sessions",
    );
    await fs.mkdir(targetSessionDir, { recursive: true });
    await fs.writeFile(
      path.join(targetSessionDir, "sessions.json"),
      JSON.stringify({
        key1: { sessionId: "older", updatedAt: 50 },
        key3: { sessionId: "dst-only", updatedAt: 50 },
      }),
    );

    const result = await migrateSessions(
      source,
      targetDir,
      defaultOptions({ overwrite: true }),
    );

    const mergeChanges = result.changes.filter((c) => c.kind === "merge");
    expect(mergeChanges).toHaveLength(1);

    const written = JSON.parse(
      await fs.readFile(path.join(targetSessionDir, "sessions.json"), "utf-8"),
    ) as Record<string, Record<string, unknown>>;
    expect(written["key1"]!.sessionId).toBe("newer");
    expect(written["key2"]!.sessionId).toBe("src-only");
    expect(written["key3"]!.sessionId).toBe("dst-only");
  });

  it("copies JSONL transcript files", async () => {
    const sourceDir = await createTempDir();
    const targetDir = await createTempDir();
    const source = makeSource(sourceDir);

    await fs.mkdir(path.join(sourceDir, "sessions"), { recursive: true });
    await fs.writeFile(
      path.join(sourceDir, "sessions", "trace.jsonl"),
      '{"role":"user"}\n{"role":"assistant"}\n',
    );

    const result = await migrateSessions(source, targetDir, defaultOptions());

    const transcriptChanges = result.changes.filter((c) =>
      c.detail.includes("transcript"),
    );
    expect(transcriptChanges).toHaveLength(1);

    await expect(
      fs.readFile(
        path.join(targetDir, "state", "agents", "main", "sessions", "trace.jsonl"),
        "utf-8",
      ),
    ).resolves.toContain("user");
  });

  it("migrates default agent sessions to agents/main/sessions", async () => {
    const sourceDir = await createTempDir();
    const targetDir = await createTempDir();
    const source = makeSource(sourceDir);

    const sessionData = { "desk": { sessionId: "s1", updatedAt: 100 } };
    await fs.mkdir(path.join(sourceDir, "state", "sessions"), { recursive: true });
    await fs.writeFile(
      path.join(sourceDir, "state", "sessions", "sessions.json"),
      JSON.stringify(sessionData),
    );
    // No agents.list in config — single default agent
    await fs.writeFile(source.configPath, "{}");

    const result = await migrateSessions(source, targetDir, defaultOptions());

    const copyChanges = result.changes.filter((c) => c.detail.includes("session store"));
    expect(copyChanges).toHaveLength(1);

    const written = JSON.parse(
      await fs.readFile(
        path.join(targetDir, "state", "agents", "main", "sessions", "sessions.json"),
        "utf-8",
      ),
    ) as Record<string, unknown>;
    expect(written["desk"]).toBeDefined();
  });

  it("migrates named agent sessions from state/sessions-{agentId}/", async () => {
    const sourceDir = await createTempDir();
    const targetDir = await createTempDir();
    const source = makeSource(sourceDir);

    await fs.writeFile(
      source.configPath,
      JSON.stringify({
        agents: { list: [{ id: "researcher" }, { id: "coder" }] },
      }),
    );

    const researcherData = { "r1": { sessionId: "rs1", updatedAt: 50 } };
    await fs.mkdir(path.join(sourceDir, "state", "sessions-researcher"), { recursive: true });
    await fs.writeFile(
      path.join(sourceDir, "state", "sessions-researcher", "sessions.json"),
      JSON.stringify(researcherData),
    );

    const coderData = { "c1": { sessionId: "cs1", updatedAt: 80 } };
    await fs.mkdir(path.join(sourceDir, "state", "sessions-coder"), { recursive: true });
    await fs.writeFile(
      path.join(sourceDir, "state", "sessions-coder", "sessions.json"),
      JSON.stringify(coderData),
    );

    const result = await migrateSessions(source, targetDir, defaultOptions());

    const storeChanges = result.changes.filter((c) => c.detail.includes("session store"));
    expect(storeChanges).toHaveLength(2);

    const researcherWritten = JSON.parse(
      await fs.readFile(
        path.join(targetDir, "state", "agents", "researcher", "sessions", "sessions.json"),
        "utf-8",
      ),
    ) as Record<string, unknown>;
    expect(researcherWritten["r1"]).toBeDefined();

    const coderWritten = JSON.parse(
      await fs.readFile(
        path.join(targetDir, "state", "agents", "coder", "sessions", "sessions.json"),
        "utf-8",
      ),
    ) as Record<string, unknown>;
    expect(coderWritten["c1"]).toBeDefined();
  });

  it("migrates default and named agent sessions separately", async () => {
    const sourceDir = await createTempDir();
    const targetDir = await createTempDir();
    const source = makeSource(sourceDir);

    // Config with a named agent plus a default agent
    await fs.writeFile(
      source.configPath,
      JSON.stringify({
        agents: { list: [{ id: "main", default: true }, { id: "researcher" }] },
      }),
    );

    // Default sessions in sessions/
    const defaultData = { "d1": { sessionId: "ds1", updatedAt: 10 } };
    await fs.mkdir(path.join(sourceDir, "sessions"), { recursive: true });
    await fs.writeFile(
      path.join(sourceDir, "sessions", "sessions.json"),
      JSON.stringify(defaultData),
    );

    // Named agent sessions in state/sessions-researcher/
    const researcherData = { "r1": { sessionId: "rs1", updatedAt: 20 } };
    await fs.mkdir(path.join(sourceDir, "state", "sessions-researcher"), { recursive: true });
    await fs.writeFile(
      path.join(sourceDir, "state", "sessions-researcher", "sessions.json"),
      JSON.stringify(researcherData),
    );

    const result = await migrateSessions(source, targetDir, defaultOptions());

    const storeChanges = result.changes.filter((c) => c.detail.includes("session store"));
    expect(storeChanges).toHaveLength(2);

    // Default agent goes to agents/main/sessions/
    const defaultWritten = JSON.parse(
      await fs.readFile(
        path.join(targetDir, "state", "agents", "main", "sessions", "sessions.json"),
        "utf-8",
      ),
    ) as Record<string, unknown>;
    expect(defaultWritten["d1"]).toBeDefined();

    // Named agent goes to agents/researcher/sessions/
    const researcherWritten = JSON.parse(
      await fs.readFile(
        path.join(targetDir, "state", "agents", "researcher", "sessions", "sessions.json"),
        "utf-8",
      ),
    ) as Record<string, unknown>;
    expect(researcherWritten["r1"]).toBeDefined();
  });

  it("copies named agent JSONL transcripts", async () => {
    const sourceDir = await createTempDir();
    const targetDir = await createTempDir();
    const source = makeSource(sourceDir);

    await fs.writeFile(
      source.configPath,
      JSON.stringify({
        agents: { list: [{ id: "coder" }] },
      }),
    );

    await fs.mkdir(path.join(sourceDir, "state", "sessions-coder"), { recursive: true });
    await fs.writeFile(
      path.join(sourceDir, "state", "sessions-coder", "trace.jsonl"),
      '{"role":"user"}\n{"role":"assistant"}\n',
    );

    const result = await migrateSessions(source, targetDir, defaultOptions());

    const transcriptChanges = result.changes.filter((c) =>
      c.detail.includes("transcript"),
    );
    expect(transcriptChanges).toHaveLength(1);

    await expect(
      fs.readFile(
        path.join(targetDir, "state", "agents", "coder", "sessions", "trace.jsonl"),
        "utf-8",
      ),
    ).resolves.toContain("user");
  });

  it("copies exec-approvals.json", async () => {
    const sourceDir = await createTempDir();
    const targetDir = await createTempDir();
    const source = makeSource(sourceDir);

    await fs.mkdir(path.join(sourceDir, "state"), { recursive: true });
    await fs.writeFile(
      path.join(sourceDir, "state", "exec-approvals.json"),
      JSON.stringify({ approved: ["cmd1"] }),
    );

    const result = await migrateSessions(source, targetDir, defaultOptions());

    const approvalChanges = result.changes.filter((c) =>
      c.target.includes("exec-approvals"),
    );
    expect(approvalChanges).toHaveLength(1);
    await expect(
      fs.readFile(
        path.join(targetDir, "state", "exec-approvals.json"),
        "utf-8",
      ),
    ).resolves.toContain("cmd1");
  });

  it("copies hooks directory", async () => {
    const sourceDir = await createTempDir();
    const targetDir = await createTempDir();
    const source = makeSource(sourceDir);

    await fs.mkdir(path.join(sourceDir, "hooks"), { recursive: true });
    await fs.writeFile(
      path.join(sourceDir, "hooks", "on-message.sh"),
      "#!/bin/bash\necho hello",
    );

    const result = await migrateSessions(source, targetDir, defaultOptions());

    const hookChanges = result.changes.filter((c) =>
      c.target.includes("hooks"),
    );
    expect(hookChanges).toHaveLength(1);
    await expect(
      fs.readFile(path.join(targetDir, "hooks", "on-message.sh"), "utf-8"),
    ).resolves.toContain("echo hello");
  });

  it("copies cron jobs with warning", async () => {
    const sourceDir = await createTempDir();
    const targetDir = await createTempDir();
    const source = makeSource(sourceDir);

    await fs.mkdir(path.join(sourceDir, "cron"), { recursive: true });
    await fs.writeFile(
      path.join(sourceDir, "cron", "jobs.json"),
      JSON.stringify([{ schedule: "0 * * * *", action: "ping" }]),
    );

    const result = await migrateSessions(source, targetDir, defaultOptions());

    const cronChanges = result.changes.filter((c) =>
      c.target.includes("cron"),
    );
    expect(cronChanges).toHaveLength(1);
    expect(result.warnings).toContainEqual(
      expect.stringContaining("Cron jobs migrated"),
    );
  });

  it("skips credentials without --migrate-secrets", async () => {
    const sourceDir = await createTempDir();
    const targetDir = await createTempDir();
    const source = makeSource(sourceDir);

    await fs.mkdir(path.join(sourceDir, "credentials"), { recursive: true });
    await fs.writeFile(
      path.join(sourceDir, "credentials", "api-keys.json"),
      '{"key":"secret"}',
    );

    const result = await migrateSessions(source, targetDir, defaultOptions({ migrateSecrets: false }));

    expect(result.skipped).toContainEqual(expect.stringContaining("credentials"));
    await expect(
      fs.stat(path.join(targetDir, "credentials")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("copies credentials with --migrate-secrets", async () => {
    const sourceDir = await createTempDir();
    const targetDir = await createTempDir();
    const source = makeSource(sourceDir);

    await fs.mkdir(path.join(sourceDir, "credentials"), { recursive: true });
    await fs.writeFile(
      path.join(sourceDir, "credentials", "api-keys.json"),
      '{"key":"secret"}',
    );

    const result = await migrateSessions(
      source,
      targetDir,
      defaultOptions({ migrateSecrets: true }),
    );

    const credChanges = result.changes.filter((c) =>
      c.target.includes("credentials"),
    );
    expect(credChanges).toHaveLength(1);
    expect(result.warnings).toContainEqual(
      expect.stringContaining("Credentials were migrated"),
    );
    await expect(
      fs.readFile(
        path.join(targetDir, "credentials", "api-keys.json"),
        "utf-8",
      ),
    ).resolves.toContain("secret");
  });

  it("copies .env with --migrate-secrets", async () => {
    const sourceDir = await createTempDir();
    const targetDir = await createTempDir();
    const source = makeSource(sourceDir);

    await fs.writeFile(
      path.join(sourceDir, ".env"),
      "ZAI_API_KEY=test-key\n",
    );

    const result = await migrateSessions(
      source,
      targetDir,
      defaultOptions({ migrateSecrets: true }),
    );

    const envChanges = result.changes.filter((c) =>
      c.target.includes(".env"),
    );
    expect(envChanges).toHaveLength(1);
    expect(result.warnings).toContainEqual(
      expect.stringContaining(".env"),
    );
    await expect(
      fs.readFile(path.join(targetDir, ".env"), "utf-8"),
    ).resolves.toContain("test-key");
  });
});

// ─── index.ts (orchestrator) ──────────────────────────────────────────────────

describe("runMigration", () => {
  it("runs full migration end-to-end", async () => {
    const sourceDir = await createTempDir();
    const targetDir = await createTempDir();

    await fs.writeFile(
      path.join(sourceDir, "openclaw.json"),
      JSON.stringify({ agent: { model: "gpt-4" } }),
    );
    await fs.mkdir(path.join(sourceDir, "workspace"), { recursive: true });
    await fs.writeFile(
      path.join(sourceDir, "workspace", "SOUL.md"),
      "# My soul",
    );
    await fs.mkdir(path.join(sourceDir, "skills", "weather"), { recursive: true });
    await fs.writeFile(
      path.join(sourceDir, "skills", "weather", "SKILL.md"),
      "# Weather",
    );
    await fs.mkdir(path.join(sourceDir, "sessions"), { recursive: true });
    await fs.writeFile(
      path.join(sourceDir, "sessions", "sessions.json"),
      JSON.stringify({ key1: { sessionId: "s1" } }),
    );

    const report = await runMigration({
      dryRun: false,
      overwrite: false,
      migrateSecrets: false,
      source: sourceDir,
      targetDir,
      log: () => {},
    });

    expect(report.source.brand).toBe("openclaw");
    expect(report.results).toHaveLength(4);
  });

  it("creates backup marker and report JSON", async () => {
    const sourceDir = await createTempDir();
    const targetDir = await createTempDir();

    await fs.writeFile(
      path.join(sourceDir, "openclaw.json"),
      JSON.stringify({}),
    );

    const report = await runMigration({
      dryRun: false,
      overwrite: false,
      migrateSecrets: false,
      source: sourceDir,
      targetDir,
      log: () => {},
    });

    expect(report.timestamp).toBeDefined();

    expect(report).toHaveProperty("totalChanges");
    expect(report).toHaveProperty("totalWarnings");
    expect(report).toHaveProperty("totalSkipped");
    expect(report.results).toHaveLength(4);
  });

  it("throws when no source found and no explicit source", async () => {
    await expect(
      runMigration({
        dryRun: false,
        overwrite: false,
        migrateSecrets: false,
        log: () => {},
      }),
    ).rejects.toThrow("No OpenClaw installation found");
  });

  it("respects dry-run mode", async () => {
    const sourceDir = await createTempDir();

    await fs.writeFile(
      path.join(sourceDir, "openclaw.json"),
      JSON.stringify({ agent: { model: "gpt-4" } }),
    );
    await fs.mkdir(path.join(sourceDir, "workspace"), { recursive: true });
    await fs.writeFile(
      path.join(sourceDir, "workspace", "SOUL.md"),
      "# My soul",
    );

    const report = await runMigration({
      dryRun: true,
      overwrite: false,
      migrateSecrets: false,
      source: sourceDir,
      log: () => {},
    });

    expect(report.results).toHaveLength(4);
    expect(report.timestamp).toBeDefined();
  });
});

// ─── detectScenario ─────────────────────────────────────────────────────────

describe("detectScenario", () => {
  it("returns 'fresh' when no kaijibot.json exists", () => {
    const scenario = detectScenario("/nonexistent/path");
    expect(scenario).toBe("fresh");
  });

  it("returns 'import' when kaijibot.json exists", async () => {
    const dir = await createTempDir();
    await fs.writeFile(path.join(dir, "kaijibot.json"), "{}");
    const scenario = detectScenario(dir);
    expect(scenario).toBe("import");
  });
});

// ─── enumerateSourceAgents ──────────────────────────────────────────────────

describe("enumerateSourceAgents", () => {
  it("returns main agent when config has no agents.list", async () => {
    const dir = await createTempDir();
    await fs.writeFile(path.join(dir, "openclaw.json"), "{}");
    const source = makeSource(dir);
    const agents = await enumerateSourceAgents(source);
    expect(agents).toHaveLength(1);
    expect(agents[0]!.id).toBe("main");
    expect(agents[0]!.isDefault).toBe(true);
  });

  it("returns agents from config agents.list", async () => {
    const dir = await createTempDir();
    await fs.writeFile(
      path.join(dir, "openclaw.json"),
      JSON.stringify({
        agents: { list: [{ id: "researcher" }, { id: "coder" }] },
      }),
    );
    const source = makeSource(dir);
    const agents = await enumerateSourceAgents(source);
    expect(agents).toHaveLength(2);
    expect(agents.map((a) => a.id)).toEqual(["researcher", "coder"]);
  });

  it("resolves workspace dir from override field", async () => {
    const dir = await createTempDir();
    await fs.mkdir(path.join(dir, "custom-workspace"), { recursive: true });
    await fs.writeFile(
      path.join(dir, "openclaw.json"),
      JSON.stringify({
        agents: { list: [{ id: "custom", workspace: "custom-workspace" }] },
      }),
    );
    const source = makeSource(dir);
    const agents = await enumerateSourceAgents(source);
    expect(agents[0]!.workspaceDir).toContain("custom-workspace");
  });

  it("falls back to main agent on parse error", async () => {
    const dir = await createTempDir();
    await fs.writeFile(path.join(dir, "openclaw.json"), "not json");
    const source = makeSource(dir);
    const agents = await enumerateSourceAgents(source);
    expect(agents).toHaveLength(1);
    expect(agents[0]!.id).toBe("main");
  });
});

// ─── enumerateSourceSkills ──────────────────────────────────────────────────

describe("enumerateSourceSkills", () => {
  it("returns skill names with SKILL.md", async () => {
    const dir = await createTempDir();
    await fs.mkdir(path.join(dir, "skills", "weather"), { recursive: true });
    await fs.writeFile(path.join(dir, "skills", "weather", "SKILL.md"), "# Weather");
    await fs.mkdir(path.join(dir, "skills", "github"), { recursive: true });
    await fs.writeFile(path.join(dir, "skills", "github", "SKILL.md"), "# GitHub");
    const source = makeSource(dir);
    const skills = await enumerateSourceSkills(source);
    expect(skills).toEqual(["github", "weather"]);
  });

  it("returns empty array when no skills dir", async () => {
    const dir = await createTempDir();
    const source = makeSource(dir);
    const skills = await enumerateSourceSkills(source);
    expect(skills).toEqual([]);
  });
});

// ─── blacklist workspace migration ──────────────────────────────────────────

describe("blacklist workspace migration", () => {
  it("copies arbitrary agent-created files", async () => {
    const sourceDir = await createTempDir();
    const targetDir = await createTempDir();
    const source = makeSource(sourceDir);

    await fs.mkdir(path.join(sourceDir, "workspace", "data"), { recursive: true });
    await fs.writeFile(path.join(sourceDir, "workspace", "data", "report.csv"), "a,b,c");
    await fs.writeFile(path.join(sourceDir, "workspace", "notes.txt"), "some notes");
    await fs.writeFile(source.configPath, "{}");

    const result = await migrateWorkspace(source, targetDir, defaultOptions());

    await expect(
      fs.readFile(path.join(targetDir, "workspace", "data", "report.csv"), "utf-8"),
    ).resolves.toBe("a,b,c");
    await expect(
      fs.readFile(path.join(targetDir, "workspace", "notes.txt"), "utf-8"),
    ).resolves.toBe("some notes");
    expect(result.changes.length).toBeGreaterThanOrEqual(2);
  });

  it("skips .qmd and .vectors directories entirely", async () => {
    const sourceDir = await createTempDir();
    const targetDir = await createTempDir();
    const source = makeSource(sourceDir);

    await fs.mkdir(path.join(sourceDir, "workspace"), { recursive: true });
    await fs.mkdir(path.join(sourceDir, "workspace", ".qmd"), { recursive: true });
    await fs.writeFile(path.join(sourceDir, "workspace", ".qmd", "index.qmd"), "qmd-data");
    await fs.mkdir(path.join(sourceDir, "workspace", ".vectors"), { recursive: true });
    await fs.writeFile(path.join(sourceDir, "workspace", ".vectors", "vec.bin"), "binary");
    await fs.writeFile(path.join(sourceDir, "workspace", "MEMORY.md"), "# Memory");
    await fs.writeFile(source.configPath, "{}");

    const result = await migrateWorkspace(source, targetDir, defaultOptions());

    await expect(
      fs.stat(path.join(targetDir, "workspace", ".qmd")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      fs.stat(path.join(targetDir, "workspace", ".vectors")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    const memoryChanges = result.changes.filter((c) => c.target.includes("MEMORY.md"));
    expect(memoryChanges.length).toBeGreaterThanOrEqual(1);
  });

  it("uses copy strategy when memoryMergeStrategy is 'copy'", async () => {
    const sourceDir = await createTempDir();
    const targetDir = await createTempDir();
    const source = makeSource(sourceDir);

    await fs.mkdir(path.join(sourceDir, "workspace"), { recursive: true });
    await fs.writeFile(path.join(sourceDir, "workspace", "MEMORY.md"), "# Source Memory");
    await fs.writeFile(source.configPath, "{}");

    await migrateWorkspace(source, targetDir, defaultOptions(), "copy");

    await expect(
      fs.readFile(path.join(targetDir, "workspace", "MEMORY.md"), "utf-8"),
    ).resolves.toBe("# Source Memory");
  });
});

// ─── runFreshMigration ──────────────────────────────────────────────────────

describe("runFreshMigration", () => {
  it("runs full migration with scenario='fresh'", async () => {
    const sourceDir = await createTempDir();
    const targetDir = await createTempDir();

    await fs.writeFile(
      path.join(sourceDir, "openclaw.json"),
      JSON.stringify({ agent: { model: "gpt-4" } }),
    );
    await fs.mkdir(path.join(sourceDir, "workspace"), { recursive: true });
    await fs.writeFile(path.join(sourceDir, "workspace", "SOUL.md"), "# Soul");
    await fs.mkdir(path.join(sourceDir, "skills", "weather"), { recursive: true });
    await fs.writeFile(path.join(sourceDir, "skills", "weather", "SKILL.md"), "# Weather");

    const source = makeSource(sourceDir);
    const report = await runFreshMigration(source, targetDir, defaultOptions());

    expect(report.scenario).toBe("fresh");
    expect(report.totalChanges).toBeGreaterThan(0);
    expect(report.results.length).toBeGreaterThanOrEqual(3);
  });
});

// ─── runImportMigration ─────────────────────────────────────────────────────

describe("runImportMigration", () => {
  it("runs selective migration with scenario='import'", async () => {
    const sourceDir = await createTempDir();
    const targetDir = await createTempDir();

    await fs.writeFile(path.join(sourceDir, "openclaw.json"), JSON.stringify({}));
    await fs.mkdir(path.join(sourceDir, "workspace"), { recursive: true });
    await fs.writeFile(path.join(sourceDir, "workspace", "SOUL.md"), "# Soul");
    await fs.mkdir(path.join(sourceDir, "skills", "weather"), { recursive: true });
    await fs.writeFile(path.join(sourceDir, "skills", "weather", "SKILL.md"), "# Weather");

    const source = makeSource(sourceDir);
    const selections = [{ agentId: "main", dataTypes: ["workspace", "memory"] as DataType[] }];
    const report = await runImportMigration(
      source,
      targetDir,
      defaultOptions(),
      selections,
      ["weather"],
    );

    expect(report.scenario).toBe("import");
    expect(report.totalChanges).toBeGreaterThan(0);
  });

  it("migrates only selected skills", async () => {
    const sourceDir = await createTempDir();
    const targetDir = await createTempDir();

    await fs.writeFile(path.join(sourceDir, "openclaw.json"), "{}");
    await fs.mkdir(path.join(sourceDir, "skills", "weather"), { recursive: true });
    await fs.writeFile(path.join(sourceDir, "skills", "weather", "SKILL.md"), "# Weather");
    await fs.mkdir(path.join(sourceDir, "skills", "github"), { recursive: true });
    await fs.writeFile(path.join(sourceDir, "skills", "github", "SKILL.md"), "# GitHub");

    const source = makeSource(sourceDir);
    await runImportMigration(source, targetDir, defaultOptions(), [], ["weather"]);

    await expect(
      fs.readFile(path.join(targetDir, "skills", "weather", "SKILL.md"), "utf-8"),
    ).resolves.toContain("Weather");
    await expect(
      fs.stat(path.join(targetDir, "skills", "github")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});
