import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { withTempDir } from "../test-helpers/temp-dir.js";
import {
  DEFAULT_GATEWAY_PORT,
  resolveDefaultConfigCandidates,
  resolveConfigPathCandidate,
  resolveConfigPath,
  resolveGatewayPort,
  resolveOAuthDir,
  resolveOAuthPath,
  resolveStateDir,
} from "./paths.js";

function envWith(overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return { ...overrides };
}

describe("oauth paths", () => {
  it("prefers KAIJIBOT_OAUTH_DIR over KAIJIBOT_STATE_DIR", () => {
    const env = {
      KAIJIBOT_OAUTH_DIR: "/custom/oauth",
      KAIJIBOT_STATE_DIR: "/custom/state",
    } as NodeJS.ProcessEnv;

    expect(resolveOAuthDir(env, "/custom/state")).toBe(path.resolve("/custom/oauth"));
    expect(resolveOAuthPath(env, "/custom/state")).toBe(
      path.join(path.resolve("/custom/oauth"), "oauth.json"),
    );
  });

  it("derives oauth path from KAIJIBOT_STATE_DIR when unset", () => {
    const env = {
      KAIJIBOT_STATE_DIR: "/custom/state",
    } as NodeJS.ProcessEnv;

    expect(resolveOAuthDir(env, "/custom/state")).toBe(path.join("/custom/state", "credentials"));
    expect(resolveOAuthPath(env, "/custom/state")).toBe(
      path.join("/custom/state", "credentials", "oauth.json"),
    );
  });
});

describe("gateway port resolution", () => {
  it("prefers numeric env values over config", () => {
    expect(
      resolveGatewayPort({ gateway: { port: 19002 } }, envWith({ KAIJIBOT_GATEWAY_PORT: "19001" })),
    ).toBe(19001);
  });

  it("accepts Compose-style IPv4 host publish values from env", () => {
    expect(
      resolveGatewayPort(
        { gateway: { port: 19002 } },
        envWith({ KAIJIBOT_GATEWAY_PORT: "127.0.0.1:18789" }),
      ),
    ).toBe(18789);
  });

  it("accepts Compose-style IPv6 host publish values from env", () => {
    expect(
      resolveGatewayPort(
        { gateway: { port: 19002 } },
        envWith({ KAIJIBOT_GATEWAY_PORT: "[::1]:28789" }),
      ),
    ).toBe(28789);
  });

  it("ignores the legacy env name and falls back to config", () => {
    expect(
      resolveGatewayPort(
        { gateway: { port: 19002 } },
        envWith({ CLAWDBOT_GATEWAY_PORT: "127.0.0.1:18789" }),
      ),
    ).toBe(19002);
  });

  it("falls back to config when the Compose-style suffix is invalid", () => {
    expect(
      resolveGatewayPort(
        { gateway: { port: 19003 } },
        envWith({ KAIJIBOT_GATEWAY_PORT: "127.0.0.1:not-a-port" }),
      ),
    ).toBe(19003);
  });

  it("falls back when malformed IPv6 inputs do not provide an explicit port", () => {
    expect(
      resolveGatewayPort({ gateway: { port: 19003 } }, envWith({ KAIJIBOT_GATEWAY_PORT: "::1" })),
    ).toBe(19003);
    expect(resolveGatewayPort({}, envWith({ KAIJIBOT_GATEWAY_PORT: "2001:db8::1" }))).toBe(
      DEFAULT_GATEWAY_PORT,
    );
  });

  it("falls back to the default port when env is invalid and config is unset", () => {
    expect(resolveGatewayPort({}, envWith({ KAIJIBOT_GATEWAY_PORT: "127.0.0.1:not-a-port" }))).toBe(
      DEFAULT_GATEWAY_PORT,
    );
  });
});

describe("state + config path candidates", () => {
  function expectKaijiBotHomeDefaults(env: NodeJS.ProcessEnv): void {
    const configuredHome = env.KAIJIBOT_HOME;
    if (!configuredHome) {
      throw new Error("KAIJIBOT_HOME must be set for this assertion helper");
    }
    const resolvedHome = path.resolve(configuredHome);
    expect(resolveStateDir(env)).toBe(path.join(resolvedHome, ".kaijibot"));

    const candidates = resolveDefaultConfigCandidates(env);
    expect(candidates[0]).toBe(path.join(resolvedHome, ".kaijibot", "kaijibot.json"));
  }

  it("uses KAIJIBOT_STATE_DIR when set", () => {
    const env = {
      KAIJIBOT_STATE_DIR: "/new/state",
    } as NodeJS.ProcessEnv;

    expect(resolveStateDir(env, () => "/home/test")).toBe(path.resolve("/new/state"));
  });

  it("uses KAIJIBOT_HOME for default state/config locations", () => {
    const env = {
      KAIJIBOT_HOME: "/srv/kaijibot-home",
    } as NodeJS.ProcessEnv;
    expectKaijiBotHomeDefaults(env);
  });

  it("prefers KAIJIBOT_HOME over HOME for default state/config locations", () => {
    const env = {
      KAIJIBOT_HOME: "/srv/kaijibot-home",
      HOME: "/home/other",
    } as NodeJS.ProcessEnv;
    expectKaijiBotHomeDefaults(env);
  });

  it("orders default config candidates in a stable order", () => {
    const home = "/home/test";
    const resolvedHome = path.resolve(home);
    const candidates = resolveDefaultConfigCandidates({} as NodeJS.ProcessEnv, () => home);
    const expected = [
      path.join(resolvedHome, ".kaijibot", "kaijibot.json"),
      path.join(resolvedHome, ".kaijibot", "clawdbot.json"),
      path.join(resolvedHome, ".clawdbot", "kaijibot.json"),
      path.join(resolvedHome, ".clawdbot", "clawdbot.json"),
    ];
    expect(candidates).toEqual(expected);
  });

  it("prefers ~/.kaijibot when it exists and legacy dir is missing", async () => {
    await withTempDir({ prefix: "kaijibot-state-" }, async (root) => {
      const newDir = path.join(root, ".kaijibot");
      await fs.mkdir(newDir, { recursive: true });
      const resolved = resolveStateDir({} as NodeJS.ProcessEnv, () => root);
      expect(resolved).toBe(newDir);
    });
  });

  it("falls back to existing legacy state dir when ~/.kaijibot is missing", async () => {
    await withTempDir({ prefix: "kaijibot-state-legacy-" }, async (root) => {
      const legacyDir = path.join(root, ".clawdbot");
      await fs.mkdir(legacyDir, { recursive: true });
      const resolved = resolveStateDir({} as NodeJS.ProcessEnv, () => root);
      expect(resolved).toBe(legacyDir);
    });
  });

  it("CONFIG_PATH prefers existing config when present", async () => {
    await withTempDir({ prefix: "kaijibot-config-" }, async (root) => {
      const legacyDir = path.join(root, ".kaijibot");
      await fs.mkdir(legacyDir, { recursive: true });
      const legacyPath = path.join(legacyDir, "kaijibot.json");
      await fs.writeFile(legacyPath, "{}", "utf-8");

      const resolved = resolveConfigPathCandidate({} as NodeJS.ProcessEnv, () => root);
      expect(resolved).toBe(legacyPath);
    });
  });

  it("respects state dir overrides when config is missing", async () => {
    await withTempDir({ prefix: "kaijibot-config-override-" }, async (root) => {
      const legacyDir = path.join(root, ".kaijibot");
      await fs.mkdir(legacyDir, { recursive: true });
      const legacyConfig = path.join(legacyDir, "kaijibot.json");
      await fs.writeFile(legacyConfig, "{}", "utf-8");

      const overrideDir = path.join(root, "override");
      const env = { KAIJIBOT_STATE_DIR: overrideDir } as NodeJS.ProcessEnv;
      const resolved = resolveConfigPath(env, overrideDir, () => root);
      expect(resolved).toBe(path.join(overrideDir, "kaijibot.json"));
    });
  });
});
