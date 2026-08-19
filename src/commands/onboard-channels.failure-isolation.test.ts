import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KaijiBotConfig } from "../config/config.js";
import { setActivePluginRegistry } from "../plugins/runtime.js";
import { createChannelTestPluginBase, createTestRegistry } from "../test-utils/channel-plugins.js";
import { WizardCancelledError, type WizardPrompter } from "../wizard/prompts.js";
import { patchChannelSetupWizardAdapter } from "./channel-test-helpers.js";
import { setupChannels } from "./onboard-channels.js";
import { createExitThrowingRuntime, createWizardPrompter } from "./test-wizard-helpers.js";

function setTelegramRegistryForTests(): void {
  setActivePluginRegistry(
    createTestRegistry([
      {
        pluginId: "telegram",
        source: "test",
        plugin: {
          ...createChannelTestPluginBase({
            id: "telegram",
            label: "Telegram",
            capabilities: { chatTypes: ["direct", "group"] },
          }),
          setup: {
            applyAccountConfig: ({ cfg }: { cfg: KaijiBotConfig }) => cfg,
          },
          setupWizard: {
            channel: "telegram",
            status: {
              configuredLabel: "Configured",
              unconfiguredLabel: "Not configured",
              resolveConfigured: ({ cfg }: { cfg: KaijiBotConfig }) =>
                Boolean(cfg.channels?.telegram?.botToken),
            },
            credentials: [],
          },
        },
      },
    ]),
  );
}

function createSelectingTelegramThenDonePrompter(): WizardPrompter {
  const select = vi.fn(async ({ message }: { message: string }) => {
    if (message === "Select channel (QuickStart)") {
      return "telegram";
    }
    return "__done__";
  });
  return createWizardPrompter(
    {
      select: select as unknown as WizardPrompter["select"],
      note: vi.fn(async () => {}),
      confirm: vi.fn(async () => false),
    },
    { defaultSelect: "__done__" },
  );
}

describe("setupChannels per-channel failure isolation", () => {
  beforeEach(() => {
    setTelegramRegistryForTests();
  });

  it("shows an error note and finishes instead of aborting when a channel configure throws", async () => {
    const restore = patchChannelSetupWizardAdapter("telegram", {
      configure: vi.fn(async () => {
        throw new Error("登录超时，请重试。");
      }),
      getStatus: vi.fn(async () => ({
        channel: "telegram",
        configured: false,
        statusLines: [],
      })),
    });
    const prompter = createSelectingTelegramThenDonePrompter();

    try {
      const cfg = await setupChannels({} as KaijiBotConfig, createExitThrowingRuntime(), prompter, {
        quickstartDefaults: true,
        skipConfirm: true,
      });

      expect(cfg).toBeDefined();
      const note = prompter.note as ReturnType<typeof vi.fn>;
      const failureNotes = note.mock.calls
        .map((call) => String(call[0]))
        .filter((msg) => msg.includes("telegram setup failed"));
      expect(failureNotes).toHaveLength(1);
      expect(failureNotes[0]).toContain("登录超时");
    } finally {
      restore();
    }
  });

  it("propagates wizard cancellation instead of converting it into a failure note", async () => {
    const restore = patchChannelSetupWizardAdapter("telegram", {
      configure: vi.fn(async () => {
        throw new WizardCancelledError();
      }),
      getStatus: vi.fn(async () => ({
        channel: "telegram",
        configured: false,
        statusLines: [],
      })),
    });
    const prompter = createSelectingTelegramThenDonePrompter();

    try {
      await expect(
        setupChannels({} as KaijiBotConfig, createExitThrowingRuntime(), prompter, {
          quickstartDefaults: true,
          skipConfirm: true,
        }),
      ).rejects.toBeInstanceOf(WizardCancelledError);

      const note = prompter.note as ReturnType<typeof vi.fn>;
      expect(
        note.mock.calls.map((call) => String(call[0])).filter((m) => m.includes("setup failed")),
      ).toHaveLength(0);
    } finally {
      restore();
    }
  });
});
