import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CARD_PHASES } from "./card-types.js";
import { THROTTLE_CONSTANTS } from "./card-types.js";
import {
  FeishuStreamingSession,
  mergeStreamingText,
  resolveStreamingCardSendMode,
  isTerminalPhase,
  transitionPhase,
} from "./streaming-card.js";

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("kaijibot/plugin-sdk/ssrf-runtime", () => ({
  fetchWithSsrFGuard: fetchMock,
}));

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

type FetchRequest = { url: string; init?: { method?: string; body?: string } };

describe("FeishuStreamingSession progress content (initialContent / render / close)", () => {
  const creds = { appId: "app", appSecret: "secret", domain: "feishu" as const };

  function installFetchMock() {
    fetchMock.mockImplementation(async (req: FetchRequest) => {
      if (req.url.includes("/auth/v3/")) {
        return {
          response: {
            ok: true,
            json: async () => ({ code: 0, tenant_access_token: "tok", expire: 7200 }),
          },
          release: async () => {},
        };
      }
      if (req.url.endsWith("/cardkit/v1/cards") && req.init?.method === "POST") {
        return {
          response: { ok: true, json: async () => ({ code: 0, data: { card_id: "card_1" } }) },
          release: async () => {},
        };
      }
      return {
        response: { ok: true, json: async () => ({ code: 0 }) },
        release: async () => {},
      };
    });
  }

  function createClient() {
    return {
      im: {
        message: {
          reply: vi.fn(async () => ({ code: 0, data: { message_id: "om_card" } })),
          create: vi.fn(async () => ({ code: 0, data: { message_id: "om_card" } })),
        },
      },
    };
  }

  function requestBody(req: FetchRequest): Record<string, unknown> {
    return JSON.parse(req.init?.body ?? "{}") as Record<string, unknown>;
  }

  function createdCardContent(): string {
    const call = fetchMock.mock.calls.find(([req]) =>
      (req as FetchRequest).url.endsWith("/cardkit/v1/cards"),
    );
    if (!call) {
      throw new Error("card create call not found");
    }
    const body = requestBody(call[0] as FetchRequest);
    const cardJson = JSON.parse(String(body.data)) as {
      body: { elements: Array<{ content?: string; element_id?: string }> };
    };
    const content = cardJson.body.elements.find((el) => el.element_id === "content");
    return content?.content ?? "";
  }

  function contentPuts(): string[] {
    return fetchMock.mock.calls
      .map(([req]) => req as FetchRequest)
      .filter((req) => req.url.includes("/elements/content/content"))
      .map((req) => String(requestBody(req).content));
  }

  /** Override the response for requests whose URL contains `pathSuffix`.
   *  Returns a function that restores the previous fetch mock. */
  function overrideResponse(
    pathSuffix: string,
    response: { ok: boolean; status: number; body: unknown },
  ): () => void {
    const upstream = fetchMock.getMockImplementation();
    fetchMock.mockImplementation(async (req: FetchRequest) => {
      if (req.url.includes(pathSuffix)) {
        return {
          response: {
            ok: response.ok,
            status: response.status,
            json: async () => response.body,
          },
          release: async () => {},
        };
      }
      return upstream?.(req);
    });
    return () => {
      if (upstream) {
        fetchMock.mockImplementation(upstream);
      }
    };
  }

  function failWith(pathSuffix: string, status: number): () => void {
    return overrideResponse(pathSuffix, {
      ok: false,
      status,
      body: { code: status, msg: "internal error" },
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    installFetchMock();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("start uses initialContent for the content element", async () => {
    const session = new FeishuStreamingSession(createClient() as never, creds);
    await session.start("oc_1", "chat_id", { initialContent: "⏳ **Working** · 5s" });
    expect(createdCardContent()).toBe("⏳ **Working** · 5s");
  });

  it("start falls back to the Thinking placeholder without initialContent", async () => {
    const session = new FeishuStreamingSession(createClient() as never, creds);
    await session.start("oc_1", "chat_id", {});
    expect(createdCardContent()).toBe("⏳ Thinking...");
  });

  it("render replaces content without merging", async () => {
    const session = new FeishuStreamingSession(createClient() as never, creds);
    await session.start("oc_1", "chat_id", { initialContent: "panel v1" });

    await session.render("panel v2 — different text");
    await vi.advanceTimersByTimeAsync(THROTTLE_CONSTANTS.CARDKIT_MS + 50);

    expect(contentPuts()).toEqual(["panel v2 — different text"]);
  });

  it("render skips no-op updates with identical content", async () => {
    const session = new FeishuStreamingSession(createClient() as never, creds);
    await session.start("oc_1", "chat_id", { initialContent: "panel v1" });

    await session.render("panel v1");
    await vi.advanceTimersByTimeAsync(THROTTLE_CONSTANTS.CARDKIT_MS + 50);

    expect(contentPuts()).toEqual([]);
  });

  it("render after update overrides a pending merge with the full snapshot", async () => {
    const session = new FeishuStreamingSession(createClient() as never, creds);
    await session.start("oc_1", "chat_id", {});

    await session.update("hello wor");
    await session.render("⏳ **Working** · 10s");
    await vi.advanceTimersByTimeAsync(THROTTLE_CONSTANTS.CARDKIT_MS + 50);

    expect(contentPuts()).toEqual(["⏳ **Working** · 10s"]);
  });

  it("close with replaceFinal uses the final text verbatim (no merge with panel)", async () => {
    const session = new FeishuStreamingSession(createClient() as never, creds);
    await session.start("oc_1", "chat_id", { initialContent: "⏳ panel" });
    await session.render("⏳ panel v2");
    await vi.advanceTimersByTimeAsync(THROTTLE_CONSTANTS.CARDKIT_MS + 50);

    await session.close("final answer", { replaceFinal: true });

    expect(contentPuts()).toEqual(["⏳ panel v2", "final answer"]);
  });

  it("close without replaceFinal preserves merge behavior", async () => {
    const session = new FeishuStreamingSession(createClient() as never, creds);
    await session.start("oc_1", "chat_id", {});
    await session.update("hello");
    await vi.advanceTimersByTimeAsync(THROTTLE_CONSTANTS.CARDKIT_MS + 50);

    await session.close("hello world");

    expect(contentPuts()).toEqual(["hello", "hello world"]);
  });

  it("render is a no-op before the card starts", async () => {
    const session = new FeishuStreamingSession(createClient() as never, creds);
    await session.render("panel");
    await vi.advanceTimersByTimeAsync(THROTTLE_CONSTANTS.CARDKIT_MS + 50);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports a token failure during a timer-driven flush instead of rejecting", async () => {
    const log = vi.fn();
    // The token cache is module-level and keyed by appId: a dedicated app starts cold.
    const session = new FeishuStreamingSession(
      createClient() as never,
      { ...creds, appId: "app-short-lived" },
      log,
    );
    // A one-second token lifetime makes getToken refetch instead of using its cache.
    overrideResponse("/auth/v3/", {
      ok: true,
      status: 200,
      body: { code: 0, tenant_access_token: "tok", expire: 1 },
    });
    await session.start("oc_1", "chat_id", {});
    failWith("/auth/v3/", 500);

    await session.update("hello world");
    // The deferred flush runs from a timer callback that nobody awaits: a rejection
    // here reaches the process as an unhandled rejection and terminates the gateway.
    await vi.advanceTimersByTimeAsync(THROTTLE_CONSTANTS.CARDKIT_MS + 50);

    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("Update failed: Error: Token request failed with HTTP 500"),
    );
    expect(contentPuts()).toEqual([]);
    expect(session.isActive()).toBe(true);
  });

  it("close rejects when the final content update fails", async () => {
    const session = new FeishuStreamingSession(createClient() as never, creds);
    await session.start("oc_1", "chat_id", { initialContent: "⏳ panel" });
    failWith("/elements/content/content", 500);

    await expect(session.close("final answer", { replaceFinal: true })).rejects.toThrow(
      "failed with HTTP 500",
    );
    // The session is still released: a repeated close must not resend anything.
    await expect(session.close("final answer", { replaceFinal: true })).resolves.toBeUndefined();
    expect(contentPuts()).toHaveLength(1);
    expect(session.isActive()).toBe(false);
  });

  it("treats an HTTP 200 envelope with a non-zero code as a failed update", async () => {
    const session = new FeishuStreamingSession(createClient() as never, creds);
    await session.start("oc_1", "chat_id", { initialContent: "⏳ panel" });
    overrideResponse("/elements/content/content", {
      ok: true,
      status: 200,
      body: { code: 99991663, msg: "sequence invalid" },
    });

    await expect(session.close("final answer", { replaceFinal: true })).rejects.toThrow(
      "failed with code 99991663",
    );
  });

  it("close retries content whose last streamed update failed", async () => {
    const log = vi.fn();
    const session = new FeishuStreamingSession(createClient() as never, creds, log);
    await session.start("oc_1", "chat_id", {});
    const restore = failWith("/elements/content/content", 502);

    await session.update("hello world");
    await vi.advanceTimersByTimeAsync(THROTTLE_CONSTANTS.CARDKIT_MS + 50);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Update failed"));

    // The card never received that text, so the final write must not skip it as a duplicate.
    restore();
    await session.close("hello world");
    expect(contentPuts()).toEqual(["hello world", "hello world"]);
  });
});
