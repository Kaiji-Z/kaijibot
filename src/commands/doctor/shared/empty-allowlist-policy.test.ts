import { afterEach, describe, expect, it } from "vitest";
import type { ChannelPlugin } from "../../../channels/plugins/types.js";
import {
  resetPluginRuntimeStateForTest,
  setActivePluginRegistry,
} from "../../../plugins/runtime.js";
import { createTestRegistry } from "../../../test-utils/channel-plugins.js";
import { collectEmptyAllowlistPolicyWarningsForAccount } from "./empty-allowlist-policy.js";

function createDoctorCapabilitiesChannelPlugin(
  id: string,
  doctor: NonNullable<ChannelPlugin["doctor"]>,
): ChannelPlugin {
  return {
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
      listAccountIds: () => ["default"],
      resolveAccount: () => ({}),
      isConfigured: async () => true,
    },
    doctor,
  };
}

describe("doctor empty allowlist policy warnings", () => {
  afterEach(() => {
    resetPluginRuntimeStateForTest();
  });

  it("warns when dm allowlist mode has no allowFrom entries", () => {
    const warnings = collectEmptyAllowlistPolicyWarningsForAccount({
      account: { dmPolicy: "allowlist" },
      channelName: "signal",
      doctorFixCommand: "kaijibot doctor --fix",
      prefix: "channels.signal",
    });

    expect(warnings).toEqual([
      expect.stringContaining('channels.signal.dmPolicy is "allowlist" but allowFrom is empty'),
    ]);
  });

  it("warns when non-telegram group allowlist mode does not fall back to allowFrom", () => {
    const warnings = collectEmptyAllowlistPolicyWarningsForAccount({
      account: { groupPolicy: "allowlist" },
      channelName: "imessage",
      doctorFixCommand: "kaijibot doctor --fix",
      prefix: "channels.imessage",
    });

    expect(warnings).toEqual([
      expect.stringContaining('channels.imessage.groupPolicy is "allowlist"'),
    ]);
  });

  it("stays quiet for hybrid route-and-sender group access channels", () => {
    // The quiet behavior is declared by the channel plugin's doctor
    // capabilities; discord/zalouser plugins are not bundled in this fork.
    setActivePluginRegistry(
      createTestRegistry([
        {
          pluginId: "zalouser",
          source: "test",
          plugin: createDoctorCapabilitiesChannelPlugin("zalouser", {
            groupModel: "hybrid",
            warnOnEmptyGroupSenderAllowlist: false,
          }),
        },
      ]),
    );

    const warnings = collectEmptyAllowlistPolicyWarningsForAccount({
      account: { groupPolicy: "allowlist" },
      channelName: "zalouser",
      doctorFixCommand: "kaijibot doctor --fix",
      prefix: "channels.zalouser",
    });

    expect(warnings).toEqual([]);
  });

  it("stays quiet for channels that do not use sender-based group allowlists", () => {
    setActivePluginRegistry(
      createTestRegistry([
        {
          pluginId: "discord",
          source: "test",
          plugin: createDoctorCapabilitiesChannelPlugin("discord", {
            groupModel: "route",
            warnOnEmptyGroupSenderAllowlist: false,
          }),
        },
      ]),
    );

    const warnings = collectEmptyAllowlistPolicyWarningsForAccount({
      account: { groupPolicy: "allowlist" },
      channelName: "discord",
      doctorFixCommand: "kaijibot doctor --fix",
      prefix: "channels.discord",
    });

    expect(warnings).toEqual([]);
  });
});
