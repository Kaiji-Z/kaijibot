import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const { loadConfig, readConfigFileSnapshot, validateConfigObject } =
  await vi.importActual<typeof import("./config.js")>("./config.js");
import { withTempHome } from "./test-helpers.js";

async function expectLoadRejectionPreservesField(params: {
  config: unknown;
  readValue: (parsed: unknown) => unknown;
  expectedValue: unknown;
}) {
  await withTempHome(async (home) => {
    const configPath = path.join(home, ".kaijibot", "kaijibot.json");
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, JSON.stringify(params.config, null, 2), "utf-8");

    const snap = await readConfigFileSnapshot();

    expect(snap.valid).toBe(false);
    expect(snap.issues.length).toBeGreaterThan(0);

    const parsed = JSON.parse(await fs.readFile(configPath, "utf-8")) as unknown;
    expect(params.readValue(parsed)).toBe(params.expectedValue);
  });
}

type ConfigSnapshot = Awaited<ReturnType<typeof readConfigFileSnapshot>>;

async function withSnapshotForConfig(
  config: unknown,
  run: (params: { snapshot: ConfigSnapshot; parsed: unknown; configPath: string }) => Promise<void>,
) {
  await withTempHome(async (home) => {
    const configPath = path.join(home, ".kaijibot", "kaijibot.json");
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    await fs.writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");
    const snapshot = await readConfigFileSnapshot();
    const parsed = JSON.parse(await fs.readFile(configPath, "utf-8")) as unknown;
    await run({ snapshot, parsed, configPath });
  });
}

function expectValidConfigValue(params: {
  config: unknown;
  readValue: (config: unknown) => unknown;
  expectedValue: unknown;
}) {
  const res = validateConfigObject(params.config);
  expect(res.ok).toBe(true);
  if (!res.ok) {
    throw new Error("expected config to be valid");
  }
  expect(params.readValue(res.config)).toBe(params.expectedValue);
}

function expectSnapshotInvalidRootKey(
  ctx: { snapshot: ConfigSnapshot; parsed: unknown },
  key: string,
) {
  expect(ctx.snapshot.valid).toBe(false);
  expect(ctx.snapshot.legacyIssues).toEqual([]);
  expect(ctx.snapshot.issues[0]?.path).toBe("");
  expect(ctx.snapshot.issues[0]?.message).toContain(`"${key}"`);
  expect((ctx.parsed as Record<string, unknown>)[key]).toBeTruthy();
}

describe("legacy config detection", () => {
  it("accepts tools audio transcription without cli", async () => {
    const res = validateConfigObject({
      audio: { transcription: { command: ["whisper", "--model", "base"] } },
    });
    expect(res.ok).toBe(true);
  });
  it("rejects legacy agent.model string", async () => {
    const res = validateConfigObject({
      agent: { model: "anthropic/claude-opus-4-6" },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.issues[0]?.path).toBe("");
      expect(res.issues[0]?.message).toContain('"agent"');
    }
  });
  it("rejects removed legacy provider sections in snapshot", async () => {
    await withSnapshotForConfig({ whatsapp: { allowFrom: ["+1555"] } }, async (ctx) => {
      expectSnapshotInvalidRootKey(ctx, "whatsapp");
    });
  });
  it("does not auto-migrate claude-cli auth profile mode on load", async () => {
    await withTempHome(async (home) => {
      const configPath = path.join(home, ".kaijibot", "kaijibot.json");
      await fs.mkdir(path.dirname(configPath), { recursive: true });
      await fs.writeFile(
        configPath,
        JSON.stringify(
          {
            auth: {
              profiles: {
                "anthropic:claude-cli": { provider: "anthropic", mode: "token" },
              },
            },
          },
          null,
          2,
        ),
        "utf-8",
      );

      const cfg = loadConfig();
      expect(cfg.auth?.profiles?.["anthropic:claude-cli"]?.mode).toBe("token");

      const raw = await fs.readFile(configPath, "utf-8");
      const parsed = JSON.parse(raw) as {
        auth?: { profiles?: Record<string, { mode?: string }> };
      };
      expect(parsed.auth?.profiles?.["anthropic:claude-cli"]?.mode).toBe("token");
    });
  });
  it("rejects bindings[].match.provider on load", async () => {
    await expectLoadRejectionPreservesField({
      config: {
        bindings: [{ agentId: "main", match: { provider: "slack" } }],
      },
      readValue: (parsed) =>
        (parsed as { bindings?: Array<{ match?: { provider?: string } }> }).bindings?.[0]?.match
          ?.provider,
      expectedValue: "slack",
    });
  });
  it("rejects bindings[].match.accountID on load", async () => {
    await expectLoadRejectionPreservesField({
      config: {
        bindings: [{ agentId: "main", match: { channel: "telegram", accountID: "work" } }],
      },
      readValue: (parsed) =>
        (parsed as { bindings?: Array<{ match?: { accountID?: string } }> }).bindings?.[0]?.match
          ?.accountID,
      expectedValue: "work",
    });
  });
  it("accepts bindings[].comment on load", () => {
    expectValidConfigValue({
      config: {
        bindings: [{ agentId: "main", comment: "primary route", match: { channel: "telegram" } }],
      },
      readValue: (config) =>
        (config as { bindings?: Array<{ comment?: string }> }).bindings?.[0]?.comment,
      expectedValue: "primary route",
    });
  });
  it("rejects session.sendPolicy.rules[].match.provider on load", async () => {
    await withSnapshotForConfig(
      {
        session: {
          sendPolicy: {
            rules: [{ action: "deny", match: { provider: "telegram" } }],
          },
        },
      },
      async (ctx) => {
        expect(ctx.snapshot.valid).toBe(false);
        expect(ctx.snapshot.issues.length).toBeGreaterThan(0);
        const parsed = ctx.parsed as {
          session?: { sendPolicy?: { rules?: Array<{ match?: { provider?: string } }> } };
        };
        expect(parsed.session?.sendPolicy?.rules?.[0]?.match?.provider).toBe("telegram");
      },
    );
  });
  it("rejects messages.queue.byProvider on load", async () => {
    await withSnapshotForConfig(
      { messages: { queue: { byProvider: { whatsapp: "queue" } } } },
      async (ctx) => {
        expect(ctx.snapshot.valid).toBe(false);
        expect(ctx.snapshot.issues.length).toBeGreaterThan(0);

        const parsed = ctx.parsed as {
          messages?: {
            queue?: {
              byProvider?: Record<string, unknown>;
            };
          };
        };
        expect(parsed.messages?.queue?.byProvider?.whatsapp).toBe("queue");
      },
    );
  });
});
