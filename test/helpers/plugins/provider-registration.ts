import type {
  ImageGenerationProviderPlugin,
  MediaUnderstandingProviderPlugin,
  MusicGenerationProviderPlugin,
  ProviderPlugin,
  SpeechProviderPlugin,
  VideoGenerationProviderPlugin,
} from "../../../src/plugins/types.js";
import { createTestPluginApi } from "./plugin-api.js";

type RegisteredProviderCollections = {
  providers: ProviderPlugin[];
  speechProviders: SpeechProviderPlugin[];
  mediaProviders: MediaUnderstandingProviderPlugin[];
  imageProviders: ImageGenerationProviderPlugin[];
  musicProviders: MusicGenerationProviderPlugin[];
  videoProviders: VideoGenerationProviderPlugin[];
};

type ProviderPluginModule = {
  register(api: ReturnType<typeof createTestPluginApi>): void | Promise<void>;
};

export async function registerProviderPlugin(params: {
  plugin: ProviderPluginModule;
  id: string;
  name: string;
}): Promise<RegisteredProviderCollections> {
  const providers: ProviderPlugin[] = [];
  const speechProviders: SpeechProviderPlugin[] = [];
  const mediaProviders: MediaUnderstandingProviderPlugin[] = [];
  const imageProviders: ImageGenerationProviderPlugin[] = [];
  const musicProviders: MusicGenerationProviderPlugin[] = [];
  const videoProviders: VideoGenerationProviderPlugin[] = [];

  await params.plugin.register(
    createTestPluginApi({
      id: params.id,
      name: params.name,
      source: "test",
      config: {},
      runtime: {} as never,
      registerProvider: (provider: ProviderPlugin) => {
        providers.push(provider);
      },
      registerSpeechProvider: (provider: SpeechProviderPlugin) => {
        speechProviders.push(provider);
      },
      registerMediaUnderstandingProvider: (provider: MediaUnderstandingProviderPlugin) => {
        mediaProviders.push(provider);
      },
      registerImageGenerationProvider: (provider: ImageGenerationProviderPlugin) => {
        imageProviders.push(provider);
      },
      registerMusicGenerationProvider: (provider: MusicGenerationProviderPlugin) => {
        musicProviders.push(provider);
      },
      registerVideoGenerationProvider: (provider: VideoGenerationProviderPlugin) => {
        videoProviders.push(provider);
      },
    }),
  );

  return {
    providers,
    speechProviders,
    mediaProviders,
    imageProviders,
    musicProviders,
    videoProviders,
  };
}

export function requireRegisteredProvider<T extends { id: string }>(
  entries: T[],
  id: string,
  label = "provider",
): T {
  const entry = entries.find((candidate) => candidate.id === id);
  if (!entry) {
    throw new Error(`${label} ${id} was not registered`);
  }
  return entry;
}
