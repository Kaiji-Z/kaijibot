import path from "node:path";
import { describe, expect, it } from "vitest";
import { formatCliCommand } from "./command-format.js";
import { applyCliProfileEnv, parseCliProfileArgs } from "./profile.js";

describe("parseCliProfileArgs", () => {
  it("leaves gateway --dev for subcommands", () => {
    const res = parseCliProfileArgs([
      "node",
      "kaijibot",
      "gateway",
      "--dev",
      "--allow-unconfigured",
    ]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBeNull();
    expect(res.argv).toEqual(["node", "kaijibot", "gateway", "--dev", "--allow-unconfigured"]);
  });

  it("leaves gateway --dev for subcommands after leading root options", () => {
    const res = parseCliProfileArgs([
      "node",
      "kaijibot",
      "--no-color",
      "gateway",
      "--dev",
      "--allow-unconfigured",
    ]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBeNull();
    expect(res.argv).toEqual([
      "node",
      "kaijibot",
      "--no-color",
      "gateway",
      "--dev",
      "--allow-unconfigured",
    ]);
  });

  it("still accepts global --dev before subcommand", () => {
    const res = parseCliProfileArgs(["node", "kaijibot", "--dev", "gateway"]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBe("dev");
    expect(res.argv).toEqual(["node", "kaijibot", "gateway"]);
  });

  it("parses --profile value and strips it", () => {
    const res = parseCliProfileArgs(["node", "kaijibot", "--profile", "work", "status"]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBe("work");
    expect(res.argv).toEqual(["node", "kaijibot", "status"]);
  });

  it("parses interleaved --profile after the command token", () => {
    const res = parseCliProfileArgs(["node", "kaijibot", "status", "--profile", "work", "--deep"]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBe("work");
    expect(res.argv).toEqual(["node", "kaijibot", "status", "--deep"]);
  });

  it("parses interleaved --dev after the command token", () => {
    const res = parseCliProfileArgs(["node", "kaijibot", "status", "--dev"]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBe("dev");
    expect(res.argv).toEqual(["node", "kaijibot", "status"]);
  });

  it("rejects missing profile value", () => {
    const res = parseCliProfileArgs(["node", "kaijibot", "--profile"]);
    expect(res.ok).toBe(false);
  });

  it.each([
    ["--dev first", ["node", "kaijibot", "--dev", "--profile", "work", "status"]],
    ["--profile first", ["node", "kaijibot", "--profile", "work", "--dev", "status"]],
    ["interleaved after command", ["node", "kaijibot", "status", "--profile", "work", "--dev"]],
  ])("rejects combining --dev with --profile (%s)", (_name, argv) => {
    const res = parseCliProfileArgs(argv);
    expect(res.ok).toBe(false);
  });
});

describe("applyCliProfileEnv", () => {
  it("fills env defaults for dev profile", () => {
    const env: Record<string, string | undefined> = {};
    applyCliProfileEnv({
      profile: "dev",
      env,
      homedir: () => "/home/peter",
    });
    const expectedStateDir = path.join(path.resolve("/home/peter"), ".kaijibot-dev");
    expect(env.KAIJIBOT_PROFILE).toBe("dev");
    expect(env.KAIJIBOT_STATE_DIR).toBe(expectedStateDir);
    expect(env.KAIJIBOT_CONFIG_PATH).toBe(path.join(expectedStateDir, "kaijibot.json"));
    expect(env.KAIJIBOT_GATEWAY_PORT).toBe("19001");
  });

  it("does not override explicit env values", () => {
    const env: Record<string, string | undefined> = {
      KAIJIBOT_STATE_DIR: "/custom",
      KAIJIBOT_GATEWAY_PORT: "19099",
    };
    applyCliProfileEnv({
      profile: "dev",
      env,
      homedir: () => "/home/peter",
    });
    expect(env.KAIJIBOT_STATE_DIR).toBe("/custom");
    expect(env.KAIJIBOT_GATEWAY_PORT).toBe("19099");
    expect(env.KAIJIBOT_CONFIG_PATH).toBe(path.join("/custom", "kaijibot.json"));
  });

  it("uses KAIJIBOT_HOME when deriving profile state dir", () => {
    const env: Record<string, string | undefined> = {
      KAIJIBOT_HOME: "/srv/kaijibot-home",
      HOME: "/home/other",
    };
    applyCliProfileEnv({
      profile: "work",
      env,
      homedir: () => "/home/fallback",
    });

    const resolvedHome = path.resolve("/srv/kaijibot-home");
    expect(env.KAIJIBOT_STATE_DIR).toBe(path.join(resolvedHome, ".kaijibot-work"));
    expect(env.KAIJIBOT_CONFIG_PATH).toBe(
      path.join(resolvedHome, ".kaijibot-work", "kaijibot.json"),
    );
  });
});

describe("formatCliCommand", () => {
  it.each([
    {
      name: "no profile is set",
      cmd: "kaijibot doctor --fix",
      env: {},
      expected: "kaijibot doctor --fix",
    },
    {
      name: "profile is default",
      cmd: "kaijibot doctor --fix",
      env: { KAIJIBOT_PROFILE: "default" },
      expected: "kaijibot doctor --fix",
    },
    {
      name: "profile is Default (case-insensitive)",
      cmd: "kaijibot doctor --fix",
      env: { KAIJIBOT_PROFILE: "Default" },
      expected: "kaijibot doctor --fix",
    },
    {
      name: "profile is invalid",
      cmd: "kaijibot doctor --fix",
      env: { KAIJIBOT_PROFILE: "bad profile" },
      expected: "kaijibot doctor --fix",
    },
    {
      name: "--profile is already present",
      cmd: "kaijibot --profile work doctor --fix",
      env: { KAIJIBOT_PROFILE: "work" },
      expected: "kaijibot --profile work doctor --fix",
    },
    {
      name: "--dev is already present",
      cmd: "kaijibot --dev doctor",
      env: { KAIJIBOT_PROFILE: "dev" },
      expected: "kaijibot --dev doctor",
    },
  ])("returns command unchanged when $name", ({ cmd, env, expected }) => {
    expect(formatCliCommand(cmd, env)).toBe(expected);
  });

  it("inserts --profile flag when profile is set", () => {
    expect(formatCliCommand("kaijibot doctor --fix", { KAIJIBOT_PROFILE: "work" })).toBe(
      "kaijibot --profile work doctor --fix",
    );
  });

  it("trims whitespace from profile", () => {
    expect(formatCliCommand("kaijibot doctor --fix", { KAIJIBOT_PROFILE: "  jbkaijibot  " })).toBe(
      "kaijibot --profile jbkaijibot doctor --fix",
    );
  });

  it("handles command with no args after kaijibot", () => {
    expect(formatCliCommand("kaijibot", { KAIJIBOT_PROFILE: "test" })).toBe(
      "kaijibot --profile test",
    );
  });

  it("handles pnpm wrapper", () => {
    expect(formatCliCommand("pnpm kaijibot doctor", { KAIJIBOT_PROFILE: "work" })).toBe(
      "pnpm kaijibot --profile work doctor",
    );
  });

  it("inserts --container when a container hint is set", () => {
    expect(
      formatCliCommand("kaijibot gateway status --deep", { KAIJIBOT_CONTAINER_HINT: "demo" }),
    ).toBe("kaijibot --container demo gateway status --deep");
  });

  it("ignores unsafe container hints", () => {
    expect(
      formatCliCommand("kaijibot gateway status --deep", {
        KAIJIBOT_CONTAINER_HINT: "demo; rm -rf /",
      }),
    ).toBe("kaijibot gateway status --deep");
  });

  it("preserves both --container and --profile hints", () => {
    expect(
      formatCliCommand("kaijibot doctor", {
        KAIJIBOT_CONTAINER_HINT: "demo",
        KAIJIBOT_PROFILE: "work",
      }),
    ).toBe("kaijibot --container demo doctor");
  });

  it("does not prepend --container for update commands", () => {
    expect(formatCliCommand("kaijibot update", { KAIJIBOT_CONTAINER_HINT: "demo" })).toBe(
      "kaijibot update",
    );
    expect(
      formatCliCommand("pnpm kaijibot update --channel beta", { KAIJIBOT_CONTAINER_HINT: "demo" }),
    ).toBe("pnpm kaijibot update --channel beta");
  });
});
