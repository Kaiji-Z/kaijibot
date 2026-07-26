import { describe, expect, it } from "vitest";
import { isChannelConfigured } from "./channel-configured.js";

describe("isChannelConfigured", () => {
  it("returns false for empty config and env", () => {
    expect(isChannelConfigured({}, "feishu", {})).toBe(false);
  });

  it("detects channel config through generic config presence", () => {
    expect(
      isChannelConfigured(
        {
          channels: {
            signal: {
              httpPort: 8080,
            },
          },
        },
        "signal",
        {},
      ),
    ).toBe(true);
  });

  it("returns false for empty channel config object", () => {
    expect(isChannelConfigured({ channels: { signal: {} } }, "signal", {})).toBe(false);
  });

  it("returns false for upstream channels without bundled plugin even with env vars", () => {
    expect(isChannelConfigured({}, "telegram", { TELEGRAM_BOT_TOKEN: "token" })).toBe(false);
    expect(isChannelConfigured({}, "discord", { DISCORD_BOT_TOKEN: "token" })).toBe(false);
    expect(isChannelConfigured({}, "slack", { SLACK_BOT_TOKEN: "xoxb-test" })).toBe(false);
    expect(
      isChannelConfigured({}, "irc", {
        IRC_HOST: "irc.example.com",
        IRC_NICK: "kaijibot",
      }),
    ).toBe(false);
  });
});
