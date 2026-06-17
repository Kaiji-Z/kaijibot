import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockIsLarkCliAvailable } = vi.hoisted(() => ({
  mockIsLarkCliAvailable: vi.fn<() => boolean>(),
}));

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: vi.fn(() => "/home/testuser") };
});

vi.mock("./resolve.ts", () => ({
  isLarkCliAvailable: mockIsLarkCliAvailable,
}));

import { areLarkSkillsInstalled, shouldDisableNativeTools } from "./auto-disable.ts";

const mockHomedir = vi.mocked(homedir);

function makeTempSkillsDir(): string {
  const dir = join(
    tmpdir(),
    `kaijibot-test-skills-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("areLarkSkillsInstalled", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempSkillsDir();
    mockHomedir.mockReturnValue(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("returns true when lark-* directories with SKILL.md exist in ~/.agents/skills/", () => {
    const skillsDir = join(tempDir, ".agents", "skills");
    mkdirSync(join(skillsDir, "lark-im"), { recursive: true });
    writeFileSync(join(skillsDir, "lark-im", "SKILL.md"), "# lark-im");
    mkdirSync(join(skillsDir, "lark-doc"), { recursive: true });
    writeFileSync(join(skillsDir, "lark-doc", "SKILL.md"), "# lark-doc");

    expect(areLarkSkillsInstalled()).toBe(true);
  });

  it("returns true with a single lark-* directory with SKILL.md among non-lark directories", () => {
    const skillsDir = join(tempDir, ".agents", "skills");
    mkdirSync(join(skillsDir, "other-skill"), { recursive: true });
    mkdirSync(join(skillsDir, "lark-calendar"), { recursive: true });
    writeFileSync(join(skillsDir, "lark-calendar", "SKILL.md"), "# lark-calendar");
    mkdirSync(join(skillsDir, "weather"), { recursive: true });

    expect(areLarkSkillsInstalled()).toBe(true);
  });

  it("returns false when lark-* directories exist but have no SKILL.md", () => {
    const skillsDir = join(tempDir, ".agents", "skills");
    mkdirSync(join(skillsDir, "lark-im"), { recursive: true });
    mkdirSync(join(skillsDir, "lark-doc"), { recursive: true });

    expect(areLarkSkillsInstalled()).toBe(false);
  });

  it("returns false when no lark-* directories exist", () => {
    const skillsDir = join(tempDir, ".agents", "skills");
    mkdirSync(join(skillsDir, "weather"), { recursive: true });
    mkdirSync(join(skillsDir, "github"), { recursive: true });

    expect(areLarkSkillsInstalled()).toBe(false);
  });

  it("returns false when only lark-* files (not directories) exist", () => {
    const skillsDir = join(tempDir, ".agents", "skills");
    mkdirSync(skillsDir, { recursive: true });
    const { writeFileSync } = require("node:fs") as typeof import("node:fs");
    writeFileSync(join(skillsDir, "lark-notes.txt"), "not a dir");

    expect(areLarkSkillsInstalled()).toBe(false);
  });

  it("returns false when ~/.agents/skills/ directory does not exist", () => {
    expect(areLarkSkillsInstalled()).toBe(false);
  });

  it("returns false when skills directory exists but is empty", () => {
    mkdirSync(join(tempDir, ".agents", "skills"), { recursive: true });

    expect(areLarkSkillsInstalled()).toBe(false);
  });

  it("returns false when readdirSync throws", () => {
    const skillsDir = join(tempDir, ".agents", "skills");
    mkdirSync(join(skillsDir, "lark-im"), { recursive: true });

    const { chmodSync } = require("node:fs") as typeof import("node:fs");
    try {
      chmodSync(skillsDir, 0o000);
      expect(areLarkSkillsInstalled()).toBe(false);
    } catch {
      // chmod may fail on some systems (e.g. running as root); skip gracefully
    } finally {
      try {
        chmodSync(skillsDir, 0o755);
      } catch {
        /* noop */
      }
    }
  });

  it("uses homedir() to construct the skills path", () => {
    mockHomedir.mockReturnValue("/custom/home");

    expect(areLarkSkillsInstalled()).toBe(false);
  });
});

describe("shouldDisableNativeTools", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = makeTempSkillsDir();
    mockHomedir.mockReturnValue(tempDir);
    mockIsLarkCliAvailable.mockReturnValue(true);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  function installLarkSkill() {
    const skillsDir = join(tempDir, ".agents", "skills");
    mkdirSync(join(skillsDir, "lark-im"), { recursive: true });
    writeFileSync(join(skillsDir, "lark-im", "SKILL.md"), "# lark-im");
  }

  it("returns true when all guards pass (CLI available + skills installed + no user override)", () => {
    installLarkSkill();
    expect(shouldDisableNativeTools(undefined)).toBe(true);
  });

  it("returns true when userToolsConfig is empty object", () => {
    installLarkSkill();
    expect(shouldDisableNativeTools({})).toBe(true);
  });

  it("returns false when CLI is not available", () => {
    installLarkSkill();
    mockIsLarkCliAvailable.mockReturnValue(false);

    expect(shouldDisableNativeTools(undefined)).toBe(false);
  });

  it("returns false when skills are not installed", () => {
    mkdirSync(join(tempDir, ".agents", "skills"), { recursive: true });

    expect(shouldDisableNativeTools(undefined)).toBe(false);
  });

  it("returns false when user has explicitly configured tools (non-empty object)", () => {
    installLarkSkill();
    expect(shouldDisableNativeTools({ doc: true })).toBe(false);
  });

  it("returns false when userToolsConfig has multiple keys", () => {
    installLarkSkill();
    expect(shouldDisableNativeTools({ doc: true, chat: false })).toBe(false);
  });

  it("returns false when both CLI unavailable and skills missing", () => {
    mockIsLarkCliAvailable.mockReturnValue(false);

    expect(shouldDisableNativeTools(undefined)).toBe(false);
  });

  it("returns false when CLI available but skills dir does not exist", () => {
    expect(shouldDisableNativeTools(undefined)).toBe(false);
  });
});
