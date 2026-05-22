import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createTrackedTempDirs } from "../../test-utils/tracked-temp-dirs.js";
import {
  BRAND_HOME_PREFIXES,
  BRAND_REFERENCES,
  STRUCTURAL_REWRITE_REGISTRY,
  extractMarkdownHeaders,
  extractSectionsByHeaderNames,
  extractSectionsByHeaders,
  rewriteBrandReferences,
  rewriteStructuralFile,
  rewriteWorkspaceFile,
  stripFrontMatter,
} from "./brand-rewrite.js";

const tempDirs = createTrackedTempDirs();
const createTempDir = () => tempDirs.make("kaijibot-brand-rewrite-test-");

afterEach(async () => {
  await tempDirs.cleanup();
});

// ─── rewriteBrandReferences ──────────────────────────────────────────────────

describe("rewriteBrandReferences", () => {
  it("replaces OpenClaw with KaijiBot", () => {
    expect(rewriteBrandReferences("Powered by OpenClaw")).toBe("Powered by KaijiBot");
  });

  it("replaces openclaw with kaijibot (lowercase)", () => {
    expect(rewriteBrandReferences("config at ~/.openclaw/")).toBe("config at ~/.kaijibot/");
  });

  it("replaces ClawdBot with KaijiBot", () => {
    expect(rewriteBrandReferences("ClawdBot is great")).toBe("KaijiBot is great");
  });

  it("replaces clawdbot with kaijibot (lowercase)", () => {
    expect(rewriteBrandReferences("run clawdbot --help")).toBe("run kaijibot --help");
  });

  it("replaces MoltBot with KaijiBot", () => {
    expect(rewriteBrandReferences("MoltBot rules")).toBe("KaijiBot rules");
  });

  it("replaces moltbot with kaijibot (lowercase)", () => {
    expect(rewriteBrandReferences("moltbot gateway")).toBe("kaijibot gateway");
  });

  it("replaces ~/.openclaw/ path prefix", () => {
    expect(rewriteBrandReferences("~/.openclaw/workspace")).toBe("~/.kaijibot/workspace");
  });

  it("replaces ~/.clawdbot/ path prefix", () => {
    expect(rewriteBrandReferences("~/.clawdbot/config")).toBe("~/.kaijibot/config");
  });

  it("replaces ~/.moltbot/ path prefix", () => {
    expect(rewriteBrandReferences("~/.moltbot/data")).toBe("~/.kaijibot/data");
  });

  it("replaces avatars/openclaw.png", () => {
    expect(rewriteBrandReferences("img src='avatars/openclaw.png'")).toBe("img src='avatars/kaijibot.png'");
  });

  it("replaces standalone openclaw.png", () => {
    expect(rewriteBrandReferences("icon: openclaw.png")).toBe("icon: kaijibot.png");
  });

  it("no-ops on clean content", () => {
    const clean = "This is KaijiBot content with no old brands.";
    expect(rewriteBrandReferences(clean)).toBe(clean);
  });

  it("handles multiple occurrences", () => {
    const input = "OpenClaw uses ~/.openclaw/ and ClawdBot uses ~/.clawdbot/";
    const result = rewriteBrandReferences(input);
    expect(result).toBe("KaijiBot uses ~/.kaijibot/ and KaijiBot uses ~/.kaijibot/");
    expect(result).not.toContain("OpenClaw");
    expect(result).not.toContain("openclaw");
    expect(result).not.toContain("ClawdBot");
    expect(result).not.toContain("clawdbot");
  });

  it("handles all six brand names in one string", () => {
    const input = "OpenClaw openclaw ClawdBot clawdbot MoltBot moltbot";
    const result = rewriteBrandReferences(input);
    expect(result).toBe("KaijiBot kaijibot KaijiBot kaijibot KaijiBot kaijibot");
  });
});

// ─── stripFrontMatter ────────────────────────────────────────────────────────

describe("stripFrontMatter", () => {
  it("strips YAML front matter", () => {
    const input = "---\ntitle: Test\n---\nContent here";
    expect(stripFrontMatter(input)).toBe("Content here");
  });

  it("returns content unchanged when no front matter", () => {
    const input = "# Hello\nContent";
    expect(stripFrontMatter(input)).toBe(input);
  });

  it("returns content unchanged when closing --- not found", () => {
    const input = "---\ntitle: Test\nContent";
    expect(stripFrontMatter(input)).toBe(input);
  });
});

// ─── extractSectionsByHeaders ────────────────────────────────────────────────

describe("extractSectionsByHeaders", () => {
  it("parses preamble and sections", () => {
    const content = "Preamble line\n\n## Section A\nA content\n\n## Section B\nB content";
    const { preamble, sections } = extractSectionsByHeaders(content);
    expect(preamble).toBe("Preamble line");
    expect(sections).toHaveLength(2);
    expect(sections[0]!.header).toBe("Section A");
    expect(sections[0]!.content).toContain("A content");
    expect(sections[1]!.header).toBe("Section B");
  });

  it("handles content with no headers", () => {
    const content = "Just text\nNo headers";
    const { preamble, sections } = extractSectionsByHeaders(content);
    expect(preamble).toBe("Just text\nNo headers");
    expect(sections).toHaveLength(0);
  });

  it("handles H3 sub-headers within sections", () => {
    const content = "## Main\nMain content\n### Sub\nSub content";
    const { sections } = extractSectionsByHeaders(content);
    expect(sections).toHaveLength(1);
    expect(sections[0]!.content).toContain("### Sub");
    expect(sections[0]!.content).toContain("Sub content");
  });
});

// ─── extractSectionsByHeaderNames ────────────────────────────────────────────

describe("extractSectionsByHeaderNames", () => {
  it("extracts only matching sections", () => {
    const content = "## Alpha\nAlpha content\n\n## Beta\nBeta content\n\n## Gamma\nGamma content";
    const result = extractSectionsByHeaderNames(content, ["Alpha", "Gamma"]);
    expect(result).toContain("Alpha content");
    expect(result).toContain("Gamma content");
    expect(result).not.toContain("Beta content");
  });

  it("returns empty string when no matches", () => {
    const content = "## Alpha\nAlpha content";
    expect(extractSectionsByHeaderNames(content, ["Missing"])).toBe("");
  });
});

// ─── extractMarkdownHeaders ──────────────────────────────────────────────────

describe("extractMarkdownHeaders", () => {
  it("extracts all header titles", () => {
    const content = "# H1\n## H2\n### H3\n#### H4";
    expect(extractMarkdownHeaders(content)).toEqual(["H1", "H2", "H3", "H4"]);
  });
});

// ─── STRUCTURAL_REWRITE_REGISTRY ─────────────────────────────────────────────

describe("STRUCTURAL_REWRITE_REGISTRY", () => {
  it("has entries for AGENTS.md, TOOLS.md, BOOTSTRAP.md", () => {
    expect(STRUCTURAL_REWRITE_REGISTRY.has("AGENTS.md")).toBe(true);
    expect(STRUCTURAL_REWRITE_REGISTRY.has("TOOLS.md")).toBe(true);
    expect(STRUCTURAL_REWRITE_REGISTRY.has("BOOTSTRAP.md")).toBe(true);
  });

  it("AGENTS.md uses section mode with knownSections", () => {
    const rule = STRUCTURAL_REWRITE_REGISTRY.get("AGENTS.md")!;
    expect(rule.mode).toBe("section");
    expect(rule.knownSections).toBeDefined();
    expect(rule.knownSections!.length).toBeGreaterThan(0);
  });

  it("TOOLS.md and BOOTSTRAP.md use full mode", () => {
    expect(STRUCTURAL_REWRITE_REGISTRY.get("TOOLS.md")!.mode).toBe("full");
    expect(STRUCTURAL_REWRITE_REGISTRY.get("BOOTSTRAP.md")!.mode).toBe("full");
  });
});

// ─── rewriteWorkspaceFile ────────────────────────────────────────────────────

describe("rewriteWorkspaceFile", () => {
  it("passes through non-.md files unchanged", async () => {
    const result = await rewriteWorkspaceFile("data.csv", "a,b,c", { dryRun: false });
    expect(result.content).toBe("a,b,c");
    expect(result.wasRewritten).toBe(false);
  });

  it("applies brand swap to MEMORY.md", async () => {
    const result = await rewriteWorkspaceFile("MEMORY.md", "# OpenClaw Memory", { dryRun: false });
    expect(result.content).toBe("# KaijiBot Memory");
    expect(result.wasRewritten).toBe(true);
  });

  it("returns wasRewritten false for MEMORY.md with no brands", async () => {
    const result = await rewriteWorkspaceFile("MEMORY.md", "# Clean Memory", { dryRun: false });
    expect(result.wasRewritten).toBe(false);
  });

  it("applies brand swap to generic .md files", async () => {
    const result = await rewriteWorkspaceFile("NOTES.md", "OpenClaw notes", { dryRun: false });
    expect(result.content).toBe("KaijiBot notes");
    expect(result.wasRewritten).toBe(true);
  });

  it("routes AGENTS.md to structural rewriting", async () => {
    const src = "# My Workspace\n\n## Session Startup\nOpenClaw rules\n\n## User Section\nCustom stuff for OpenClaw";
    const result = await rewriteWorkspaceFile("AGENTS.md", src, { dryRun: false });
    expect(result.wasRewritten).toBe(true);
    expect(result.content).not.toContain("OpenClaw");
  });
});

// ─── rewriteStructuralFile: full mode ────────────────────────────────────────

describe("rewriteStructuralFile full mode", () => {
  it("returns template content for TOOLS.md", async () => {
    const result = await rewriteStructuralFile("TOOLS.md", "old content", { dryRun: false });
    expect(result.wasRewritten).toBe(true);
    expect(result.content.length).toBeGreaterThan(0);
  });

  it("emits warning when user content differs", async () => {
    const result = await rewriteStructuralFile("TOOLS.md", "user customizations here", { dryRun: false });
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0]).toContain("User customizations may have been lost");
  });

  it("returns template content for BOOTSTRAP.md", async () => {
    const result = await rewriteStructuralFile("BOOTSTRAP.md", "old bootstrap", { dryRun: false });
    expect(result.wasRewritten).toBe(true);
  });

  it("returns passthrough for unknown filename", async () => {
    const result = await rewriteStructuralFile("UNKNOWN.md", "content", { dryRun: false });
    expect(result.wasRewritten).toBe(false);
    expect(result.content).toBe("content");
  });
});

// ─── rewriteStructuralFile: section mode (AGENTS.md) ─────────────────────────

describe("rewriteStructuralFile section mode (AGENTS.md)", () => {
  it("replaces known sections with template content", async () => {
    const src = [
      "# My Workspace",
      "",
      "## Session Startup",
      "OpenClaw session startup rules",
      "",
      "## Memory",
      "OpenClaw memory rules",
    ].join("\n");

    const result = await rewriteStructuralFile("AGENTS.md", src, { dryRun: false });
    expect(result.wasRewritten).toBe(true);
    // "Session Startup" and "Memory" are known sections — should be replaced by template
    expect(result.content).not.toContain("OpenClaw session startup rules");
  });

  it("preserves user sections not in knownSections", async () => {
    const src = [
      "## Session Startup",
      "Startup content",
      "",
      "## My Custom Section",
      "Custom OpenClaw stuff here",
    ].join("\n");

    const result = await rewriteStructuralFile("AGENTS.md", src, { dryRun: false });
    expect(result.wasRewritten).toBe(true);
    // User section should be preserved but brand-swapped
    expect(result.content).toContain("My Custom Section");
    expect(result.content).toContain("KaijiBot stuff here");
    expect(result.content).not.toContain("OpenClaw stuff here");
  });

  it("applies brand swap to preamble", async () => {
    const src = "Welcome to OpenClaw!\n\n## Session Startup\nStartup content";
    const result = await rewriteStructuralFile("AGENTS.md", src, { dryRun: false });
    expect(result.content).toContain("Welcome to KaijiBot!");
    expect(result.content).not.toContain("Welcome to OpenClaw");
  });
});

// ─── Constants ───────────────────────────────────────────────────────────────

describe("BRAND_REFERENCES regex", () => {
  it("matches OpenClaw", () => {
    const re = new RegExp(BRAND_REFERENCES.source, BRAND_REFERENCES.flags);
    expect(re.test("Uses OpenClaw for stuff")).toBe(true);
  });

  it("matches openclaw lowercase", () => {
    const re = new RegExp(BRAND_REFERENCES.source, BRAND_REFERENCES.flags);
    expect(re.test("Uses openclaw for integration")).toBe(true);
  });

  it("does not match clean content", () => {
    const re = new RegExp(BRAND_REFERENCES.source, BRAND_REFERENCES.flags);
    expect(re.test("KaijiBot is the best")).toBe(false);
  });
});

describe("BRAND_HOME_PREFIXES", () => {
  it("contains the three brand prefixes", () => {
    expect(BRAND_HOME_PREFIXES).toEqual([
      "~/.openclaw/",
      "~/.clawdbot/",
      "~/.moltbot/",
    ]);
  });
});

// ─── Integration: full migration with brand rewriting ────────────────────────

describe("brand rewrite integration with migrateWorkspace", () => {
  it("rewrites brand references in workspace .md files", async () => {
    const { migrateWorkspace } = await import("./migrate-workspace.js");
    const sourceDir = await createTempDir();
    const targetDir = await createTempDir();

    await fs.mkdir(path.join(sourceDir, "workspace"), { recursive: true });
    await fs.writeFile(
      path.join(sourceDir, "workspace", "NOTES.md"),
      "OpenClaw is configured at ~/.openclaw/",
    );
    const source = {
      dir: sourceDir,
      brand: "openclaw" as const,
      configPath: path.join(sourceDir, "openclaw.json"),
      configFilename: "openclaw.json",
    };
    await fs.writeFile(source.configPath, "{}");

    await migrateWorkspace(source, targetDir, {
      dryRun: false,
      overwrite: false,
      migrateSecrets: false,
    });

    const written = await fs.readFile(
      path.join(targetDir, "workspace", "NOTES.md"),
      "utf-8",
    );
    expect(written).toContain("KaijiBot");
    expect(written).toContain("~/.kaijibot/");
    expect(written).not.toContain("OpenClaw");
    expect(written).not.toContain("~/.openclaw/");
  });

  it("rewrites brand references in MEMORY.md during merge", async () => {
    const { migrateWorkspace } = await import("./migrate-workspace.js");
    const sourceDir = await createTempDir();
    const targetDir = await createTempDir();

    await fs.mkdir(path.join(sourceDir, "workspace"), { recursive: true });
    await fs.writeFile(
      path.join(sourceDir, "workspace", "MEMORY.md"),
      "## OpenClaw Config\nSettings for OpenClaw at ~/.openclaw/",
    );
    await fs.writeFile(path.join(sourceDir, "openclaw.json"), "{}");

    const source = {
      dir: sourceDir,
      brand: "openclaw" as const,
      configPath: path.join(sourceDir, "openclaw.json"),
      configFilename: "openclaw.json",
    };

    await migrateWorkspace(source, targetDir, {
      dryRun: false,
      overwrite: false,
      migrateSecrets: false,
    });

    const written = await fs.readFile(
      path.join(targetDir, "workspace", "MEMORY.md"),
      "utf-8",
    );
    expect(written).toContain("KaijiBot Config");
    expect(written).toContain("~/.kaijibot/");
    expect(written).not.toContain("OpenClaw");
  });

  it("rewrites brand references in migrated skills", async () => {
    const { migrateSkills } = await import("./migrate-skills.js");
    const sourceDir = await createTempDir();
    const targetDir = await createTempDir();

    await fs.mkdir(path.join(sourceDir, "skills", "weather"), { recursive: true });
    await fs.writeFile(
      path.join(sourceDir, "skills", "weather", "SKILL.md"),
      "# Weather Skill for OpenClaw\nUses ~/.openclaw/config",
    );

    const source = {
      dir: sourceDir,
      brand: "openclaw" as const,
      configPath: path.join(sourceDir, "openclaw.json"),
      configFilename: "openclaw.json",
    };

    await migrateSkills(source, targetDir, {
      dryRun: false,
      overwrite: false,
      migrateSecrets: false,
    });

    const written = await fs.readFile(
      path.join(targetDir, "skills", "weather", "SKILL.md"),
      "utf-8",
    );
    expect(written).toContain("Migrated from OpenClaw");
    expect(written).toContain("KaijiBot");
    expect(written).toContain("~/.kaijibot/");
    // Banner intentionally contains "OpenClaw"; body should be rewritten
    const bodyWithoutBanner = written.replace(/<!--.*?-->\n?/s, "");
    expect(bodyWithoutBanner).not.toMatch(/\bOpenClaw\b/);
    expect(bodyWithoutBanner).not.toContain("~/.openclaw/");
  });
});
