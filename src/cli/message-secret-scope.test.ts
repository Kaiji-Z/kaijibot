import { describe, expect, it } from "vitest";
import { resolveMessageSecretScope } from "./message-secret-scope.js";

describe("resolveMessageSecretScope", () => {
  it("prefers explicit channel/account inputs", () => {
    expect(
      resolveMessageSecretScope({
        channel: "Feishu",
        accountId: "Ops",
      }),
    ).toEqual({
      channel: "feishu",
      accountId: "ops",
    });
  });

  it("infers channel from a prefixed target", () => {
    expect(
      resolveMessageSecretScope({
        target: "feishu:12345",
      }),
    ).toEqual({
      channel: "feishu",
    });
  });

  it("infers a shared channel from target arrays", () => {
    expect(
      resolveMessageSecretScope({
        targets: ["feishu:one", "feishu:two"],
      }),
    ).toEqual({
      channel: "feishu",
    });
  });

  it("does not infer a channel when target arrays mix channels", () => {
    expect(
      resolveMessageSecretScope({
        targets: ["feishu:one", "wechat:two"],
      }),
    ).toEqual({});
  });

  it("uses fallback channel/account when direct inputs are missing", () => {
    expect(
      resolveMessageSecretScope({
        fallbackChannel: "Feishu",
        fallbackAccountId: "Chat",
      }),
    ).toEqual({
      channel: "feishu",
      accountId: "chat",
    });
  });
});
