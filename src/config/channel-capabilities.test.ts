import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ChannelPlugin } from "../channels/plugins/types.js";
import { setActivePluginRegistry } from "../plugins/runtime.js";
import { createTestRegistry } from "../test-utils/channel-plugins.js";
import { resolveChannelCapabilities } from "./channel-capabilities.js";
import type { KaijiBotConfig } from "./config.js";

describe("resolveChannelCapabilities", () => {
  beforeEach(() => {
    setActivePluginRegistry(baseRegistry);
  });

  afterEach(() => {
    setActivePluginRegistry(baseRegistry);
  });

  it("returns undefined for missing inputs", () => {
    expect(resolveChannelCapabilities({})).toBeUndefined();
    expect(resolveChannelCapabilities({ cfg: {} })).toBeUndefined();
    expect(resolveChannelCapabilities({ cfg: {}, channel: "" })).toBeUndefined();
  });

  it("normalizes and prefers per-account capabilities", () => {
    const cfg = {
      channels: {
        feishu: {
          capabilities: [" inlineButtons ", ""],
          accounts: {
            default: {
              capabilities: [" perAccount ", "  "],
            },
          },
        },
      },
    } satisfies Partial<KaijiBotConfig>;

    expect(
      resolveChannelCapabilities({
        cfg,
        channel: "feishu",
        accountId: "default",
      }),
    ).toEqual(["perAccount"]);
  });

  it("falls back to provider capabilities when account capabilities are missing", () => {
    const cfg = {
      channels: {
        telegram: {
          capabilities: ["inlineButtons"],
          accounts: {
            default: {},
          },
        },
      },
    } satisfies Partial<KaijiBotConfig>;

    expect(
      resolveChannelCapabilities({
        cfg,
        channel: "feishu",
        accountId: "default",
      }),
    ).toEqual(["inlineButtons"]);
  });

  it("matches account keys case-insensitively", () => {
    const cfg = {
      channels: {
        feishu: {
          accounts: {
            Family: { capabilities: ["threads"] },
          },
        },
      },
    } satisfies Partial<KaijiBotConfig>;

    expect(
      resolveChannelCapabilities({
        cfg,
        channel: "feishu",
        accountId: "family",
      }),
    ).toEqual(["threads"]);
  });

  it("supports feishu capabilities", () => {
    setActivePluginRegistry(
      createTestRegistry([
        {
          pluginId: "feishu",
          source: "test",
          plugin: createStubPlugin("feishu"),
        },
      ]),
    );
    const cfg = {
      channels: { feishu: { capabilities: [" polls ", ""] } },
    } satisfies Partial<KaijiBotConfig>;

    expect(
      resolveChannelCapabilities({
        cfg,
        channel: "feishu",
      }),
    ).toEqual(["polls"]);
  });

  it("handles object-format capabilities gracefully (e.g., { inlineButtons: 'dm' })", () => {
    const cfg = {
      channels: {
        feishu: {
          // Object format - used for granular control like inlineButtons scope.
          capabilities: { inlineButtons: "dm" },
        },
      },
    } as unknown as Partial<KaijiBotConfig>;

    // Should return undefined (not crash), allowing channel-specific handlers to process it.
    expect(
      resolveChannelCapabilities({
        cfg,
        channel: "feishu",
      }),
    ).toBeUndefined();
  });

  it("handles feishu object-format capabilities gracefully", () => {
    const cfg = {
      channels: {
        feishu: {
          capabilities: { interactiveReplies: true },
        },
      },
    } as unknown as Partial<KaijiBotConfig>;

    expect(
      resolveChannelCapabilities({
        cfg,
        channel: "feishu",
      }),
    ).toBeUndefined();
  });

  it("handles Slack object-format capabilities gracefully", () => {
    const cfg = {
      channels: {
        slack: {
          capabilities: { interactiveReplies: true },
        },
      },
    } as unknown as Partial<KaijiBotConfig>;

    expect(
      resolveChannelCapabilities({
        cfg,
        channel: "slack",
      }),
    ).toBeUndefined();
  });
});

const createStubPlugin = (id: string): ChannelPlugin => ({
  id,
  meta: {
    id,
    label: id,
    selectionLabel: id,
    docsPath: `/channels/${id}`,
    blurb: "test stub.",
  },
  capabilities: { chatTypes: ["direct"] },
  config: {
    listAccountIds: () => [],
    resolveAccount: () => ({}),
  },
});

const baseRegistry = createTestRegistry([
  { pluginId: "feishu", source: "test", plugin: createStubPlugin("feishu") },
]);
