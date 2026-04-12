import type { KaijiBotConfig } from "../../config/config.js";

export function createPerSenderSessionConfig(
  overrides: Partial<NonNullable<KaijiBotConfig["session"]>> = {},
): NonNullable<KaijiBotConfig["session"]> {
  return {
    mainKey: "main",
    scope: "per-sender",
    ...overrides,
  };
}
