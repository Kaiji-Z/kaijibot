import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { withTempDir } from "./test-helpers/temp-dir.js";
import {
  ensureDir,
  resolveConfigDir,
  resolveHomeDir,
  resolveUserPath,
  shortenHomeInString,
  shortenHomePath,
  sleep,
} from "./utils.js";

describe("ensureDir", () => {
  it("creates nested directory", async () => {
    await withTempDir({ prefix: "kaijibot-test-" }, async (tmp) => {
      const target = path.join(tmp, "nested", "dir");
      await ensureDir(target);
      expect(fs.existsSync(target)).toBe(true);
    });
  });
});

describe("sleep", () => {
  it("resolves after delay using fake timers", async () => {
    vi.useFakeTimers();
    const promise = sleep(1000);
    vi.advanceTimersByTime(1000);
    await expect(promise).resolves.toBeUndefined();
    vi.useRealTimers();
  });
});

describe("resolveConfigDir", () => {
  it("prefers ~/.kaijibot when legacy dir is missing", async () => {
    await withTempDir({ prefix: "kaijibot-config-dir-" }, async (root) => {
      const newDir = path.join(root, ".kaijibot");
      await fs.promises.mkdir(newDir, { recursive: true });
      const resolved = resolveConfigDir({} as NodeJS.ProcessEnv, () => root);
      expect(resolved).toBe(newDir);
    });
  });

  it("expands KAIJIBOT_STATE_DIR using the provided env", () => {
    const env = {
      HOME: "/tmp/kaijibot-home",
      KAIJIBOT_STATE_DIR: "~/state",
    } as NodeJS.ProcessEnv;

    expect(resolveConfigDir(env)).toBe(path.resolve("/tmp/kaijibot-home", "state"));
  });

  it("falls back to the config file directory when only KAIJIBOT_CONFIG_PATH is set", () => {
    const env = {
      HOME: "/tmp/kaijibot-home",
      KAIJIBOT_CONFIG_PATH: "~/profiles/dev/kaijibot.json",
    } as NodeJS.ProcessEnv;

    expect(resolveConfigDir(env)).toBe(path.resolve("/tmp/kaijibot-home", "profiles", "dev"));
  });
});

describe("resolveHomeDir", () => {
  it("prefers KAIJIBOT_HOME over HOME", () => {
    vi.stubEnv("KAIJIBOT_HOME", "/srv/kaijibot-home");
    vi.stubEnv("HOME", "/home/other");

    expect(resolveHomeDir()).toBe(path.resolve("/srv/kaijibot-home"));

    vi.unstubAllEnvs();
  });
});

describe("shortenHomePath", () => {
  it("uses $KAIJIBOT_HOME prefix when KAIJIBOT_HOME is set", () => {
    vi.stubEnv("KAIJIBOT_HOME", "/srv/kaijibot-home");
    vi.stubEnv("HOME", "/home/other");

    expect(shortenHomePath(`${path.resolve("/srv/kaijibot-home")}/.kaijibot/kaijibot.json`)).toBe(
      "$KAIJIBOT_HOME/.kaijibot/kaijibot.json",
    );

    vi.unstubAllEnvs();
  });
});

describe("shortenHomeInString", () => {
  it("uses $KAIJIBOT_HOME replacement when KAIJIBOT_HOME is set", () => {
    vi.stubEnv("KAIJIBOT_HOME", "/srv/kaijibot-home");
    vi.stubEnv("HOME", "/home/other");

    expect(
      shortenHomeInString(`config: ${path.resolve("/srv/kaijibot-home")}/.kaijibot/kaijibot.json`),
    ).toBe("config: $KAIJIBOT_HOME/.kaijibot/kaijibot.json");

    vi.unstubAllEnvs();
  });
});

describe("resolveUserPath", () => {
  it("expands ~ to home dir", () => {
    expect(resolveUserPath("~", {}, () => "/Users/thoffman")).toBe(path.resolve("/Users/thoffman"));
  });

  it("expands ~/ to home dir", () => {
    expect(resolveUserPath("~/kaijibot", {}, () => "/Users/thoffman")).toBe(
      path.resolve("/Users/thoffman", "kaijibot"),
    );
  });

  it("resolves relative paths", () => {
    expect(resolveUserPath("tmp/dir")).toBe(path.resolve("tmp/dir"));
  });

  it("prefers KAIJIBOT_HOME for tilde expansion", () => {
    vi.stubEnv("KAIJIBOT_HOME", "/srv/kaijibot-home");
    vi.stubEnv("HOME", "/home/other");

    expect(resolveUserPath("~/kaijibot")).toBe(path.resolve("/srv/kaijibot-home", "kaijibot"));

    vi.unstubAllEnvs();
  });

  it("uses the provided env for tilde expansion", () => {
    const env = {
      HOME: "/tmp/kaijibot-home",
      KAIJIBOT_HOME: "/srv/kaijibot-home",
    } as NodeJS.ProcessEnv;

    expect(resolveUserPath("~/kaijibot", env)).toBe(path.resolve("/srv/kaijibot-home", "kaijibot"));
  });

  it("keeps blank paths blank", () => {
    expect(resolveUserPath("")).toBe("");
    expect(resolveUserPath("   ")).toBe("");
  });

  it("returns empty string for undefined/null input", () => {
    expect(resolveUserPath(undefined as unknown as string)).toBe("");
    expect(resolveUserPath(null as unknown as string)).toBe("");
  });
});
