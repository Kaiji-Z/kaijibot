// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  RECORDING_MAX_MS,
  VoiceRecorder,
  blobToBase64,
  formatElapsed,
  isMicBlockedByInsecureOrigin,
  isRecorderSupported,
  pickRecorderMimeType,
} from "./recorder.ts";

describe("formatElapsed", () => {
  it("formats milliseconds as m:ss", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(4_500)).toBe("0:04");
    expect(formatElapsed(65_000)).toBe("1:05");
  });
});

describe("pickRecorderMimeType", () => {
  it("returns undefined when MediaRecorder is missing", () => {
    expect(pickRecorderMimeType()).toBeUndefined();
  });
});

describe("isRecorderSupported", () => {
  it("reflects browser API availability", () => {
    expect(typeof isRecorderSupported()).toBe("boolean");
  });
});

describe("VoiceRecorder.start error mapping", () => {
  function stubGetUserMedia(err: DOMException): void {
    vi.stubGlobal("navigator", {
      mediaDevices: {
        getUserMedia: vi.fn(() => Promise.reject(err)),
      },
    });
    vi.stubGlobal("MediaRecorder", class {});
  }

  it("maps NotAllowedError to the site-permission hint", async () => {
    stubGetUserMedia(
      new DOMException("denied", "NotAllowedError") as unknown as DOMException,
    );
    const onError = vi.fn();
    const recorder = new VoiceRecorder({ onError });
    expect(await recorder.start()).toBe(false);
    expect(onError).toHaveBeenCalledWith(
      "Microphone permission denied — allow it via the site icon in the address bar",
    );
    vi.unstubAllGlobals();
  });

  it("maps NotReadableError to the device-busy hint", async () => {
    stubGetUserMedia(
      new DOMException("busy", "NotReadableError") as unknown as DOMException,
    );
    const onError = vi.fn();
    const recorder = new VoiceRecorder({ onError });
    expect(await recorder.start()).toBe(false);
    expect(onError).toHaveBeenCalledWith(
      "Microphone is in use by another application",
    );
    vi.unstubAllGlobals();
  });
});

describe("isMicBlockedByInsecureOrigin", () => {
  it("returns false when window is unavailable (node)", () => {
    expect(isMicBlockedByInsecureOrigin()).toBe(false);
  });

  it("returns true for insecure origin with MediaRecorder but no mediaDevices", () => {
    vi.stubGlobal("window", { isSecureContext: false });
    vi.stubGlobal("MediaRecorder", class {});
    vi.stubGlobal("navigator", {});
    try {
      expect(isMicBlockedByInsecureOrigin()).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("returns false for secure context", () => {
    vi.stubGlobal("window", { isSecureContext: true });
    vi.stubGlobal("MediaRecorder", class {});
    try {
      expect(isMicBlockedByInsecureOrigin()).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("VoiceRecorder", () => {
  it("start fails fast without getUserMedia and reports via onError", async () => {
    const errors: string[] = [];
    const recorder = new VoiceRecorder({ onError: (error) => errors.push(error) });
    const started = await recorder.start();
    expect(started).toBe(false);
    expect(recorder.isActive).toBe(false);
    expect(errors.length).toBe(1);
  });

  it("stop on an inactive recorder resolves null", async () => {
    const recorder = new VoiceRecorder();
    expect(await recorder.stop()).toBeNull();
  });

  it("cancel on an inactive recorder is a no-op", async () => {
    const recorder = new VoiceRecorder();
    await expect(recorder.cancel()).resolves.toBeUndefined();
  });
});

describe("blobToBase64", () => {
  it("encodes blob content without the data-url prefix", async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "audio/webm" });
    const encoded = await blobToBase64(blob);
    expect(encoded).toBe(Buffer.from([1, 2, 3]).toString("base64"));
  });
});

describe("RECORDING_MAX_MS", () => {
  it("caps dictation at 60 seconds", () => {
    expect(RECORDING_MAX_MS).toBe(60_000);
  });
});
