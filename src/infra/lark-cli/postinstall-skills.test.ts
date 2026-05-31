/**
 * Tests for installLarkCliSkills in postinstall-bundled-plugins.mjs.
 *
 * The function lives in scripts/ (ESM .mjs) but is tested here because this
 * directory is covered by vitest.infra.config.ts.  The DI pattern (params
 * injection) makes it straightforward to mock all side effects.
 */
import { describe, expect, it, vi } from "vitest";
import {
  installLarkCliSkills,
  createNestedNpmInstallEnv,
} from "../../../scripts/postinstall-bundled-plugins.mjs";

function makeParams(overrides: Record<string, unknown> = {}) {
  return {
    env: { PATH: "/usr/bin" },
    packageRoot: "/opt/kaijibot",
    platform: "linux",
    skillsDir: "/home/user/.agents/skills",
    log: { log: vi.fn(), error: vi.fn(), warn: vi.fn() },
    existsSync: vi.fn(() => false),
    readdirSync: vi.fn(() => []),
    spawnSync: vi.fn(() => ({ status: 0, stdout: "", stderr: "" })),
    ...overrides,
  };
}

/**
 * Mock that simulates "skills not yet installed" for the guard check,
 * then "skills installed" for the post-install verification.
 * - Before spawnSync: areLarkSkillsInstalledInDir → false
 * - After spawnSync:  areLarkSkillsInstalledInDir → true
 */
function happyPathMocks(p: Record<string, unknown>) {
  const skillsDir = p.skillsDir as string;
  let readdirCallCount = 0;

  (p.existsSync as ReturnType<typeof vi.fn>).mockImplementation((fp: string) => {
    if (fp === skillsDir) {
      return true;
    }
    if (fp.endsWith(".git")) {
      return true;
    }
    if (fp.endsWith("src")) {
      return false;
    }
    if (fp.endsWith("extensions")) {
      return false;
    }
    if (fp.endsWith("SKILL.md")) {
      return readdirCallCount > 1;
    }
    return false;
  });

  (p.readdirSync as ReturnType<typeof vi.fn>).mockImplementation((dir: string) => {
    if (dir === skillsDir) {
      readdirCallCount++;
      // First call (guard check) → no lark-* dirs
      // Second call (verification) → has lark-doc
      if (readdirCallCount === 1) {
        return [];
      }
      return [{ isDirectory: () => true, name: "lark-doc" }];
    }
    return [];
  });
}

describe("installLarkCliSkills (postinstall)", () => {
  it("skips when env var is set", () => {
    const p = makeParams({ env: { PATH: "/usr/bin", KAIJIBOT_DISABLE_LARK_SKILLS_INSTALL: "1" } });
    installLarkCliSkills(p);
    expect(p.spawnSync).not.toHaveBeenCalled();
  });

  it("skips for source checkouts (has .git + src + extensions)", () => {
    const p = makeParams();
    (p.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
    installLarkCliSkills(p);
    expect(p.spawnSync).not.toHaveBeenCalled();
  });

  it("skips when lark skills are already installed", () => {
    const p = makeParams();
    const skillsDir = p.skillsDir as string;
    (p.existsSync as ReturnType<typeof vi.fn>).mockImplementation((fp: string) => {
      if (fp === skillsDir) {
        return true;
      }
      if (fp.endsWith(".git")) {
        return true;
      }
      if (fp.endsWith("src")) {
        return false;
      }
      if (fp.endsWith("extensions")) {
        return false;
      }
      if (fp.endsWith("SKILL.md")) {
        return true;
      }
      return false;
    });
    (p.readdirSync as ReturnType<typeof vi.fn>).mockImplementation((dir: string) => {
      if (dir === skillsDir) {
        return [{ isDirectory: () => true, name: "lark-doc" }];
      }
      return [];
    });
    installLarkCliSkills(p);
    expect(p.spawnSync).not.toHaveBeenCalled();
  });

  it("calls npx with -y flag and correct args on linux", () => {
    const p = makeParams();
    happyPathMocks(p);

    installLarkCliSkills(p);

    expect(p.spawnSync).toHaveBeenCalledTimes(1);
    const [cmd, args, opts] = (p.spawnSync as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      string[],
      Record<string, unknown>,
    ];
    expect(cmd).toBe("npx");
    expect(args[0]).toBe("-y");
    expect(args).toContain("skills");
    expect(args).toContain("add");
    expect(args).toContain("larksuite/cli");
    expect(args).toContain("-g");
    expect(args).toContain("--all");
    expect(opts.shell).toBeUndefined();
  });

  it("uses shell:true on Windows", () => {
    const p = makeParams({ platform: "win32" });
    happyPathMocks(p);

    installLarkCliSkills(p);

    const opts = (p.spawnSync as ReturnType<typeof vi.fn>).mock.calls[0][2] as Record<
      string,
      unknown
    >;
    expect(opts.shell).toBe(true);
  });

  it("passes createNestedNpmInstallEnv(env) to spawn", () => {
    const p = makeParams({
      env: {
        PATH: "/usr/bin",
        npm_config_global: "true",
        npm_config_prefix: "/some/prefix",
      },
    });
    happyPathMocks(p);

    installLarkCliSkills(p);

    const opts = (p.spawnSync as ReturnType<typeof vi.fn>).mock.calls[0][2] as Record<
      string,
      unknown
    >;
    const env = opts.env as Record<string, string>;
    expect(env.npm_config_global).toBeUndefined();
    expect(env.npm_config_prefix).toBeUndefined();
  });

  it("sets cwd to homedir (not packageRoot)", () => {
    const p = makeParams();
    happyPathMocks(p);

    installLarkCliSkills(p);

    const opts = (p.spawnSync as ReturnType<typeof vi.fn>).mock.calls[0][2] as Record<
      string,
      unknown
    >;
    expect(opts.cwd).not.toBe(p.packageRoot);
  });

  it("logs error when npx exits non-zero", () => {
    const p = makeParams();
    (p.existsSync as ReturnType<typeof vi.fn>).mockImplementation((fp: string) => {
      if (fp.endsWith(".git")) {
        return true;
      }
      if (fp.endsWith("src")) {
        return false;
      }
      return false;
    });
    (p.spawnSync as ReturnType<typeof vi.fn>).mockReturnValue({
      status: 1,
      stderr: "npm ERR! something went wrong",
      stdout: "",
    });

    installLarkCliSkills(p);

    expect(p.log.error).toHaveBeenCalled();
    const errorMsg = (p.log.error as ReturnType<typeof vi.fn>).mock.calls
      .map((c: unknown[]) => c[0])
      .join(" ");
    expect(errorMsg).toContain("could not install lark-cli skills");
  });

  it("detects spawn error (e.g. ENOENT)", () => {
    const p = makeParams();
    (p.existsSync as ReturnType<typeof vi.fn>).mockImplementation((fp: string) => {
      if (fp.endsWith(".git")) {
        return true;
      }
      if (fp.endsWith("src")) {
        return false;
      }
      return false;
    });
    (p.spawnSync as ReturnType<typeof vi.fn>).mockReturnValue({
      status: null,
      error: new Error("spawn npx ENOENT"),
      stderr: "",
      stdout: "",
    });

    installLarkCliSkills(p);

    expect(p.log.error).toHaveBeenCalled();
    const errorMsg = (p.log.error as ReturnType<typeof vi.fn>).mock.calls
      .map((c: unknown[]) => c[0])
      .join(" ");
    expect(errorMsg).toContain("npx skills add failed");
  });

  it("detects success-but-no-skills-installed", () => {
    const p = makeParams();
    (p.existsSync as ReturnType<typeof vi.fn>).mockImplementation((fp: string) => {
      if (fp.endsWith(".git")) {
        return true;
      }
      if (fp.endsWith("src")) {
        return false;
      }
      return false;
    });
    (p.readdirSync as ReturnType<typeof vi.fn>).mockReturnValue([]);
    (p.spawnSync as ReturnType<typeof vi.fn>).mockReturnValue({
      status: 0,
      stderr: "",
      stdout: "done",
    });

    installLarkCliSkills(p);

    expect(p.log.error).toHaveBeenCalled();
    const errorMsg = (p.log.error as ReturnType<typeof vi.fn>).mock.calls
      .map((c: unknown[]) => c[0])
      .join(" ");
    expect(errorMsg).toContain("no lark-* skills found");
  });
});

describe("createNestedNpmInstallEnv", () => {
  it("strips npm_config_global", () => {
    const env = { npm_config_global: "true", PATH: "/usr/bin" };
    const result = createNestedNpmInstallEnv(env);
    expect(result.npm_config_global).toBeUndefined();
    expect(result.PATH).toBe("/usr/bin");
  });

  it("strips npm_config_location", () => {
    const env = { npm_config_location: "global", PATH: "/usr/bin" };
    const result = createNestedNpmInstallEnv(env);
    expect(result.npm_config_location).toBeUndefined();
  });

  it("strips npm_config_prefix", () => {
    const env = { npm_config_prefix: "/usr/local", PATH: "/usr/bin" };
    const result = createNestedNpmInstallEnv(env);
    expect(result.npm_config_prefix).toBeUndefined();
  });
});
