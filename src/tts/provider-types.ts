import type { KaijiBotConfig } from "../config/config.js";
import type { TalkProviderConfig } from "../config/types.gateway.js";

export type SpeechProviderId = string;

export type SpeechSynthesisTarget = "audio-file" | "voice-note";

export type SpeechProviderConfig = Record<string, unknown>;

export type SpeechProviderOverrides = Record<string, unknown>;

export type SpeechModelOverridePolicy = {
  enabled: boolean;
  allowText: boolean;
  allowProvider: boolean;
  allowVoice: boolean;
  allowModelId: boolean;
  allowVoiceSettings: boolean;
  allowNormalization: boolean;
  allowSeed: boolean;
};

export type TtsDirectiveOverrides = {
  ttsText?: string;
  provider?: SpeechProviderId;
  providerOverrides?: Record<string, SpeechProviderOverrides>;
};

export type TtsDirectiveParseResult = {
  cleanedText: string;
  ttsText?: string;
  hasDirective: boolean;
  overrides: TtsDirectiveOverrides;
  warnings: string[];
};

export type SpeechProviderConfiguredContext = {
  cfg?: KaijiBotConfig;
  providerConfig: SpeechProviderConfig;
  timeoutMs: number;
};

export type SpeechSynthesisRequest = {
  text: string;
  cfg: KaijiBotConfig;
  providerConfig: SpeechProviderConfig;
  target: SpeechSynthesisTarget;
  providerOverrides?: SpeechProviderOverrides;
  timeoutMs: number;
};

export type SpeechSynthesisResult = {
  audioBuffer: Buffer;
  outputFormat: string;
  fileExtension: string;
  voiceCompatible: boolean;
};

export type SpeechTelephonySynthesisRequest = {
  text: string;
  cfg: KaijiBotConfig;
  providerConfig: SpeechProviderConfig;
  timeoutMs: number;
};

export type SpeechTelephonySynthesisResult = {
  audioBuffer: Buffer;
  outputFormat: string;
  sampleRate: number;
};

export type SpeechVoiceOption = {
  id: string;
  name?: string;
  category?: string;
  description?: string;
  locale?: string;
  gender?: string;
  personalities?: string[];
};

export type SpeechListVoicesRequest = {
  cfg?: KaijiBotConfig;
  providerConfig?: SpeechProviderConfig;
  apiKey?: string;
  baseUrl?: string;
};

export type SpeechProviderResolveConfigContext = {
  cfg: KaijiBotConfig;
  rawConfig: Record<string, unknown>;
  timeoutMs: number;
};

export type SpeechDirectiveTokenParseContext = {
  key: string;
  value: string;
  policy: SpeechModelOverridePolicy;
  providerConfig?: SpeechProviderConfig;
  currentOverrides?: SpeechProviderOverrides;
};

export type SpeechDirectiveTokenParseResult = {
  handled: boolean;
  overrides?: SpeechProviderOverrides;
  warnings?: string[];
};

export type SpeechProviderResolveTalkConfigContext = {
  cfg: KaijiBotConfig;
  baseTtsConfig: Record<string, unknown>;
  talkProviderConfig: TalkProviderConfig;
  timeoutMs: number;
};

export type SpeechProviderResolveTalkOverridesContext = {
  talkProviderConfig: TalkProviderConfig;
  params: Record<string, unknown>;
};
