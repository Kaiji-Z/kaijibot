import {
  describeImagesWithModel,
  describeImageWithModel,
} from "kaijibot/plugin-sdk/media-understanding";
import { afterAll, describe, expect, it, vi } from "vitest";
import {
  deepinfraMediaUnderstandingProvider,
  transcribeDeepInfraAudio,
} from "./media-understanding-provider.js";

const { transcribeOpenAiCompatibleAudioMock } = vi.hoisted(() => ({
  transcribeOpenAiCompatibleAudioMock: vi.fn(async () => ({ text: "hello", model: "whisper" })),
}));

vi.mock("kaijibot/plugin-sdk/media-understanding", async () => {
  const actual = await vi.importActual<typeof import("kaijibot/plugin-sdk/media-understanding")>(
    "kaijibot/plugin-sdk/media-understanding",
  );
  return {
    ...actual,
    transcribeOpenAiCompatibleAudio: transcribeOpenAiCompatibleAudioMock,
  };
});

afterAll(() => {
  vi.doUnmock("kaijibot/plugin-sdk/media-understanding");
  vi.resetModules();
});

describe("deepinfra media understanding provider", () => {
  it("declares image and audio defaults", () => {
    expect(deepinfraMediaUnderstandingProvider).toEqual({
      id: "deepinfra",
      capabilities: ["image", "audio"],
      defaultModels: {
        image: "moonshotai/Kimi-K2.5",
        audio: "openai/whisper-large-v3-turbo",
      },
      autoPriority: {
        image: 45,
        audio: 45,
      },
      transcribeAudio: transcribeDeepInfraAudio,
      describeImage: describeImageWithModel,
      describeImages: describeImagesWithModel,
    });
  });

  it("routes audio transcription through the OpenAI-compatible DeepInfra endpoint", async () => {
    const buffer = Buffer.from("audio");
    const result = await transcribeDeepInfraAudio({
      buffer,
      fileName: "clip.mp3",
      apiKey: "deepinfra-key",
      timeoutMs: 30_000,
    });

    expect(result).toEqual({ text: "hello", model: "whisper" });
    expect(transcribeOpenAiCompatibleAudioMock.mock.calls).toEqual([
      [
        {
          buffer,
          fileName: "clip.mp3",
          apiKey: "deepinfra-key",
          timeoutMs: 30_000,
          provider: "deepinfra",
          defaultBaseUrl: "https://api.deepinfra.com/v1/openai",
          defaultModel: "openai/whisper-large-v3-turbo",
        },
      ],
    ]);
  });
});
