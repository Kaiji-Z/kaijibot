import { describe, expect, it } from "vitest";
import { getDoctorChannelCapabilities } from "./channel-capabilities.js";

const DEFAULT_CAPABILITIES = {
  dmAllowFromMode: "topOnly",
  groupModel: "sender",
  groupAllowFromFallbackToAllowFrom: true,
  warnOnEmptyGroupSenderAllowlist: true,
} as const;

describe("doctor channel capabilities", () => {
  // matrix, zalouser, and msteams ship no bundled channel plugin in this repo
  // (upstream reference only), so they resolve to the default capabilities.
  it("falls back to default capabilities for matrix without a bundled plugin", () => {
    expect(getDoctorChannelCapabilities("matrix")).toEqual(DEFAULT_CAPABILITIES);
  });

  it("falls back to default capabilities for zalouser without a bundled plugin", () => {
    expect(getDoctorChannelCapabilities("zalouser")).toEqual(DEFAULT_CAPABILITIES);
  });

  it("falls back to default capabilities for msteams without a bundled plugin", () => {
    expect(getDoctorChannelCapabilities("msteams")).toEqual(DEFAULT_CAPABILITIES);
  });

  it("falls back conservatively for unknown external channels", () => {
    expect(getDoctorChannelCapabilities("external-demo")).toEqual({
      dmAllowFromMode: "topOnly",
      groupModel: "sender",
      groupAllowFromFallbackToAllowFrom: true,
      warnOnEmptyGroupSenderAllowlist: true,
    });
  });
});
