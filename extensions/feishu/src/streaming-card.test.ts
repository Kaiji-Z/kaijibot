import { describe, expect, it } from "vitest";
import { CARD_PHASES } from "./card-types.js";
import { THROTTLE_CONSTANTS } from "./card-types.js";
import {
  mergeStreamingText,
  resolveStreamingCardSendMode,
  isTerminalPhase,
  transitionPhase,
} from "./streaming-card.js";

describe("mergeStreamingText", () => {
  it("prefers the latest full text when it already includes prior text", () => {
    expect(mergeStreamingText("hello", "hello world")).toBe("hello world");
  });

  it("keeps previous text when the next partial is empty or redundant", () => {
    expect(mergeStreamingText("hello", "")).toBe("hello");
    expect(mergeStreamingText("hello world", "hello")).toBe("hello world");
  });

  it("appends fragmented chunks without injecting newlines", () => {
    expect(mergeStreamingText("hello wor", "ld")).toBe("hello world");
    expect(mergeStreamingText("line1", "line2")).toBe("line1line2");
  });

  it("merges overlap between adjacent partial snapshots", () => {
    expect(mergeStreamingText("好的，让我", "让我再读取一遍")).toBe("好的，让我再读取一遍");
    expect(mergeStreamingText("revision_id: 552", "2，一点变化都没有")).toBe(
      "revision_id: 552，一点变化都没有",
    );
    expect(mergeStreamingText("abc", "cabc")).toBe("cabc");
  });
});

describe("resolveStreamingCardSendMode", () => {
  it("prefers message.reply when reply target and root id both exist", () => {
    expect(
      resolveStreamingCardSendMode({
        replyToMessageId: "om_parent",
        rootId: "om_topic_root",
      }),
    ).toBe("reply");
  });

  it("falls back to root create when reply target is absent", () => {
    expect(
      resolveStreamingCardSendMode({
        rootId: "om_topic_root",
      }),
    ).toBe("root_create");
  });

  it("uses create mode when no reply routing fields are provided", () => {
    expect(resolveStreamingCardSendMode()).toBe("create");
    expect(
      resolveStreamingCardSendMode({
        replyInThread: true,
      }),
    ).toBe("create");
  });
});

describe("CardPhase state machine (re-exported from streaming-card)", () => {
  it("isTerminalPhase returns true for terminal phases", () => {
    expect(isTerminalPhase("completed")).toBe(true);
    expect(isTerminalPhase("aborted")).toBe(true);
    expect(isTerminalPhase("terminated")).toBe(true);
    expect(isTerminalPhase("creation_failed")).toBe(true);
  });

  it("isTerminalPhase returns false for non-terminal phases", () => {
    expect(isTerminalPhase("idle")).toBe(false);
    expect(isTerminalPhase("creating")).toBe(false);
    expect(isTerminalPhase("streaming")).toBe(false);
  });

  it("transitionPhase allows valid transitions", () => {
    expect(transitionPhase("idle", "creating")).toBe("creating");
    expect(transitionPhase("creating", "streaming")).toBe("streaming");
    expect(transitionPhase("streaming", "completed")).toBe("completed");
    expect(transitionPhase("streaming", "aborted")).toBe("aborted");
    expect(transitionPhase("streaming", "terminated")).toBe("terminated");
  });

  it("transitionPhase rejects invalid transitions", () => {
    expect(() => transitionPhase("idle", "streaming")).toThrow("Invalid phase transition");
    expect(() => transitionPhase("completed", "streaming")).toThrow("Invalid phase transition");
    expect(() => transitionPhase("aborted", "idle")).toThrow("Invalid phase transition");
  });

  it("CARD_PHASES contains all expected phases", () => {
    const phases = Object.values(CARD_PHASES);
    expect(phases).toContain("idle");
    expect(phases).toContain("creating");
    expect(phases).toContain("streaming");
    expect(phases).toContain("completed");
    expect(phases).toContain("aborted");
    expect(phases).toContain("terminated");
    expect(phases).toContain("creation_failed");
  });

  it("THROTTLE_CONSTANTS has expected values", () => {
    expect(THROTTLE_CONSTANTS.CARDKIT_MS).toBe(100);
    expect(THROTTLE_CONSTANTS.PATCH_MS).toBe(1500);
    expect(THROTTLE_CONSTANTS.LONG_GAP_THRESHOLD_MS).toBe(2000);
    expect(THROTTLE_CONSTANTS.BATCH_AFTER_GAP_MS).toBe(300);
    expect(THROTTLE_CONSTANTS.REASONING_STATUS_MS).toBe(1500);
  });
});
