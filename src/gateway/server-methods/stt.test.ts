import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorCodes } from "../protocol/index.js";

const mocks = vi.hoisted(() => ({
  loadConfig: vi.fn(() => ({})),
  transcribeAudioFile: vi.fn(async (_params: { filePath: string }) => ({ text: " 你好世界 " })),
}));

vi.mock("../../config/config.js", () => ({
  loadConfig: mocks.loadConfig as typeof import("../../config/config.js").loadConfig,
}));

vi.mock("../../media-understanding/runtime.js", () => ({
  transcribeAudioFile:
    mocks.transcribeAudioFile as typeof import("../../media-understanding/runtime.js").transcribeAudioFile,
}));

async function callHandler(params: Record<string, unknown>) {
  const { sttHandlers } = await import("./stt.js");
  const respond = vi.fn();
  await sttHandlers["stt.transcribe"]!({ params, respond } as never);
  return respond;
}

describe("sttHandlers stt.transcribe", () => {
  beforeEach(() => {
    mocks.loadConfig.mockReset();
    mocks.loadConfig.mockReturnValue({});
    mocks.transcribeAudioFile.mockReset();
    mocks.transcribeAudioFile.mockResolvedValue({ text: " 你好世界 " });
  });

  it("transcribes base64 audio and trims the transcript", async () => {
    let writtenContent = "";
    mocks.transcribeAudioFile.mockImplementation(async (params: { filePath: string }) => {
      writtenContent = (await fs.readFile(params.filePath)).toString();
      return { text: " 你好世界 " };
    });
    const respond = await callHandler({
      audioBase64: Buffer.from("fake-webm-bytes").toString("base64"),
      mimeType: "audio/webm",
    });
    expect(respond).toHaveBeenCalledWith(true, { text: "你好世界" });
    const call = mocks.transcribeAudioFile.mock.calls[0]?.[0] as unknown as {
      filePath: string;
      mime: string;
    };
    expect(call.mime).toBe("audio/webm");
    expect(writtenContent).toBe("fake-webm-bytes");
  });

  it("accepts data URLs and extracts the mime type", async () => {
    const respond = await callHandler({
      audioBase64: `data:audio/mp4;base64,${Buffer.from("m4a").toString("base64")}`,
    });
    expect(respond).toHaveBeenCalledWith(true, { text: "你好世界" });
    const call = mocks.transcribeAudioFile.mock.calls[0]?.[0] as unknown as { mime: string };
    expect(call.mime).toBe("audio/mp4");
  });

  it("rejects missing audioBase64", async () => {
    const respond = await callHandler({});
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ code: ErrorCodes.INVALID_REQUEST }),
    );
  });

  it("rejects non-string audioBase64", async () => {
    const respond = await callHandler({ audioBase64: 123 });
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ code: ErrorCodes.INVALID_REQUEST }),
    );
  });

  it("rejects empty-decoding base64", async () => {
    const respond = await callHandler({ audioBase64: "!!!!" });
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ code: ErrorCodes.INVALID_REQUEST }),
    );
    expect(mocks.transcribeAudioFile).not.toHaveBeenCalled();
  });

  it("rejects audio above the hard cap", async () => {
    const respond = await callHandler({
      audioBase64: Buffer.alloc(26 * 1024 * 1024, 1).toString("base64"),
    });
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        code: ErrorCodes.INVALID_REQUEST,
        message: expect.stringContaining("audio too large"),
      }),
    );
    expect(mocks.transcribeAudioFile).not.toHaveBeenCalled();
  });

  it("responds UNAVAILABLE when no provider produces a transcript", async () => {
    mocks.transcribeAudioFile.mockResolvedValue({
      text: undefined as unknown as string,
    });
    const respond = await callHandler({
      audioBase64: Buffer.from("x").toString("base64"),
    });
    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ code: ErrorCodes.UNAVAILABLE }),
    );
  });

  it("cleans up the temp audio file after success", async () => {
    let capturedPath = "";
    mocks.transcribeAudioFile.mockImplementation(async (params: { filePath: string }) => {
      capturedPath = params.filePath;
      return { text: "ok" };
    });
    const respond = await callHandler({
      audioBase64: Buffer.from("x").toString("base64"),
    });
    expect(respond).toHaveBeenCalledWith(true, { text: "ok" });
    await expect(fs.access(capturedPath)).rejects.toThrow();
  });

  it("keeps temp files inside the preferred KaijiBot tmp dir", async () => {
    await callHandler({ audioBase64: Buffer.from("x").toString("base64") });
    const call = mocks.transcribeAudioFile.mock.calls[0]?.[0] as unknown as { filePath: string };
    const expectedRoot = path.join(os.tmpdir());
    expect(call.filePath.startsWith(expectedRoot) || call.filePath.includes("kaijibot")).toBe(true);
  });
});
