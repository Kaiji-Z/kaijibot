import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { withTempHome } from "../../test/helpers/temp-home.js";
import * as noteModule from "../terminal/note.js";
import { setChannelPluginRegistryForTests } from "./channel-test-registry.js";
import { loadAndMaybeMigrateDoctorConfig } from "./doctor-config-flow.js";
import { runDoctorConfigWithInput } from "./doctor-config-flow.test-utils.js";

function sanitizeMatrixPathSegment(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "_")
      .replace(/^_+|_+$/g, "") || "unknown"
  );
}

function resolveMatrixAccountStorageRoot(params: {
  stateDir: string;
  homeserver: string;
  userId: string;
  accessToken: string;
  accountId?: string | null;
}): { rootDir: string; accountKey: string; tokenHash: string } {
  const accountKey = sanitizeMatrixPathSegment(params.accountId ?? "default");
  const userKey = sanitizeMatrixPathSegment(params.userId);
  const serverKey = sanitizeMatrixPathSegment(new URL(params.homeserver).host);
  const tokenHash = crypto
    .createHash("sha256")
    .update(params.accessToken)
    .digest("hex")
    .slice(0, 16);
  return {
    rootDir: path.join(
      params.stateDir,
      "matrix",
      "accounts",
      accountKey,
      `${serverKey}__${userKey}`,
      tokenHash,
    ),
    accountKey,
    tokenHash,
  };
}

function expectGoogleChatDmAllowFromRepaired(cfg: unknown) {
  const typed = cfg as {
    channels: {
      googlechat: {
        dmPolicy?: string;
        allowFrom?: string[];
        dm?: { allowFrom?: string[] };
      };
    };
  };
  expect(typed.channels.googlechat.dmPolicy).toBe("open");
  expect(typed.channels.googlechat.allowFrom).toEqual(["*"]);
  expect(typed.channels.googlechat.dm).toBeUndefined();
}

async function collectDoctorWarnings(config: Record<string, unknown>): Promise<string[]> {
  const noteSpy = vi.spyOn(noteModule, "note").mockImplementation(() => {});
  try {
    await runDoctorConfigWithInput({
      config,
      run: loadAndMaybeMigrateDoctorConfig,
    });
    return noteSpy.mock.calls
      .filter((call) => call[1] === "Doctor warnings")
      .map((call) => String(call[0]));
  } finally {
    noteSpy.mockRestore();
  }
}

type DiscordIdList = Array<string | number>;

type DiscordGuildRule = {
  users: DiscordIdList;
  roles: DiscordIdList;
  channels: Record<string, { users: DiscordIdList; roles: DiscordIdList }>;
};

type DiscordAccountRule = {
  allowFrom?: DiscordIdList;
  dm?: { allowFrom: DiscordIdList; groupChannels: DiscordIdList };
  execApprovals?: { approvers: DiscordIdList };
  guilds?: Record<string, DiscordGuildRule>;
};

type RepairedDiscordPolicy = {
  allowFrom?: DiscordIdList;
  dm: { allowFrom: DiscordIdList; groupChannels: DiscordIdList };
  execApprovals: { approvers: DiscordIdList };
  guilds: Record<string, DiscordGuildRule>;
  accounts: Record<string, DiscordAccountRule>;
};

describe("doctor config flow", () => {
  beforeEach(() => {
    setChannelPluginRegistryForTests([
      "discord",
      "googlechat",
      "imessage",
      "matrix",
      "slack",
      "telegram",
      "whatsapp",
      "zalouser",
    ]);
  });

  it("preserves invalid config for doctor repairs", async () => {
    const result = await runDoctorConfigWithInput({
      config: {
        gateway: { auth: { mode: "token", token: 123 } },
        agents: { list: [{ id: "pi" }] },
      },
      run: loadAndMaybeMigrateDoctorConfig,
    });

    expect((result.cfg as Record<string, unknown>).gateway).toEqual({
      auth: { mode: "token", token: 123 },
    });
  });

  it("does not warn on mutable account allowlists when dangerous name matching is inherited", async () => {
    const doctorWarnings = await collectDoctorWarnings({
      channels: {
        slack: {
          dangerouslyAllowNameMatching: true,
          accounts: {
            work: {
              allowFrom: ["alice"],
            },
          },
        },
      },
    });
    expect(doctorWarnings.some((line) => line.includes("mutable allowlist"))).toBe(false);
  });

  // googlechat ships no bundled channel plugin here, so it uses the default
  // sender-based group capabilities and gets the generic empty-allowlist warning.
  it("warns about empty sender-based group allowlist for googlechat", async () => {
    const doctorWarnings = await collectDoctorWarnings({
      channels: {
        googlechat: {
          groupPolicy: "allowlist",
          accounts: {
            work: {
              groupPolicy: "allowlist",
            },
          },
        },
      },
    });

    expect(
      doctorWarnings.some(
        (line) => line.includes('groupPolicy is "allowlist"') && line.includes("groupAllowFrom"),
      ),
    ).toBe(true);
  });

  it("warns about empty group allowlist for first-time Telegram setups", async () => {
    const doctorWarnings = await collectDoctorWarnings({
      channels: {
        telegram: {
          botToken: "123:abc",
          groupPolicy: "allowlist",
        },
      },
    });

    expect(
      doctorWarnings.some(
        (line) =>
          line.includes('channels.telegram.groupPolicy is "allowlist"') &&
          line.includes("groupAllowFrom"),
      ),
    ).toBe(true);
    expect(doctorWarnings.some((line) => line.includes("first-time setup mode"))).toBe(false);
  });

  it("warns about empty group allowlist for account-scoped first-time Telegram setups", async () => {
    const doctorWarnings = await collectDoctorWarnings({
      channels: {
        telegram: {
          accounts: {
            default: {
              botToken: "123:abc",
              groupPolicy: "allowlist",
            },
          },
        },
      },
    });

    expect(
      doctorWarnings.some(
        (line) =>
          line.includes('channels.telegram.accounts.default.groupPolicy is "allowlist"') &&
          line.includes("groupAllowFrom"),
      ),
    ).toBe(true);
    expect(doctorWarnings.some((line) => line.includes("first-time setup mode"))).toBe(false);
  });

  // The plugin-blocker scan only covers bundled channel plugins; telegram is
  // not bundled here, so disabling its (nonexistent) plugin emits no guidance.
  it("emits no plugin-blocked guidance for telegram without a bundled telegram plugin", async () => {
    const doctorWarnings = await collectDoctorWarnings({
      channels: {
        telegram: {
          botToken: "123:abc",
          groupPolicy: "allowlist",
        },
      },
      plugins: {
        entries: {
          telegram: {
            enabled: false,
          },
        },
      },
    });

    expect(
      doctorWarnings.some((line) =>
        line.includes(
          'channels.telegram: channel is configured, but plugin "telegram" is disabled by plugins.entries.telegram.enabled=false.',
        ),
      ),
    ).toBe(false);
    expect(doctorWarnings.some((line) => line.includes("first-time setup mode"))).toBe(false);
  });

  it("emits no global plugin-blocked guidance for telegram without a bundled telegram plugin", async () => {
    const doctorWarnings = await collectDoctorWarnings({
      channels: {
        telegram: {
          botToken: "123:abc",
          groupPolicy: "allowlist",
        },
      },
      plugins: {
        enabled: false,
      },
    });

    expect(
      doctorWarnings.some((line) =>
        line.includes(
          "channels.telegram: channel is configured, but plugins.enabled=false blocks channel plugins globally.",
        ),
      ),
    ).toBe(false);
    expect(doctorWarnings.some((line) => line.includes("first-time setup mode"))).toBe(false);
  });

  it("does not warn on mutable Zalouser group entries without a bundled zalouser plugin", async () => {
    const doctorWarnings = await collectDoctorWarnings({
      channels: {
        zalouser: {
          groups: {
            "Ops Room": { allow: true },
          },
        },
      },
    });

    expect(
      doctorWarnings.some(
        (line) =>
          line.includes("mutable allowlist") && line.includes("channels.zalouser.groups: Ops Room"),
      ),
    ).toBe(false);
  });

  it("does not warn on mutable Zalouser group entries when dangerous name matching is enabled", async () => {
    const doctorWarnings = await collectDoctorWarnings({
      channels: {
        zalouser: {
          dangerouslyAllowNameMatching: true,
          groups: {
            "Ops Room": { allow: true },
          },
        },
      },
    });

    expect(doctorWarnings.some((line) => line.includes("channels.zalouser.groups"))).toBe(false);
  });

  // imessage ships no bundled channel plugin here, so group allowlists fall
  // back to allowFrom per the default capabilities and no warning is emitted.
  it("does not warn when imessage group allowlist falls back to allowFrom", async () => {
    const doctorWarnings = await collectDoctorWarnings({
      channels: {
        imessage: {
          groupPolicy: "allowlist",
          allowFrom: ["+15551234567"],
        },
      },
    });

    expect(
      doctorWarnings.some(
        (line) =>
          line.includes('channels.imessage.groupPolicy is "allowlist"') &&
          line.includes("does not fall back to allowFrom"),
      ),
    ).toBe(false);
  });

  it("drops unknown keys on repair", async () => {
    const result = await runDoctorConfigWithInput({
      repair: true,
      config: {
        bridge: { bind: "auto" },
        gateway: { auth: { mode: "token", token: "ok", extra: true } },
        agents: { list: [{ id: "pi" }] },
      },
      run: loadAndMaybeMigrateDoctorConfig,
    });

    const cfg = result.cfg as Record<string, unknown>;
    expect(cfg.bridge).toBeUndefined();
    expect((cfg.gateway as Record<string, unknown>)?.auth).toEqual({
      mode: "token",
      token: "ok",
    });
  });

  it("migrates legacy browser extension profiles to existing-session on repair", async () => {
    const result = await runDoctorConfigWithInput({
      repair: true,
      config: {
        browser: {
          relayBindHost: "0.0.0.0",
          profiles: {
            chromeLive: {
              driver: "extension",
              color: "#00AA00",
            },
          },
        },
      },
      run: loadAndMaybeMigrateDoctorConfig,
    });

    const browser = (result.cfg as { browser?: Record<string, unknown> }).browser ?? {};
    expect(browser.relayBindHost).toBeUndefined();
    expect(
      ((browser.profiles as Record<string, { driver?: string }>)?.chromeLive ?? {}).driver,
    ).toBe("existing-session");
  });

  it("repairs restrictive plugins.allow when browser is referenced via tools.alsoAllow", async () => {
    const result = await runDoctorConfigWithInput({
      repair: true,
      config: {
        tools: {
          alsoAllow: ["browser"],
        },
        plugins: {
          allow: ["telegram"],
        },
      },
      run: loadAndMaybeMigrateDoctorConfig,
    });

    // telegram is pruned as a stale (un-bundled) plugin id during the repair.
    expect(result.cfg.plugins?.allow).toEqual(["browser"]);
    expect(result.cfg.plugins?.entries?.browser?.enabled).toBe(true);
  });

  // Matrix migrations ship with the matrix channel plugin, which is not
  // bundled in this repo; doctor leaves legacy Matrix state untouched.
  it("previews no Matrix legacy sync-store migration in read-only mode", async () => {
    const noteSpy = vi.spyOn(noteModule, "note").mockImplementation(() => {});
    try {
      await withTempHome(async (home) => {
        const stateDir = path.join(home, ".kaijibot");
        await fs.mkdir(path.join(stateDir, "matrix"), { recursive: true });
        await fs.writeFile(
          path.join(stateDir, "kaijibot.json"),
          JSON.stringify({
            channels: {
              matrix: {
                homeserver: "https://matrix.example.org",
                userId: "@bot:example.org",
                accessToken: "tok-123",
              },
            },
          }),
        );
        await fs.writeFile(
          path.join(stateDir, "matrix", "bot-storage.json"),
          '{"next_batch":"s1"}',
        );
        await loadAndMaybeMigrateDoctorConfig({
          options: { nonInteractive: true },
          confirm: async () => false,
        });

        expect(
          noteSpy.mock.calls.some(
            (call) =>
              call[1] === "Doctor warnings" &&
              String(call[0]).includes("Matrix plugin upgraded in place."),
          ),
        ).toBe(false);
        expect(
          await fs
            .access(path.join(stateDir, "matrix", "bot-storage.json"))
            .then(() => true)
            .catch(() => false),
        ).toBe(true);
      });
    } finally {
      noteSpy.mockRestore();
    }
  });

  it("previews no Matrix encrypted-state migration in read-only mode", async () => {
    const noteSpy = vi.spyOn(noteModule, "note").mockImplementation(() => {});
    try {
      await withTempHome(async (home) => {
        const stateDir = path.join(home, ".kaijibot");
        const { rootDir: accountRoot } = resolveMatrixAccountStorageRoot({
          stateDir,
          homeserver: "https://matrix.example.org",
          userId: "@bot:example.org",
          accessToken: "tok-123",
        });
        await fs.mkdir(path.join(accountRoot, "crypto"), { recursive: true });
        await fs.writeFile(
          path.join(stateDir, "kaijibot.json"),
          JSON.stringify({
            channels: {
              matrix: {
                homeserver: "https://matrix.example.org",
                userId: "@bot:example.org",
                accessToken: "tok-123",
              },
            },
          }),
        );
        await fs.writeFile(
          path.join(accountRoot, "crypto", "bot-sdk.json"),
          JSON.stringify({ deviceId: "DEVICE123" }),
        );
        await loadAndMaybeMigrateDoctorConfig({
          options: { nonInteractive: true },
          confirm: async () => false,
        });

        expect(
          noteSpy.mock.calls.some(
            (call) =>
              call[1] === "Doctor warnings" &&
              String(call[0]).includes("Matrix encrypted-state migration is pending"),
          ),
        ).toBe(false);
        expect(
          await fs
            .access(path.join(accountRoot, "crypto", "bot-sdk.json"))
            .then(() => true)
            .catch(() => false),
        ).toBe(true);
      });
    } finally {
      noteSpy.mockRestore();
    }
  });

  it("leaves Matrix legacy state in place on doctor repair", async () => {
    const noteSpy = vi.spyOn(noteModule, "note").mockImplementation(() => {});
    try {
      await withTempHome(async (home) => {
        const stateDir = path.join(home, ".kaijibot");
        await fs.mkdir(path.join(stateDir, "matrix"), { recursive: true });
        await fs.writeFile(
          path.join(stateDir, "kaijibot.json"),
          JSON.stringify({
            channels: {
              matrix: {
                homeserver: "https://matrix.example.org",
                userId: "@bot:example.org",
                accessToken: "tok-123",
              },
            },
          }),
        );
        await fs.writeFile(
          path.join(stateDir, "matrix", "bot-storage.json"),
          '{"next_batch":"s1"}',
        );
        await loadAndMaybeMigrateDoctorConfig({
          options: { nonInteractive: true, repair: true },
          confirm: async () => false,
        });

        const migratedRoot = path.join(
          stateDir,
          "matrix",
          "accounts",
          "default",
          "matrix.example.org__bot_example.org",
        );
        expect(
          await fs
            .access(migratedRoot)
            .then(() => true)
            .catch(() => false),
        ).toBe(false);
        expect(
          await fs
            .access(path.join(stateDir, "matrix", "bot-storage.json"))
            .then(() => true)
            .catch(() => false),
        ).toBe(true);
      });

      expect(
        noteSpy.mock.calls.some(
          (call) =>
            call[1] === "Doctor changes" &&
            String(call[0]).includes("Matrix plugin upgraded in place."),
        ),
      ).toBe(false);
    } finally {
      noteSpy.mockRestore();
    }
  });

  it("creates no Matrix migration snapshot when no migration runs", async () => {
    await withTempHome(async (home) => {
      const stateDir = path.join(home, ".kaijibot");
      await fs.mkdir(path.join(stateDir, "matrix"), { recursive: true });
      await fs.writeFile(
        path.join(stateDir, "kaijibot.json"),
        JSON.stringify({
          channels: {
            matrix: {
              homeserver: "https://matrix.example.org",
              userId: "@bot:example.org",
              accessToken: "tok-123",
            },
          },
        }),
      );
      await fs.writeFile(path.join(stateDir, "matrix", "bot-storage.json"), '{"next_batch":"s1"}');

      await loadAndMaybeMigrateDoctorConfig({
        options: { nonInteractive: true, repair: true },
        confirm: async () => false,
      });

      const snapshotDir = path.join(home, "Backups", "kaijibot-migrations");
      expect(
        await fs
          .access(snapshotDir)
          .then(() => true)
          .catch(() => false),
      ).toBe(false);
      expect(
        await fs
          .access(path.join(stateDir, "matrix", "migration-snapshot.json"))
          .then(() => true)
          .catch(() => false),
      ).toBe(false);
    });
  });

  it("does not warn when Matrix is installed from a stale custom path", async () => {
    const doctorWarnings = await collectDoctorWarnings({
      channels: {
        matrix: {
          homeserver: "https://matrix.example.org",
          accessToken: "tok-123",
        },
      },
      plugins: {
        installs: {
          matrix: {
            source: "path",
            sourcePath: "/tmp/kaijibot-matrix-missing",
            installPath: "/tmp/kaijibot-matrix-missing",
          },
        },
      },
    });

    expect(doctorWarnings.some((line) => line.includes("custom path"))).toBe(false);
  });

  it("does not warn when Matrix is installed from an existing custom path", async () => {
    await withTempHome(async (home) => {
      const pluginPath = path.join(home, "matrix-plugin");
      await fs.mkdir(pluginPath, { recursive: true });

      const doctorWarnings = await collectDoctorWarnings({
        channels: {
          matrix: {
            homeserver: "https://matrix.example.org",
            accessToken: "tok-123",
          },
        },
        plugins: {
          installs: {
            matrix: {
              source: "path",
              sourcePath: pluginPath,
              installPath: pluginPath,
            },
          },
        },
      });

      expect(
        doctorWarnings.some((line) => line.includes("Matrix is installed from a custom path")),
      ).toBe(false);
      expect(
        doctorWarnings.some((line) => line.includes("will not automatically replace that plugin")),
      ).toBe(false);
    });
  });

  it("notes legacy browser extension migration changes", async () => {
    const result = await runDoctorConfigWithInput({
      repair: true,
      config: {
        browser: {
          relayBindHost: "127.0.0.1",
          profiles: {
            chromeLive: {
              driver: "extension",
              color: "#00AA00",
            },
          },
        },
      },
      run: loadAndMaybeMigrateDoctorConfig,
    });

    const browser = (result.cfg as { browser?: Record<string, unknown> }).browser ?? {};
    expect(browser.relayBindHost).toBeUndefined();
    expect(
      ((browser.profiles as Record<string, { driver?: string }>)?.chromeLive ?? {}).driver,
    ).toBe("existing-session");
  });

  it("preserves discord streaming intent while stripping unsupported keys on repair", async () => {
    const result = await runDoctorConfigWithInput({
      repair: true,
      config: {
        channels: {
          discord: {
            streaming: true,
            lifecycle: {
              enabled: true,
              reactions: {
                queued: "⏳",
                thinking: "👾",
                tool: "🔧",
                done: "✅",
                error: "❌",
              },
            },
          },
        },
      },
      run: loadAndMaybeMigrateDoctorConfig,
    });

    const cfg = result.cfg as {
      channels: {
        discord: {
          streamMode?: string;
          streaming?: {
            mode?: string;
          };
          lifecycle?: unknown;
        };
      };
    };
    expect(cfg.channels.discord.streaming?.mode).toBe("partial");
    expect(cfg.channels.discord.streamMode).toBeUndefined();
    expect(cfg.channels.discord.lifecycle).toEqual({
      enabled: true,
      reactions: {
        queued: "⏳",
        thinking: "👾",
        tool: "🔧",
        done: "✅",
        error: "❌",
      },
    });
  });

  it("warns clearly about legacy channel streaming aliases and points to doctor --fix", async () => {
    const noteSpy = vi.spyOn(noteModule, "note").mockImplementation(() => {});
    try {
      await runDoctorConfigWithInput({
        config: {
          channels: {
            telegram: {
              streamMode: "block",
            },
            discord: {
              streaming: false,
            },
            googlechat: {
              streamMode: "append",
            },
            slack: {
              streaming: true,
            },
          },
        },
        run: loadAndMaybeMigrateDoctorConfig,
      });

      expect(
        noteSpy.mock.calls.some(
          ([message, title]) =>
            title === "Legacy config keys detected" &&
            String(message).includes("channels.telegram:") &&
            String(message).includes("channels.telegram.streamMode, channels.telegram.streaming"),
        ),
      ).toBe(true);
      expect(
        noteSpy.mock.calls.some(
          ([message, title]) =>
            title === "Legacy config keys detected" &&
            String(message).includes("channels.discord:") &&
            String(message).includes("channels.discord.streamMode, channels.discord.streaming"),
        ),
      ).toBe(true);
      expect(
        noteSpy.mock.calls.some(
          ([message, title]) =>
            title === "Legacy config keys detected" &&
            String(message).includes("channels.googlechat:") &&
            String(message).includes("channels.googlechat.streamMode is legacy and no longer used"),
        ),
      ).toBe(true);
      expect(
        noteSpy.mock.calls.some(
          ([message, title]) =>
            title === "Legacy config keys detected" &&
            String(message).includes("channels.slack:") &&
            String(message).includes("channels.slack.streamMode, channels.slack.streaming"),
        ),
      ).toBe(true);
    } finally {
      noteSpy.mockRestore();
    }
  });

  it("repairs legacy googlechat streamMode by removing it", async () => {
    const result = await runDoctorConfigWithInput({
      config: {
        channels: {
          googlechat: {
            streamMode: "append",
            accounts: {
              work: {
                streamMode: "replace",
              },
            },
          },
        },
      },
      run: loadAndMaybeMigrateDoctorConfig,
    });

    const cfg = result.cfg as {
      channels: {
        googlechat: {
          accounts?: {
            work?: Record<string, unknown>;
          };
        } & Record<string, unknown>;
      };
    };
    expect(cfg.channels.googlechat.streamMode).toBeUndefined();
    expect(cfg.channels.googlechat.accounts?.work?.streamMode).toBeUndefined();
  });

  it("warns clearly about legacy nested channel allow aliases and points to doctor --fix", async () => {
    const noteSpy = vi.spyOn(noteModule, "note").mockImplementation(() => {});
    try {
      await runDoctorConfigWithInput({
        config: {
          channels: {
            slack: {
              channels: {
                ops: {
                  allow: false,
                },
              },
            },
            googlechat: {
              groups: {
                "spaces/aaa": {
                  allow: false,
                },
              },
            },
            discord: {
              guilds: {
                "100": {
                  channels: {
                    general: {
                      allow: false,
                    },
                  },
                },
              },
            },
          },
        },
        run: loadAndMaybeMigrateDoctorConfig,
      });

      expect(
        noteSpy.mock.calls.some(
          ([message, title]) =>
            title === "Legacy config keys detected" &&
            String(message).includes("channels.slack:") &&
            String(message).includes("channels.slack.channels.<id>.allow is legacy"),
        ),
      ).toBe(true);
      expect(
        noteSpy.mock.calls.some(
          ([message, title]) =>
            title === "Legacy config keys detected" &&
            String(message).includes("channels.googlechat:") &&
            String(message).includes("channels.googlechat.groups.<id>.allow is legacy"),
        ),
      ).toBe(true);
      expect(
        noteSpy.mock.calls.some(
          ([message, title]) =>
            title === "Legacy config keys detected" &&
            String(message).includes("channels.discord:") &&
            String(message).includes("channels.discord.guilds.<id>.channels.<id>.allow is legacy"),
        ),
      ).toBe(true);
    } finally {
      noteSpy.mockRestore();
    }
  });

  it("repairs legacy nested channel allow aliases on repair", async () => {
    const result = await runDoctorConfigWithInput({
      repair: true,
      config: {
        channels: {
          slack: {
            channels: {
              ops: {
                allow: false,
              },
            },
          },
          googlechat: {
            groups: {
              "spaces/aaa": {
                allow: false,
              },
            },
          },
          discord: {
            guilds: {
              "100": {
                channels: {
                  general: {
                    allow: false,
                  },
                },
              },
            },
          },
        },
      },
      run: loadAndMaybeMigrateDoctorConfig,
    });

    expect(result.cfg.channels?.slack?.channels?.ops).toEqual({
      enabled: false,
    });
    expect(result.cfg.channels?.googlechat?.groups?.["spaces/aaa"]).toEqual({
      enabled: false,
    });
    expect(result.cfg.channels?.discord?.guilds?.["100"]?.channels?.general).toEqual({
      enabled: false,
    });
  });

  it("sanitizes config-derived doctor warnings and changes before logging", async () => {
    const noteSpy = vi.spyOn(noteModule, "note").mockImplementation(() => {});
    try {
      await runDoctorConfigWithInput({
        repair: true,
        config: {
          channels: {
            telegram: {
              accounts: {
                work: {
                  botToken: "tok",
                  allowFrom: ["@\u001b[31mtestuser"],
                },
              },
            },
            slack: {
              accounts: {
                work: {
                  allowFrom: ["alice\u001b[31m\nforged"],
                },
                "ops\u001b[31m\nopen": {
                  dmPolicy: "open",
                },
              },
            },
            whatsapp: {
              accounts: {
                "ops\u001b[31m\nempty": {
                  groupPolicy: "allowlist",
                },
              },
            },
          },
        },
        run: loadAndMaybeMigrateDoctorConfig,
      });

      const outputs = noteSpy.mock.calls
        .filter((call) => call[1] === "Doctor warnings" || call[1] === "Doctor changes")
        .map((call) => String(call[0]));
      const joinedOutputs = outputs.join("\n");
      expect(outputs.filter((line) => line.includes("\u001b"))).toEqual([]);
      expect(outputs.filter((line) => line.includes("\nforged"))).toEqual([]);
      expect(joinedOutputs).toContain('channels.slack.accounts.opsopen.allowFrom: set to ["*"]');
      expect(joinedOutputs).toContain('required by dmPolicy="open"');
      expect(
        outputs.some(
          (line) =>
            line.includes('channels.whatsapp.accounts.opsempty.groupPolicy is "allowlist"') &&
            line.includes("groupAllowFrom"),
        ),
      ).toBe(true);
    } finally {
      noteSpy.mockRestore();
    }
  });

  it("warns and continues when Telegram account inspection hits inactive SecretRef surfaces", async () => {
    const noteSpy = vi.spyOn(noteModule, "note").mockImplementation(() => {});
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    try {
      const result = await runDoctorConfigWithInput({
        repair: true,
        config: {
          secrets: {
            providers: {
              default: { source: "env" },
            },
          },
          channels: {
            telegram: {
              accounts: {
                inactive: {
                  enabled: false,
                  botToken: { source: "env", provider: "default", id: "TELEGRAM_BOT_TOKEN" },
                  allowFrom: ["@testuser"],
                },
              },
            },
          },
        },
        run: loadAndMaybeMigrateDoctorConfig,
      });

      const cfg = result.cfg as {
        channels?: {
          telegram?: {
            accounts?: Record<string, { allowFrom?: string[] }>;
          };
        };
      };
      expect(cfg.channels?.telegram?.accounts?.inactive?.allowFrom).toEqual(["@testuser"]);
      expect(fetchSpy).not.toHaveBeenCalled();
      // Telegram account inspection ships with the telegram plugin, which is
      // not bundled in this repo, so no inspection warnings are emitted.
      expect(
        noteSpy.mock.calls.some((call) =>
          String(call[0]).includes("Telegram account inactive: failed to inspect bot token"),
        ),
      ).toBe(false);
      expect(
        noteSpy.mock.calls.some((call) =>
          String(call[0]).includes(
            "Telegram allowFrom contains @username entries, but configured Telegram bot credentials are unavailable in this command path",
          ),
        ),
      ).toBe(false);
    } finally {
      noteSpy.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  // Discord id stringification shipped with the discord channel plugin, which
  // is not bundled in this repo; numeric ids pass through the repair as-is.
  it("keeps numeric discord ids as-is on repair", async () => {
    await withTempHome(async (home) => {
      const configDir = path.join(home, ".kaijibot");
      await fs.mkdir(configDir, { recursive: true });
      await fs.writeFile(
        path.join(configDir, "kaijibot.json"),
        JSON.stringify(
          {
            channels: {
              discord: {
                allowFrom: [123],
                dm: { allowFrom: [456], groupChannels: [789] },
                execApprovals: { approvers: [321] },
                guilds: {
                  "100": {
                    users: [111],
                    roles: [222],
                    channels: {
                      general: { users: [333], roles: [444] },
                    },
                  },
                },
                accounts: {
                  work: {
                    allowFrom: [555],
                    dm: { allowFrom: [666], groupChannels: [777] },
                    execApprovals: { approvers: [888] },
                    guilds: {
                      "200": {
                        users: [999],
                        roles: [1010],
                        channels: {
                          help: { users: [1111], roles: [1212] },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          null,
          2,
        ),
        "utf-8",
      );

      const result = await loadAndMaybeMigrateDoctorConfig({
        options: { nonInteractive: true, repair: true },
        confirm: async () => false,
      });

      const cfg = result.cfg as unknown as {
        channels: {
          discord: Omit<RepairedDiscordPolicy, "allowFrom"> & {
            allowFrom?: Array<string | number>;
            accounts: Record<string, DiscordAccountRule> & {
              default: { allowFrom: Array<string | number> };
              work: {
                allowFrom: Array<string | number>;
                dm: { allowFrom: Array<string | number>; groupChannels: Array<string | number> };
                execApprovals: { approvers: Array<string | number> };
                guilds: Record<string, DiscordGuildRule>;
              };
            };
          };
        };
      };

      expect(cfg.channels.discord.allowFrom).toBeUndefined();
      expect(cfg.channels.discord.dm.allowFrom).toEqual([456]);
      expect(cfg.channels.discord.dm.groupChannels).toEqual([789]);
      expect(cfg.channels.discord.execApprovals.approvers).toEqual([321]);
      expect(cfg.channels.discord.guilds["100"].users).toEqual([111]);
      expect(cfg.channels.discord.guilds["100"].roles).toEqual([222]);
      expect(cfg.channels.discord.guilds["100"].channels.general.users).toEqual([333]);
      expect(cfg.channels.discord.guilds["100"].channels.general.roles).toEqual([444]);
      expect(cfg.channels.discord.accounts.default.allowFrom).toEqual([123]);
      expect(cfg.channels.discord.accounts.work.allowFrom).toEqual([555]);
      expect(cfg.channels.discord.accounts.work.dm.allowFrom).toEqual([666]);
      expect(cfg.channels.discord.accounts.work.dm.groupChannels).toEqual([777]);
      expect(cfg.channels.discord.accounts.work.execApprovals.approvers).toEqual([888]);
      expect(cfg.channels.discord.accounts.work.guilds["200"].users).toEqual([999]);
      expect(cfg.channels.discord.accounts.work.guilds["200"].roles).toEqual([1010]);
      expect(cfg.channels.discord.accounts.work.guilds["200"].channels.help.users).toEqual([1111]);
      expect(cfg.channels.discord.accounts.work.guilds["200"].channels.help.roles).toEqual([1212]);
    });
  });

  it("does not restore top-level allowFrom when config is intentionally default-account scoped", async () => {
    const result = await runDoctorConfigWithInput({
      repair: true,
      config: {
        channels: {
          discord: {
            accounts: {
              default: { token: "discord-default-token", allowFrom: ["123"] },
              work: { token: "discord-work-token" },
            },
          },
        },
      },
      run: loadAndMaybeMigrateDoctorConfig,
    });

    const cfg = result.cfg as {
      channels: {
        discord: {
          allowFrom?: string[];
          accounts: Record<string, { allowFrom?: string[] }>;
        };
      };
    };

    expect(cfg.channels.discord.allowFrom).toBeUndefined();
    expect(cfg.channels.discord.accounts.default.allowFrom).toEqual(["123"]);
  });

  it('adds allowFrom ["*"] when dmPolicy="open" and allowFrom is missing on repair', async () => {
    const result = await runDoctorConfigWithInput({
      repair: true,
      config: {
        channels: {
          discord: {
            token: "test-token",
            dmPolicy: "open",
            groupPolicy: "open",
          },
        },
      },
      run: loadAndMaybeMigrateDoctorConfig,
    });

    const cfg = result.cfg as unknown as {
      channels: { discord: { allowFrom: string[]; dmPolicy: string } };
    };
    expect(cfg.channels.discord.allowFrom).toEqual(["*"]);
    expect(cfg.channels.discord.dmPolicy).toBe("open");
  });

  it("adds * to existing allowFrom array when dmPolicy is open on repair", async () => {
    const result = await runDoctorConfigWithInput({
      repair: true,
      config: {
        channels: {
          slack: {
            botToken: "xoxb-test",
            appToken: "xapp-test",
            dmPolicy: "open",
            allowFrom: ["U123"],
          },
        },
      },
      run: loadAndMaybeMigrateDoctorConfig,
    });

    const cfg = result.cfg as unknown as {
      channels: { slack: { allowFrom: string[] } };
    };
    expect(cfg.channels.slack.allowFrom).toContain("*");
    expect(cfg.channels.slack.allowFrom).toContain("U123");
  });

  it("repairs nested dm.allowFrom when top-level allowFrom is absent on repair", async () => {
    const result = await runDoctorConfigWithInput({
      repair: true,
      config: {
        channels: {
          discord: {
            token: "test-token",
            dmPolicy: "open",
            dm: { allowFrom: ["123"] },
          },
        },
      },
      run: loadAndMaybeMigrateDoctorConfig,
    });

    const cfg = result.cfg as unknown as {
      channels: { discord: { dm: { allowFrom: string[] }; allowFrom?: string[] } };
    };
    // The wildcard lands on the top-level allowFrom (topOnly mode); the nested
    // dm.allowFrom list is preserved as-is.
    expect(cfg.channels.discord.allowFrom).toEqual(["*"]);
    expect(cfg.channels.discord.dm.allowFrom).toEqual(["123"]);
  });

  it("skips repair when allowFrom already includes *", async () => {
    const result = await runDoctorConfigWithInput({
      repair: true,
      config: {
        channels: {
          discord: {
            token: "test-token",
            dmPolicy: "open",
            allowFrom: ["*"],
          },
        },
      },
      run: loadAndMaybeMigrateDoctorConfig,
    });

    const cfg = result.cfg as unknown as {
      channels: { discord: { allowFrom: string[] } };
    };
    expect(cfg.channels.discord.allowFrom).toEqual(["*"]);
  });

  it("repairs per-account dmPolicy open without allowFrom on repair", async () => {
    const result = await runDoctorConfigWithInput({
      repair: true,
      config: {
        channels: {
          discord: {
            token: "test-token",
            accounts: {
              work: {
                token: "test-token-2",
                dmPolicy: "open",
              },
            },
          },
        },
      },
      run: loadAndMaybeMigrateDoctorConfig,
    });

    const cfg = result.cfg as unknown as {
      channels: {
        discord: { accounts: { work: { allowFrom: string[]; dmPolicy: string } } };
      };
    };
    expect(cfg.channels.discord.accounts.work.allowFrom).toEqual(["*"]);
  });

  it('repairs dmPolicy="allowlist" by restoring allowFrom from pairing store on repair', async () => {
    const result = await withTempHome(async (home) => {
      const configDir = path.join(home, ".kaijibot");
      const credentialsDir = path.join(configDir, "credentials");
      await fs.mkdir(credentialsDir, { recursive: true });
      await fs.writeFile(
        path.join(configDir, "kaijibot.json"),
        JSON.stringify(
          {
            channels: {
              telegram: {
                botToken: "fake-token",
                dmPolicy: "allowlist",
              },
            },
          },
          null,
          2,
        ),
        "utf-8",
      );
      await fs.writeFile(
        path.join(credentialsDir, "telegram-allowFrom.json"),
        JSON.stringify({ version: 1, allowFrom: ["12345"] }, null, 2),
        "utf-8",
      );
      return await loadAndMaybeMigrateDoctorConfig({
        options: { nonInteractive: true, repair: true },
        confirm: async () => false,
      });
    });

    const cfg = result.cfg as {
      channels: {
        telegram: {
          dmPolicy: string;
          allowFrom: string[];
        };
      };
    };
    expect(cfg.channels.telegram.dmPolicy).toBe("allowlist");
    expect(cfg.channels.telegram.allowFrom).toEqual(["12345"]);
  });

  it("migrates legacy toolsBySender keys to typed id entries on repair", async () => {
    const result = await runDoctorConfigWithInput({
      repair: true,
      config: {
        channels: {
          whatsapp: {
            groups: {
              "123@g.us": {
                toolsBySender: {
                  owner: { allow: ["exec"] },
                  alice: { deny: ["exec"] },
                  "id:owner": { deny: ["exec"] },
                  "username:@ops-bot": { allow: ["fs.read"] },
                  "*": { deny: ["exec"] },
                },
              },
            },
          },
        },
      },
      run: loadAndMaybeMigrateDoctorConfig,
    });

    const cfg = result.cfg as unknown as {
      channels: {
        whatsapp: {
          groups: {
            "123@g.us": {
              toolsBySender: Record<string, { allow?: string[]; deny?: string[] }>;
            };
          };
        };
      };
    };
    const toolsBySender = cfg.channels.whatsapp.groups["123@g.us"].toolsBySender;
    expect(toolsBySender.owner).toBeUndefined();
    expect(toolsBySender.alice).toBeUndefined();
    expect(toolsBySender["id:owner"]).toEqual({ deny: ["exec"] });
    expect(toolsBySender["id:alice"]).toEqual({ deny: ["exec"] });
    expect(toolsBySender["username:@ops-bot"]).toEqual({ allow: ["fs.read"] });
    expect(toolsBySender["*"]).toEqual({ deny: ["exec"] });
  });

  it("repairs googlechat dm.policy open by setting dm.allowFrom on repair", async () => {
    const result = await runDoctorConfigWithInput({
      repair: true,
      config: {
        channels: {
          googlechat: {
            dm: {
              policy: "open",
            },
          },
        },
      },
      run: loadAndMaybeMigrateDoctorConfig,
    });

    expectGoogleChatDmAllowFromRepaired(result.cfg);
  });

  it("migrates top-level heartbeat into agents.defaults.heartbeat on repair", async () => {
    const result = await runDoctorConfigWithInput({
      repair: true,
      config: {
        heartbeat: {
          model: "anthropic/claude-3-5-haiku-20241022",
          every: "30m",
        },
      },
      run: loadAndMaybeMigrateDoctorConfig,
    });

    const cfg = result.cfg as {
      heartbeat?: unknown;
      agents?: {
        defaults?: {
          heartbeat?: {
            model?: string;
            every?: string;
          };
        };
      };
    };
    expect(cfg.heartbeat).toBeUndefined();
    expect(cfg.agents?.defaults?.heartbeat).toMatchObject({
      model: "anthropic/claude-3-5-haiku-20241022",
      every: "30m",
    });
  });

  it("warns clearly about legacy config keys and points to doctor --fix", async () => {
    const noteSpy = vi.spyOn(noteModule, "note").mockImplementation(() => {});
    try {
      await runDoctorConfigWithInput({
        config: {
          heartbeat: {
            model: "anthropic/claude-3-5-haiku-20241022",
            every: "30m",
          },
        },
        run: loadAndMaybeMigrateDoctorConfig,
      });

      expect(
        noteSpy.mock.calls.some(
          ([message, title]) =>
            title === "Legacy config keys detected" &&
            String(message).includes("heartbeat:") &&
            String(message).includes("agents.defaults.heartbeat"),
        ),
      ).toBe(true);
    } finally {
      noteSpy.mockRestore();
    }
  });

  it("warns clearly about legacy heartbeat visibility config and points to doctor --fix", async () => {
    const noteSpy = vi.spyOn(noteModule, "note").mockImplementation(() => {});
    try {
      await runDoctorConfigWithInput({
        config: {
          heartbeat: {
            showOk: true,
            showAlerts: false,
          },
        },
        run: loadAndMaybeMigrateDoctorConfig,
      });

      expect(
        noteSpy.mock.calls.some(
          ([message, title]) =>
            title === "Legacy config keys detected" &&
            String(message).includes("heartbeat:") &&
            String(message).includes("channels.defaults.heartbeat"),
        ),
      ).toBe(true);
    } finally {
      noteSpy.mockRestore();
    }
  });

  it("warns clearly about legacy memorySearch config and points to doctor --fix", async () => {
    const noteSpy = vi.spyOn(noteModule, "note").mockImplementation(() => {});
    try {
      await runDoctorConfigWithInput({
        config: {
          memorySearch: {
            provider: "local",
            fallback: "none",
          },
        },
        run: loadAndMaybeMigrateDoctorConfig,
      });

      expect(
        noteSpy.mock.calls.some(
          ([message, title]) =>
            title === "Legacy config keys detected" &&
            String(message).includes("memorySearch:") &&
            String(message).includes("agents.defaults.memorySearch"),
        ),
      ).toBe(true);
    } finally {
      noteSpy.mockRestore();
    }
  });

  it("repairs legacy gateway.bind host aliases on repair", async () => {
    const result = await runDoctorConfigWithInput({
      repair: true,
      config: {
        gateway: {
          bind: "0.0.0.0",
        },
      },
      run: loadAndMaybeMigrateDoctorConfig,
    });

    const cfg = result.cfg as {
      gateway?: {
        bind?: string;
      };
    };
    expect(cfg.gateway?.bind).toBe("lan");
  });

  it("warns clearly about legacy gateway.bind host aliases and points to doctor --fix", async () => {
    const noteSpy = vi.spyOn(noteModule, "note").mockImplementation(() => {});
    try {
      await runDoctorConfigWithInput({
        config: {
          gateway: {
            bind: "localhost",
          },
        },
        run: loadAndMaybeMigrateDoctorConfig,
      });

      expect(
        noteSpy.mock.calls.some(
          ([message, title]) =>
            title === "Legacy config keys detected" &&
            String(message).includes("gateway.bind:") &&
            String(message).includes("gateway.bind host aliases"),
        ),
      ).toBe(true);
      expect(
        noteSpy.mock.calls.some(
          ([message, title]) =>
            title === "Doctor" &&
            String(message).includes('Run "kaijibot doctor --fix" to migrate legacy config keys.'),
        ),
      ).toBe(true);
    } finally {
      noteSpy.mockRestore();
    }
  });

  // The groupMentionsOnly legacy rule shipped with the telegram channel
  // plugin, which is not bundled in this repo; the key is no longer flagged.
  it("does not warn about legacy telegram groupMentionsOnly config without a bundled telegram plugin", async () => {
    const noteSpy = vi.spyOn(noteModule, "note").mockImplementation(() => {});
    try {
      await runDoctorConfigWithInput({
        config: {
          channels: {
            telegram: {
              groupMentionsOnly: true,
            },
          },
        },
        run: loadAndMaybeMigrateDoctorConfig,
      });

      expect(
        noteSpy.mock.calls.some(
          ([message, title]) =>
            title === "Legacy config keys detected" &&
            String(message).includes("channels.telegram.groupMentionsOnly:"),
        ),
      ).toBe(false);
    } finally {
      noteSpy.mockRestore();
    }
  });

  it("warns clearly about legacy x_search auth config and points to doctor --fix", async () => {
    const noteSpy = vi.spyOn(noteModule, "note").mockImplementation(() => {});
    try {
      await runDoctorConfigWithInput({
        config: {
          tools: {
            web: {
              x_search: {
                apiKey: "test-key",
              },
            },
          },
        },
        run: loadAndMaybeMigrateDoctorConfig,
      });

      expect(
        noteSpy.mock.calls.some(
          ([message, title]) =>
            title === "Legacy config keys detected" &&
            String(message).includes("tools.web.x_search.apiKey:") &&
            String(message).includes("plugins.entries.xai.config.webSearch.apiKey"),
        ),
      ).toBe(true);
      expect(
        noteSpy.mock.calls.some(
          ([message, title]) =>
            title === "Doctor" &&
            String(message).includes('Run "kaijibot doctor --fix" to migrate legacy config keys.'),
        ),
      ).toBe(true);
    } finally {
      noteSpy.mockRestore();
    }
  });

  it("warns clearly about legacy hooks.internal.handlers and requires manual migration", async () => {
    const noteSpy = vi.spyOn(noteModule, "note").mockImplementation(() => {});
    try {
      await runDoctorConfigWithInput({
        config: {
          hooks: {
            internal: {
              handlers: [{ event: "command:new", module: "hooks/legacy-handler.js" }],
            },
          },
        },
        run: loadAndMaybeMigrateDoctorConfig,
      });

      expect(
        noteSpy.mock.calls.some(
          ([message, title]) =>
            title === "Legacy config keys detected" &&
            String(message).includes("hooks.internal.handlers:") &&
            String(message).includes("HOOK.md + handler.js"),
        ),
      ).toBe(true);
      expect(
        noteSpy.mock.calls.some(
          ([message, title]) =>
            title === "Legacy config keys detected" &&
            String(message).includes("does not rewrite this shape automatically"),
        ),
      ).toBe(true);
    } finally {
      noteSpy.mockRestore();
    }
  });

  it("warns clearly about legacy thread binding ttlHours config and points to doctor --fix", async () => {
    const noteSpy = vi.spyOn(noteModule, "note").mockImplementation(() => {});
    try {
      await runDoctorConfigWithInput({
        config: {
          session: {
            threadBindings: {
              ttlHours: 24,
            },
          },
          channels: {
            discord: {
              threadBindings: {
                ttlHours: 12,
              },
              accounts: {
                alpha: {
                  threadBindings: {
                    ttlHours: 6,
                  },
                },
              },
            },
          },
        },
        run: loadAndMaybeMigrateDoctorConfig,
      });

      const legacyMessages = noteSpy.mock.calls
        .filter(([, title]) => title === "Legacy config keys detected")
        .map(([message]) => String(message))
        .join("\n");

      expect(legacyMessages).toContain("session.threadBindings.ttlHours");
      expect(legacyMessages).toContain("session.threadBindings.idleHours");
      expect(legacyMessages).toContain("channels.<id>.threadBindings.ttlHours");
      expect(legacyMessages).toContain("channels.<id>.threadBindings.idleHours");
      expect(
        noteSpy.mock.calls.some(
          ([message, title]) =>
            title === "Doctor" &&
            String(message).includes('Run "kaijibot doctor --fix" to migrate legacy config keys.'),
        ),
      ).toBe(true);
    } finally {
      noteSpy.mockRestore();
    }
  });

  it("repairs legacy thread binding ttlHours config on repair", async () => {
    const result = await runDoctorConfigWithInput({
      repair: true,
      config: {
        session: {
          threadBindings: {
            ttlHours: 24,
          },
        },
        channels: {
          discord: {
            threadBindings: {
              ttlHours: 12,
            },
            accounts: {
              alpha: {
                threadBindings: {
                  ttlHours: 6,
                },
              },
            },
          },
        },
      },
      run: loadAndMaybeMigrateDoctorConfig,
    });

    const cfg = result.cfg as {
      session?: {
        threadBindings?: {
          idleHours?: number;
          ttlHours?: number;
        };
      };
      channels?: {
        discord?: {
          threadBindings?: {
            idleHours?: number;
            ttlHours?: number;
          };
          accounts?: Record<
            string,
            {
              threadBindings?: {
                idleHours?: number;
                ttlHours?: number;
              };
            }
          >;
        };
      };
    };
    expect(cfg.session?.threadBindings).toMatchObject({
      idleHours: 24,
    });
    expect(cfg.channels?.discord?.threadBindings).toMatchObject({
      idleHours: 12,
    });
    expect(cfg.channels?.discord?.accounts?.alpha?.threadBindings).toMatchObject({
      idleHours: 6,
    });
    expect(cfg.session?.threadBindings?.ttlHours).toBeUndefined();
    expect(cfg.channels?.discord?.threadBindings?.ttlHours).toBeUndefined();
    expect(cfg.channels?.discord?.accounts?.alpha?.threadBindings?.ttlHours).toBeUndefined();
  });

  // The talk flat-field legacy rule was removed; the fields are merged into
  // talk.providers by the compatibility normalizer without a legacy warning.
  it("does not warn about legacy talk config without a legacy rule", async () => {
    const noteSpy = vi.spyOn(noteModule, "note").mockImplementation(() => {});
    try {
      await runDoctorConfigWithInput({
        config: {
          talk: {
            voiceId: "voice-1",
            modelId: "eleven_v3",
          },
        },
        run: loadAndMaybeMigrateDoctorConfig,
      });

      expect(
        noteSpy.mock.calls.some(
          ([message, title]) =>
            title === "Legacy config keys detected" && String(message).includes("talk:"),
        ),
      ).toBe(false);
    } finally {
      noteSpy.mockRestore();
    }
  });

  it("warns clearly about legacy sandbox perSession config and points to doctor --fix", async () => {
    const noteSpy = vi.spyOn(noteModule, "note").mockImplementation(() => {});
    try {
      await runDoctorConfigWithInput({
        config: {
          agents: {
            defaults: {
              sandbox: {
                perSession: true,
              },
            },
          },
        },
        run: loadAndMaybeMigrateDoctorConfig,
      });

      expect(
        noteSpy.mock.calls.some(
          ([message, title]) =>
            title === "Legacy config keys detected" &&
            String(message).includes("agents.defaults.sandbox:") &&
            String(message).includes("agents.defaults.sandbox.perSession is legacy"),
        ),
      ).toBe(true);
      expect(
        noteSpy.mock.calls.some(
          ([message, title]) =>
            title === "Doctor" &&
            String(message).includes('Run "kaijibot doctor --fix" to migrate legacy config keys.'),
        ),
      ).toBe(true);
    } finally {
      noteSpy.mockRestore();
    }
  });

  it("migrates top-level heartbeat visibility into channels.defaults.heartbeat on repair", async () => {
    const result = await runDoctorConfigWithInput({
      repair: true,
      config: {
        heartbeat: {
          showOk: true,
          showAlerts: false,
        },
      },
      run: loadAndMaybeMigrateDoctorConfig,
    });

    const cfg = result.cfg as {
      heartbeat?: unknown;
      channels?: {
        defaults?: {
          heartbeat?: {
            showOk?: boolean;
            showAlerts?: boolean;
            useIndicator?: boolean;
          };
        };
      };
    };
    expect(cfg.heartbeat).toBeUndefined();
    expect(cfg.channels?.defaults?.heartbeat).toMatchObject({
      showOk: true,
      showAlerts: false,
    });
  });

  it("repairs googlechat account dm.policy open by setting top-level allowFrom on repair", async () => {
    const result = await runDoctorConfigWithInput({
      repair: true,
      config: {
        channels: {
          googlechat: {
            accounts: {
              work: {
                dm: {
                  policy: "open",
                },
              },
            },
          },
        },
      },
      run: loadAndMaybeMigrateDoctorConfig,
    });

    const cfg = result.cfg as unknown as {
      channels: {
        googlechat: {
          accounts: {
            work: {
              dmPolicy?: string;
              allowFrom?: string[];
              dm?: { policy?: string; allowFrom?: string[] };
            };
          };
        };
      };
    };

    expect(cfg.channels.googlechat.accounts.work.dmPolicy).toBe("open");
    expect(cfg.channels.googlechat.accounts.work.allowFrom).toEqual(["*"]);
    expect(cfg.channels.googlechat.accounts.work.dm).toBeUndefined();
  });

  it("recovers from stale googlechat top-level allowFrom by canonicalizing dm policy", async () => {
    const result = await runDoctorConfigWithInput({
      repair: true,
      config: {
        channels: {
          googlechat: {
            allowFrom: ["*"],
            dm: {
              policy: "open",
            },
          },
        },
      },
      run: loadAndMaybeMigrateDoctorConfig,
    });
    const cfg = result.cfg as {
      channels: {
        googlechat: {
          dmPolicy?: string;
          allowFrom?: string[];
          dm?: { policy?: string };
        };
      };
    };
    expect(cfg.channels.googlechat.dmPolicy).toBe("open");
    expect(cfg.channels.googlechat.allowFrom).toEqual(["*"]);
    expect(cfg.channels.googlechat.dm).toBeUndefined();
  });

  it("does not report repeat talk provider normalization on consecutive repair runs", async () => {
    await withTempHome(async (home) => {
      const providerId = "acme-speech";
      const configDir = path.join(home, ".kaijibot");
      await fs.mkdir(configDir, { recursive: true });
      await fs.writeFile(
        path.join(configDir, "kaijibot.json"),
        JSON.stringify(
          {
            talk: {
              interruptOnSpeech: true,
              silenceTimeoutMs: 1500,
              provider: providerId,
              providers: {
                [providerId]: {
                  apiKey: "secret-key",
                  voiceId: "voice-123",
                  modelId: "eleven_v3",
                },
              },
            },
          },
          null,
          2,
        ),
        "utf-8",
      );

      const noteSpy = vi.spyOn(noteModule, "note").mockImplementation(() => {});
      try {
        await loadAndMaybeMigrateDoctorConfig({
          options: { nonInteractive: true, repair: true },
          confirm: async () => false,
        });
        noteSpy.mockClear();

        await loadAndMaybeMigrateDoctorConfig({
          options: { nonInteractive: true, repair: true },
          confirm: async () => false,
        });
        const secondRunTalkNormalizationLines = noteSpy.mock.calls
          .filter((call) => call[1] === "Doctor changes")
          .map((call) => String(call[0]))
          .filter((line) => line.includes("Normalized talk.provider/providers shape"));
        expect(secondRunTalkNormalizationLines).toEqual([]);
      } finally {
        noteSpy.mockRestore();
      }
    });
  });
});
