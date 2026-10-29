import { describe, expect, it } from "vitest";
import { matchesChatSendUserTurnForMediaRewrite } from "./chat.js";

type Entry = Parameters<typeof matchesChatSendUserTurnForMediaRewrite>[0];

function userTurn(text: string, extra: Record<string, unknown> = {}): Entry {
  return {
    type: "message",
    message: {
      role: "user",
      content: [{ type: "text", text }],
      ...extra,
    },
  };
}

describe("matchesChatSendUserTurnForMediaRewrite", () => {
  it("matches a bare persisted turn", () => {
    expect(matchesChatSendUserTurnForMediaRewrite(userTurn("hello"), "hello")).toBe(true);
  });

  it("matches a persisted turn carrying the injected timestamp envelope", () => {
    // Regression: the persisted prompt is stamped with "[Dow YYYY-MM-DD HH:MM UTC]"
    // before the agent session persists it; bare equality never matched, so
    // MediaPath fields were never attached to chat.send attachments.
    const persisted = "[Wed 2026-10-28 14:22 UTC] hello";
    expect(matchesChatSendUserTurnForMediaRewrite(userTurn(persisted), "hello")).toBe(true);
  });

  it("matches a persisted turn carrying an untrusted sender metadata block", () => {
    const persisted = [
      "[Wed 2026-10-28 14:22 UTC] Sender (untrusted metadata):",
      "```json",
      '{"displayName": "Kaiji"}',
      "```",
      "hello",
    ].join("\n");
    expect(matchesChatSendUserTurnForMediaRewrite(userTurn(persisted), "hello")).toBe(true);
  });

  it("rejects non-user entries and turns that already carry media fields", () => {
    expect(
      matchesChatSendUserTurnForMediaRewrite(
        { type: "message", message: { role: "assistant", content: "hello" } },
        "hello",
      ),
    ).toBe(false);
    expect(
      matchesChatSendUserTurnForMediaRewrite(
        userTurn("hello", { MediaPath: "/media/inbound/x.png" }),
        "hello",
      ),
    ).toBe(false);
    expect(
      matchesChatSendUserTurnForMediaRewrite(
        userTurn("hello", { MediaPaths: ["/media/inbound/x.png"] }),
        "hello",
      ),
    ).toBe(false);
  });

  it("rejects turns with different text", () => {
    expect(
      matchesChatSendUserTurnForMediaRewrite(userTurn("[Wed 2026-10-28 14:22 UTC] bye"), "hello"),
    ).toBe(false);
  });
});
