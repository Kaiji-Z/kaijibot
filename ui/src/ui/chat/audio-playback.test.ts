// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type SourceHandle = {
  buffer: unknown;
  connect: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
  emitEnded: () => void;
};

function installFakeAudioContext(options?: { running?: boolean; decodeError?: Error }) {
  const sources: SourceHandle[] = [];
  const ctx = {
    state: "suspended",
    destination: {},
    resume: vi.fn(async () => {
      ctx.state = options?.running === false ? "suspended" : "running";
    }),
    decodeAudioData: vi.fn(async () => {
      if (options?.decodeError) {
        throw options.decodeError;
      }
      return { duration: 1 };
    }),
    createBufferSource: vi.fn(() => {
      let endedHandler: (() => void) | null = null;
      const source: SourceHandle = {
        buffer: null,
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        addEventListener: vi.fn((type: string, handler: () => void) => {
          if (type === "ended") {
            endedHandler = handler;
          }
        }),
        emitEnded: () => {
          endedHandler?.();
        },
      };
      sources.push(source);
      return source;
    }),
  };
  vi.stubGlobal(
    "AudioContext",
    class {
      constructor() {
        return ctx;
      }
    },
  );
  return { ctx, sources };
}

function installBrowserSpeech() {
  const speak = vi.fn();
  vi.stubGlobal("speechSynthesis", { speak, cancel: vi.fn(), speaking: false });
  vi.stubGlobal(
    "SpeechSynthesisUtterance",
    class {
      rate = 1;
      pitch = 1;
      addEventListener = vi.fn();
    },
  );
  return speak;
}

type GatewayClientParam = Parameters<typeof mod.setGatewayAudioClient>[0];

function makeClient(payload: Record<string, unknown> | Error): NonNullable<GatewayClientParam> {
  return {
    request: vi.fn(async () => {
      if (payload instanceof Error) {
        throw payload;
      }
      return payload;
    }),
  } as unknown as NonNullable<GatewayClientParam>;
}

let mod: typeof import("./audio-playback.ts");

beforeEach(async () => {
  vi.resetModules();
  mod = await import("./audio-playback.ts");
});

afterEach(() => {
  mod.stopGatewayAudio();
  mod.setGatewayAudioClient(null);
  vi.unstubAllGlobals();
});

describe("speakViaGatewayOrBrowser", () => {
  it("plays gateway audio through the WebAudio context", async () => {
    const { ctx, sources } = installFakeAudioContext();
    mod.setGatewayAudioClient(makeClient({ audioBase64: "QUJD", outputFormat: "mp3" }));
    const onStart = vi.fn();
    const onEnd = vi.fn();
    const promise = mod.speakViaGatewayOrBrowser("你好", { onStart, onEnd });
    await vi.waitFor(() => expect(ctx.decodeAudioData).toHaveBeenCalled());
    await vi.waitFor(() => expect(sources.length).toBe(1));
    await vi.waitFor(() => expect(sources[0]?.addEventListener).toHaveBeenCalled());
    expect(onStart).toHaveBeenCalled();
    expect(sources[0]?.connect).toHaveBeenCalledWith(ctx.destination);
    sources[0]!.emitEnded();
    await expect(promise).resolves.toBeUndefined();
    expect(onEnd).toHaveBeenCalled();
  });

  it("falls back to browser speech without calling the gateway when the context cannot unlock", async () => {
    const speak = installBrowserSpeech();
    installFakeAudioContext({ running: false });
    const client = makeClient({ audioBase64: "QUJD" });
    mod.setGatewayAudioClient(client);
    await mod.speakViaGatewayOrBrowser("你好");
    expect(client.request).not.toHaveBeenCalled();
    expect(speak).toHaveBeenCalled();
  });

  it("falls back to browser speech when the gateway has no audio", async () => {
    const speak = installBrowserSpeech();
    installFakeAudioContext();
    mod.setGatewayAudioClient(makeClient({}));
    await mod.speakViaGatewayOrBrowser("你好");
    expect(speak).toHaveBeenCalled();
  });

  it("falls back to browser speech when decoding fails", async () => {
    const speak = installBrowserSpeech();
    installFakeAudioContext({ decodeError: new Error("decode failed") });
    mod.setGatewayAudioClient(makeClient({ audioBase64: "QUJD" }));
    await mod.speakViaGatewayOrBrowser("你好");
    expect(speak).toHaveBeenCalled();
  });

  it("skips empty text", async () => {
    const client = makeClient({ audioBase64: "QUJD" });
    mod.setGatewayAudioClient(client);
    await mod.speakViaGatewayOrBrowser("```code only```");
    expect(client.request).not.toHaveBeenCalled();
  });
});
