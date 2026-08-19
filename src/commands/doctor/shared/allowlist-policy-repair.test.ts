import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChannelPlugin } from "../../../channels/plugins/types.js";
import {
  resetPluginRuntimeStateForTest,
  setActivePluginRegistry,
} from "../../../plugins/runtime.js";
import { createTestRegistry } from "../../../test-utils/channel-plugins.js";
import { maybeRepairAllowlistPolicyAllowFrom } from "./allowlist-policy-repair.js";

const { readChannelAllowFromStoreMock } = vi.hoisted(() => ({
  readChannelAllowFromStoreMock: vi.fn(),
}));

vi.mock("../../../pairing/pairing-store.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../pairing/pairing-store.js")>()),
  readChannelAllowFromStore: readChannelAllowFromStoreMock,
}));

function createNestedDmAllowFromChannelPlugin(id: string): ChannelPlugin {
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
    // The matrix plugin is not bundled in this fork; nested-dm semantics are
    // declared through the plugin doctor capability seam.
    doctor: { dmAllowFromMode: "nestedOnly" },
  };
}

describe("doctor allowlist-policy repair", () => {
  beforeEach(() => {
    readChannelAllowFromStoreMock.mockReset();
    setActivePluginRegistry(
      createTestRegistry([
        {
          pluginId: "matrix",
          source: "test",
          plugin: createNestedDmAllowFromChannelPlugin("matrix"),
        },
      ]),
    );
  });

  afterEach(() => {
    resetPluginRuntimeStateForTest();
  });

  it("restores matrix dm allowFrom from the pairing store into the nested path", async () => {
    readChannelAllowFromStoreMock.mockResolvedValue(["@alice:example.org"]);

    const result = await maybeRepairAllowlistPolicyAllowFrom({
      channels: {
        matrix: {
          dm: {
            policy: "allowlist",
          },
        },
      },
    });

    expect(result.changes).toEqual([
      '- channels.matrix.dm.allowFrom: restored 1 sender entry from pairing store (dmPolicy="allowlist").',
    ]);
    expect(result.config.channels?.matrix?.allowFrom).toBeUndefined();
    expect(result.config.channels?.matrix?.dm?.allowFrom).toEqual(["@alice:example.org"]);
  });
});
