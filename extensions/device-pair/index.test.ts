import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  KaijiBotPluginCommandDefinition,
  PluginCommandContext,
} from "kaijibot/plugin-sdk/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestPluginApi } from "../../test/helpers/plugins/plugin-api.js";
import type { KaijiBotPluginApi } from "./api.js";
import type { PendingPairingRequest } from "./notify.ts";

const pluginApiMocks = vi.hoisted(() => ({
  clearDeviceBootstrapTokens: vi.fn(async () => ({ removed: 2 })),
  issueDeviceBootstrapToken: vi.fn(async () => ({
    token: "boot-token",
    expiresAtMs: Date.now() + 10 * 60_000,
  })),
  revokeDeviceBootstrapToken: vi.fn(async () => ({ removed: true })),
  renderQrPngBase64: vi.fn(async () => "ZmFrZXBuZw=="),
  resolveGatewayPort: vi.fn(() => 18789),
  resolvePreferredKaijiBotTmpDir: vi.fn(() => path.join(os.tmpdir(), "kaijibot-device-pair-tests")),
}));

vi.mock("./api.js", () => {
  return {
    PAIRING_SETUP_BOOTSTRAP_PROFILE: {
      roles: ["node"],
      scopes: [],
    },
    approveDevicePairing: vi.fn(),
    clearDeviceBootstrapTokens: pluginApiMocks.clearDeviceBootstrapTokens,
    definePluginEntry: vi.fn((entry) => entry),
    issueDeviceBootstrapToken: pluginApiMocks.issueDeviceBootstrapToken,
    listDevicePairing: vi.fn(async () => ({ pending: [] })),
    renderQrPngBase64: pluginApiMocks.renderQrPngBase64,
    revokeDeviceBootstrapToken: pluginApiMocks.revokeDeviceBootstrapToken,
    resolvePreferredKaijiBotTmpDir: pluginApiMocks.resolvePreferredKaijiBotTmpDir,
    resolveGatewayBindUrl: vi.fn(),
    resolveGatewayPort: pluginApiMocks.resolveGatewayPort,
    resolveTailnetHostWithRunner: vi.fn(),
    runPluginCommandWithTimeout: vi.fn(),
  };
});

vi.mock("./notify.js", () => ({
  armPairNotifyOnce: vi.fn(async () => false),
  formatPendingRequests: vi.fn(() => "No pending device pairing requests."),
  handleNotifyCommand: vi.fn(async () => ({ text: "notify" })),
  registerPairingNotifierService: vi.fn(),
}));

import { approveDevicePairing, listDevicePairing } from "./api.js";
import registerDevicePair from "./index.js";

type ListedPendingPairingRequest = Awaited<ReturnType<typeof listDevicePairing>>["pending"][number];
type ApproveDevicePairingResolved = Awaited<ReturnType<typeof approveDevicePairing>>;
type ApprovedPairingResult = Extract<
  NonNullable<ApproveDevicePairingResolved>,
  { status: "approved" }
>;
type ApprovedPairingDevice = ApprovedPairingResult["device"];

function createApi(params?: {
  runtime?: KaijiBotPluginApi["runtime"];
  pluginConfig?: Record<string, unknown>;
  registerCommand?: (command: KaijiBotPluginCommandDefinition) => void;
}): KaijiBotPluginApi {
  return createTestPluginApi({
    id: "device-pair",
    name: "device-pair",
    source: "test",
    config: {
      gateway: {
        auth: {
          mode: "token",
          token: "gateway-token",
        },
      },
    },
    pluginConfig: {
      publicUrl: "ws://51.79.175.165:18789",
      ...params?.pluginConfig,
    },
    runtime: (params?.runtime ?? {}) as KaijiBotPluginApi["runtime"],
    registerCommand: params?.registerCommand,
  });
}

function registerPairCommand(params?: {
  runtime?: KaijiBotPluginApi["runtime"];
  pluginConfig?: Record<string, unknown>;
}): KaijiBotPluginCommandDefinition {
  let command: KaijiBotPluginCommandDefinition | undefined;
  registerDevicePair.register(
    createApi({
      ...params,
      registerCommand: (nextCommand) => {
        command = nextCommand;
      },
    }),
  );
  if (!command) {
    throw new Error("device-pair plugin did not register its /pair command");
  }
  return command;
}

function requireText(result: { text?: unknown } | null | undefined): string {
  if (typeof result?.text !== "string") {
    throw new Error("pair command did not return a text response");
  }
  return result.text;
}

function createChannelRuntime(
  runtimeKey: string,
  sendKey: string,
  sendMessage: (...args: unknown[]) => Promise<unknown>,
): KaijiBotPluginApi["runtime"] {
  return {
    channel: {
      outbound: {
        loadAdapter: async (channelId: string) =>
          channelId === runtimeKey
            ? ({
                sendText: async ({ to, text, ...opts }: Record<string, unknown>) =>
                  await sendMessage(to, text, opts),
                sendMedia: async ({ to, text, ...opts }: Record<string, unknown>) =>
                  await sendMessage(to, text, opts),
              } as const)
            : undefined,
      },
    },
  } as unknown as KaijiBotPluginApi["runtime"];
}

function createCommandContext(params?: Partial<PluginCommandContext>): PluginCommandContext {
  return {
    channel: "webchat",
    isAuthorizedSender: true,
    commandBody: "/pair qr",
    args: "qr",
    config: {},
    requestConversationBinding: async () => ({
      status: "error",
      message: "unsupported",
    }),
    detachConversationBinding: async () => ({ removed: false }),
    getCurrentConversationBinding: async () => null,
    ...params,
  };
}

function makePendingPairingRequest(
  overrides: Partial<ListedPendingPairingRequest> = {},
): ListedPendingPairingRequest {
  return {
    requestId: "req-1",
    deviceId: "victim-phone",
    publicKey: "victim-public-key",
    displayName: "Victim Phone",
    platform: "ios",
    ts: Date.now(),
    ...overrides,
  };
}

function makeApprovedPairingDevice(
  overrides: Partial<ApprovedPairingDevice> = {},
): ApprovedPairingDevice {
  return {
    deviceId: "victim-phone",
    publicKey: "victim-public-key",
    displayName: "Victim Phone",
    platform: "ios",
    role: "operator",
    roles: ["operator"],
    scopes: ["operator.pairing"],
    approvedScopes: ["operator.pairing"],
    tokens: {
      operator: {
        token: "token-1",
        role: "operator",
        scopes: ["operator.pairing"],
        createdAtMs: Date.now(),
      },
    },
    createdAtMs: Date.now(),
    approvedAtMs: Date.now(),
    ...overrides,
  };
}

function makeApprovedPairingResult(
  overrides: Omit<Partial<ApprovedPairingResult>, "device"> & {
    device?: Partial<ApprovedPairingDevice>;
  } = {},
): ApprovedPairingResult {
  const { device, ...resultOverrides } = overrides;
  return {
    status: "approved",
    requestId: "req-1",
    device: makeApprovedPairingDevice(device),
    ...resultOverrides,
  };
}

describe("device-pair /pair qr", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    pluginApiMocks.issueDeviceBootstrapToken.mockResolvedValue({
      token: "boot-token",
      expiresAtMs: Date.now() + 10 * 60_000,
    });
    await fs.mkdir(pluginApiMocks.resolvePreferredKaijiBotTmpDir(), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(pluginApiMocks.resolvePreferredKaijiBotTmpDir(), { recursive: true, force: true });
  });

  it("returns an inline QR image for webchat surfaces", async () => {
    const command = registerPairCommand();
    const result = await command.handler(
      createCommandContext({
        channel: "webchat",
        gatewayClientScopes: ["operator.write", "operator.pairing"],
      }),
    );
    const text = requireText(result);

    expect(pluginApiMocks.renderQrPngBase64).toHaveBeenCalledTimes(1);
    expect(pluginApiMocks.issueDeviceBootstrapToken).toHaveBeenCalledWith({
      profile: {
        roles: ["node"],
        scopes: [],
      },
    });
    expect(text).toContain("Scan this QR code with the KaijiBot iOS app:");
    expect(text).toContain("![KaijiBot pairing QR](data:image/png;base64,ZmFrZXBuZw==)");
    expect(text).toContain("- Security: single-use bootstrap token");
    expect(text).toContain("**Important:** Run `/pair cleanup` after pairing finishes.");
    expect(text).toContain("If this QR code leaks, run `/pair cleanup` immediately.");
    expect(text).not.toContain("```");
  });

  it("rejects qr setup for internal gateway callers without operator.pairing", async () => {
    const command = registerPairCommand();
    const result = await command.handler(
      createCommandContext({
        channel: "webchat",
        args: "qr",
        commandBody: "/pair qr",
        gatewayClientScopes: ["operator.write"],
      }),
    );

    expect(pluginApiMocks.issueDeviceBootstrapToken).not.toHaveBeenCalled();
    expect(result).toEqual({
      text: "⚠️ This command requires operator.pairing for internal gateway callers.",
    });
  });

  it("reissues the bootstrap token if webchat QR rendering fails before falling back", async () => {
    pluginApiMocks.issueDeviceBootstrapToken
      .mockResolvedValueOnce({
        token: "first-token",
        expiresAtMs: Date.now() + 10 * 60_000,
      })
      .mockResolvedValueOnce({
        token: "second-token",
        expiresAtMs: Date.now() + 10 * 60_000,
      });
    pluginApiMocks.renderQrPngBase64.mockRejectedValueOnce(new Error("render failed"));

    const command = registerPairCommand();
    const result = await command.handler(
      createCommandContext({
        channel: "webchat",
        gatewayClientScopes: ["operator.write", "operator.pairing"],
      }),
    );
    const text = requireText(result);

    expect(pluginApiMocks.revokeDeviceBootstrapToken).toHaveBeenCalledWith({
      token: "first-token",
    });
    expect(pluginApiMocks.issueDeviceBootstrapToken).toHaveBeenCalledTimes(2);
    expect(text).toContain(
      "QR image delivery is not available on this channel right now, so I generated a pasteable setup code instead.",
    );
    expect(text).toContain("Pairing setup code generated.");
  });

  it("sends a real QR image attachment on feishu", async () => {
    let sentPng = "";
    const sendMessage = vi.fn().mockImplementation(async (_target, _caption, opts) => {
      if (opts?.mediaUrl) {
        sentPng = await fs.readFile(opts.mediaUrl, "utf8");
      }
      return { messageId: "1" };
    });
    const command = registerPairCommand({
      runtime: createChannelRuntime("feishu", "sendMessageFeishu", sendMessage),
    });

    const result = await command.handler(
      createCommandContext({
        channel: "feishu",
        senderId: "ou_abc123",
        accountId: "default",
        messageThreadId: "om_thread123",
      }),
    );
    const text = requireText(result);

    expect(sendMessage).toHaveBeenCalledTimes(1);
    const [target, caption, opts] = sendMessage.mock.calls[0] as [
      string,
      string,
      {
        mediaUrl?: string;
        mediaLocalRoots?: string[];
        accountId?: string;
      } & Record<string, unknown>,
    ];
    expect(target).toBe("ou_abc123");
    expect(caption).toContain("Scan this QR code with the KaijiBot iOS app:");
    expect(caption).toContain("IMPORTANT: After pairing finishes, run /pair cleanup.");
    expect(caption).toContain("If this QR code leaks, run /pair cleanup immediately.");
    expect(opts.mediaUrl).toMatch(/pair-qr\.png$/);
    expect(opts.mediaLocalRoots).toEqual([path.dirname(opts.mediaUrl!)]);
    expect(opts).toMatchObject({
      accountId: "default",
      threadId: "om_thread123",
    });
    expect(sentPng).toBe("fakepng");
    await expect(fs.access(opts.mediaUrl!)).rejects.toThrow();
    expect(text).toContain("QR code sent above.");
    expect(text).toContain("IMPORTANT: Run /pair cleanup after pairing finishes.");
  });

  it("reissues the bootstrap token after QR delivery failure before falling back", async () => {
    pluginApiMocks.issueDeviceBootstrapToken
      .mockResolvedValueOnce({
        token: "first-token",
        expiresAtMs: Date.now() + 10 * 60_000,
      })
      .mockResolvedValueOnce({
        token: "second-token",
        expiresAtMs: Date.now() + 10 * 60_000,
      });

    const sendMessage = vi.fn().mockRejectedValue(new Error("upload failed"));
    const command = registerPairCommand({
      runtime: createChannelRuntime("feishu", "sendMessageFeishu", sendMessage),
    });

    const result = await command.handler(
      createCommandContext({
        channel: "feishu",
        senderId: "ou_test123",
      }),
    );
    const text = requireText(result);

    expect(pluginApiMocks.revokeDeviceBootstrapToken).toHaveBeenCalledWith({
      token: "first-token",
    });
    expect(pluginApiMocks.issueDeviceBootstrapToken).toHaveBeenCalledTimes(2);
    expect(text).toContain("Pairing setup code generated.");
    expect(text).toContain("If this code leaks or you are done, run /pair cleanup");
  });

  it("falls back to the setup code instead of ASCII when the channel cannot send media", async () => {
    const command = registerPairCommand();
    const result = await command.handler(
      createCommandContext({
        channel: "msteams",
        senderId: "8:orgid:123",
      }),
    );
    const text = requireText(result);

    expect(text).toContain("QR image delivery is not available on this channel");
    expect(text).toContain("Setup code:");
    expect(text).toContain("IMPORTANT: After pairing finishes, run /pair cleanup.");
    expect(text).not.toContain("```");
  });

  it("supports invalidating unused setup codes", async () => {
    const command = registerPairCommand();
    const result = await command?.handler(
      createCommandContext({
        channel: "telegram",
        args: "cleanup",
        commandBody: "/pair cleanup",
      }),
    );

    expect(pluginApiMocks.clearDeviceBootstrapTokens).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ text: "Invalidated 2 unused setup codes." });
  });

  it("rejects cleanup for internal gateway callers without operator.pairing", async () => {
    const command = registerPairCommand();
    const result = await command.handler(
      createCommandContext({
        channel: "webchat",
        args: "cleanup",
        commandBody: "/pair cleanup",
        gatewayClientScopes: ["operator.write"],
      }),
    );

    expect(pluginApiMocks.clearDeviceBootstrapTokens).not.toHaveBeenCalled();
    expect(result).toEqual({
      text: "⚠️ This command requires operator.pairing for internal gateway callers.",
    });
  });

  it("fails closed for cleanup when internal gateway scopes are absent", async () => {
    const command = registerPairCommand();
    const result = await command.handler(
      createCommandContext({
        channel: "webchat",
        args: "cleanup",
        commandBody: "/pair cleanup",
        gatewayClientScopes: undefined,
      }),
    );

    expect(pluginApiMocks.clearDeviceBootstrapTokens).not.toHaveBeenCalled();
    expect(result).toEqual({
      text: "⚠️ This command requires operator.pairing for internal gateway callers.",
    });
  });
});

describe("device-pair /pair default setup code", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pluginApiMocks.issueDeviceBootstrapToken.mockResolvedValue({
      token: "boot-token",
      expiresAtMs: Date.now() + 10 * 60_000,
    });
  });

  it("rejects setup code issuance for internal gateway callers without operator.pairing", async () => {
    const command = registerPairCommand();
    const result = await command.handler(
      createCommandContext({
        channel: "webchat",
        args: "",
        commandBody: "/pair",
        gatewayClientScopes: ["operator.write"],
      }),
    );

    expect(pluginApiMocks.issueDeviceBootstrapToken).not.toHaveBeenCalled();
    expect(result).toEqual({
      text: "⚠️ This command requires operator.pairing for internal gateway callers.",
    });
  });

  it("rejects unknown subcommands that fall back to setup code issuance without operator.pairing", async () => {
    const command = registerPairCommand();
    const result = await command.handler(
      createCommandContext({
        channel: "webchat",
        args: "foo",
        commandBody: "/pair foo",
        gatewayClientScopes: ["operator.write"],
      }),
    );

    expect(pluginApiMocks.issueDeviceBootstrapToken).not.toHaveBeenCalled();
    expect(result).toEqual({
      text: "⚠️ This command requires operator.pairing for internal gateway callers.",
    });
  });

  it("fails closed for webchat setup code issuance when scopes are absent", async () => {
    const command = registerPairCommand();
    const result = await command.handler(
      createCommandContext({
        channel: "webchat",
        args: "",
        commandBody: "/pair",
        gatewayClientScopes: undefined,
      }),
    );

    expect(pluginApiMocks.issueDeviceBootstrapToken).not.toHaveBeenCalled();
    expect(result).toEqual({
      text: "⚠️ This command requires operator.pairing for internal gateway callers.",
    });
  });
});

describe("device-pair notify pending formatting", () => {
  it("includes role and scopes for pending requests", async () => {
    const { formatPendingRequests } =
      await vi.importActual<typeof import("./notify.ts")>("./notify.ts");
    const pending: PendingPairingRequest[] = [
      {
        requestId: "req-1",
        deviceId: "device-1",
        displayName: "dev one",
        platform: "ios",
        role: "operator",
        scopes: ["operator.admin", "operator.read"],
        remoteIp: "198.51.100.2",
      },
    ];

    const text = formatPendingRequests(pending);
    expect(text).toContain("Pending device pairing requests:");
    expect(text).toContain("name=dev one");
    expect(text).toContain("platform=ios");
    expect(text).toContain("role=operator");
    expect(text).toContain("scopes=operator.admin, operator.read");
    expect(text).toContain("ip=198.51.100.2");
  });

  it("falls back to roles list and no scopes when role/scopes are absent", async () => {
    const { formatPendingRequests } =
      await vi.importActual<typeof import("./notify.ts")>("./notify.ts");
    const pending: PendingPairingRequest[] = [
      {
        requestId: "req-2",
        deviceId: "device-2",
        roles: ["node", "operator"],
        scopes: [],
      },
    ];

    const text = formatPendingRequests(pending);
    expect(text).toContain("role=node, operator");
    expect(text).toContain("scopes=none");
  });
});

describe("device-pair /pair approve", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects internal gateway callers without operator.pairing", async () => {
    vi.mocked(listDevicePairing).mockResolvedValueOnce({
      pending: [makePendingPairingRequest()],
      paired: [],
    });

    const command = registerPairCommand();
    const result = await command.handler(
      createCommandContext({
        channel: "webchat",
        args: "approve latest",
        commandBody: "/pair approve latest",
        gatewayClientScopes: ["operator.write"],
      }),
    );

    expect(vi.mocked(approveDevicePairing)).not.toHaveBeenCalled();
    expect(result).toEqual({
      text: "⚠️ This command requires operator.pairing for internal gateway callers.",
    });
  });

  it("allows internal gateway callers with operator.pairing", async () => {
    vi.mocked(listDevicePairing).mockResolvedValueOnce({
      pending: [makePendingPairingRequest()],
      paired: [],
    });
    vi.mocked(approveDevicePairing).mockResolvedValueOnce(makeApprovedPairingResult());

    const command = registerPairCommand();
    const result = await command.handler(
      createCommandContext({
        channel: "webchat",
        args: "approve latest",
        commandBody: "/pair approve latest",
        gatewayClientScopes: ["operator.write", "operator.pairing"],
      }),
    );

    expect(vi.mocked(approveDevicePairing)).toHaveBeenCalledWith("req-1", {
      callerScopes: ["operator.write", "operator.pairing"],
    });
    expect(result).toEqual({ text: "✅ Paired Victim Phone (ios)." });
  });

  it("does not force an empty caller scope context for external approvals", async () => {
    vi.mocked(listDevicePairing).mockResolvedValueOnce({
      pending: [makePendingPairingRequest()],
      paired: [],
    });
    vi.mocked(approveDevicePairing).mockResolvedValueOnce(makeApprovedPairingResult());

    const command = registerPairCommand();
    const result = await command.handler(
      createCommandContext({
        channel: "telegram",
        args: "approve latest",
        commandBody: "/pair approve latest",
        gatewayClientScopes: undefined,
      }),
    );

    expect(vi.mocked(approveDevicePairing)).toHaveBeenCalledWith("req-1");
    expect(result).toEqual({ text: "✅ Paired Victim Phone (ios)." });
  });

  it("fails closed for approvals when internal gateway scopes are absent", async () => {
    vi.mocked(listDevicePairing).mockResolvedValueOnce({
      pending: [makePendingPairingRequest()],
      paired: [],
    });

    const command = registerPairCommand();
    const result = await command.handler(
      createCommandContext({
        channel: "webchat",
        args: "approve latest",
        commandBody: "/pair approve latest",
        gatewayClientScopes: undefined,
      }),
    );

    expect(vi.mocked(approveDevicePairing)).not.toHaveBeenCalled();
    expect(result).toEqual({
      text: "⚠️ This command requires operator.pairing for internal gateway callers.",
    });
  });

  it("rejects approvals that request scopes above the caller session", async () => {
    vi.mocked(listDevicePairing).mockResolvedValueOnce({
      pending: [makePendingPairingRequest()],
      paired: [],
    });
    vi.mocked(approveDevicePairing).mockResolvedValueOnce({
      status: "forbidden",
      missingScope: "operator.admin",
    });

    const command = registerPairCommand();
    const result = await command.handler(
      createCommandContext({
        channel: "webchat",
        args: "approve latest",
        commandBody: "/pair approve latest",
        gatewayClientScopes: ["operator.write", "operator.pairing"],
      }),
    );

    expect(vi.mocked(approveDevicePairing)).toHaveBeenCalledWith("req-1", {
      callerScopes: ["operator.write", "operator.pairing"],
    });
    expect(result).toEqual({
      text: "⚠️ This command requires operator.admin to approve this pairing request.",
    });
  });

  it("preserves approvals for non-gateway command surfaces", async () => {
    vi.mocked(listDevicePairing).mockResolvedValueOnce({
      pending: [makePendingPairingRequest()],
      paired: [],
    });
    vi.mocked(approveDevicePairing).mockResolvedValueOnce(
      makeApprovedPairingResult({
        device: {
          scopes: ["operator.admin"],
          approvedScopes: ["operator.admin"],
          tokens: {
            operator: {
              token: "token-1",
              role: "operator",
              scopes: ["operator.admin"],
              createdAtMs: Date.now(),
            },
          },
        },
      }),
    );

    const command = registerPairCommand();
    const result = await command.handler(
      createCommandContext({
        channel: "telegram",
        args: "approve latest",
        commandBody: "/pair approve latest",
        gatewayClientScopes: undefined,
      }),
    );

    expect(vi.mocked(approveDevicePairing)).toHaveBeenCalledWith("req-1");
    expect(result).toEqual({ text: "✅ Paired Victim Phone (ios)." });
  });
});
