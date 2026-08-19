import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { KaijiBotConfig } from "../config/config.js";

let normalizeCompatibilityConfigValues: typeof import("./doctor-legacy-config.js").normalizeCompatibilityConfigValues;
let clearPluginSetupRegistryCache: typeof import("../plugins/setup-registry.js").clearPluginSetupRegistryCache;

function asLegacyConfig(value: unknown): KaijiBotConfig {
  return value as KaijiBotConfig;
}

function getLegacyProperty(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  return (value as Record<string, unknown>)[key];
}
describe("normalizeCompatibilityConfigValues", () => {
  let previousOauthDir: string | undefined;
  let tempOauthDir: string | undefined;

  const writeCreds = (dir: string) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "creds.json"), JSON.stringify({ me: {} }));
  };

  const expectNoWhatsAppConfigForLegacyAuth = (setup?: () => void) => {
    setup?.();
    const res = normalizeCompatibilityConfigValues({
      messages: { ackReaction: "👀", ackReactionScope: "group-mentions" },
    });
    expect(res.config.channels?.whatsapp).toBeUndefined();
    expect(res.changes).toEqual([]);
  };

  beforeEach(() => {
    vi.doUnmock("./doctor-legacy-config.js");
    vi.doUnmock("kaijibot/plugin-sdk/text-runtime");
    vi.resetModules();
    previousOauthDir = process.env.KAIJIBOT_OAUTH_DIR;
    tempOauthDir = fs.mkdtempSync(path.join(os.tmpdir(), "kaijibot-oauth-"));
    process.env.KAIJIBOT_OAUTH_DIR = tempOauthDir;
  });

  beforeEach(async () => {
    ({ normalizeCompatibilityConfigValues } = await import("./doctor-legacy-config.js"));
    ({ clearPluginSetupRegistryCache } = await import("../plugins/setup-registry.js"));
    clearPluginSetupRegistryCache();
  });

  afterEach(() => {
    if (previousOauthDir === undefined) {
      delete process.env.KAIJIBOT_OAUTH_DIR;
    } else {
      process.env.KAIJIBOT_OAUTH_DIR = previousOauthDir;
    }
    if (tempOauthDir) {
      fs.rmSync(tempOauthDir, { recursive: true, force: true });
      tempOauthDir = undefined;
    }
  });

  it("does not add whatsapp config when missing and no auth exists", () => {
    const res = normalizeCompatibilityConfigValues({
      messages: { ackReaction: "👀" },
    });

    expect(res.config.channels?.whatsapp).toBeUndefined();
    expect(res.changes).toEqual([]);
  });

  // The whatsapp/slack/discord/telegram compatibility migrations and the
  // voice-call / bedrock setup migrations below used to ship with their
  // channel and provider plugins, which are not bundled in this repo;
  // normalizeCompatibilityConfigValues leaves those configs untouched.
  it("leaves legacy ack reaction in place when whatsapp config exists", () => {
    const res = normalizeCompatibilityConfigValues({
      messages: { ackReaction: "👀", ackReactionScope: "group-mentions" },
      channels: { whatsapp: {} },
    });

    expect(res.config.channels?.whatsapp?.ackReaction).toBeUndefined();
    expect(res.changes).toEqual([]);
  });

  it("does not add whatsapp config when only auth exists (issue #900)", () => {
    expectNoWhatsAppConfigForLegacyAuth(() => {
      const credsDir = path.join(tempOauthDir ?? "", "whatsapp", "default");
      writeCreds(credsDir);
    });
  });

  it("does not add whatsapp config when only legacy auth exists (issue #900)", () => {
    expectNoWhatsAppConfigForLegacyAuth(() => {
      const credsPath = path.join(tempOauthDir ?? "", "creds.json");
      fs.writeFileSync(credsPath, JSON.stringify({ me: {} }));
    });
  });

  it("does not add whatsapp config when only non-default auth exists (issue #900)", () => {
    expectNoWhatsAppConfigForLegacyAuth(() => {
      const credsDir = path.join(tempOauthDir ?? "", "whatsapp", "work");
      writeCreds(credsDir);
    });
  });

  it("leaves legacy ack reaction in place when authDir override exists", () => {
    const customDir = fs.mkdtempSync(path.join(os.tmpdir(), "kaijibot-wa-auth-"));
    try {
      writeCreds(customDir);

      const res = normalizeCompatibilityConfigValues({
        messages: { ackReaction: "👀", ackReactionScope: "group-mentions" },
        channels: { whatsapp: { accounts: { work: { authDir: customDir } } } },
      });

      expect(res.config.channels?.whatsapp?.ackReaction).toBeUndefined();
      expect(res.changes).toEqual([]);
    } finally {
      fs.rmSync(customDir, { recursive: true, force: true });
    }
  });

  it("leaves Slack nested dm policy as-is instead of migrating to dmPolicy aliases", () => {
    const res = normalizeCompatibilityConfigValues({
      channels: {
        slack: {
          dm: { enabled: true, policy: "open", allowFrom: ["*"] },
        },
      },
    });

    expect(res.config.channels?.slack?.dmPolicy).toBeUndefined();
    expect(res.config.channels?.slack?.allowFrom).toBeUndefined();
    expect(res.config.channels?.slack?.dm).toEqual({
      enabled: true,
      policy: "open",
      allowFrom: ["*"],
    });
    expect(res.changes).toEqual([]);
  });

  it("migrates legacy x_search auth into xai plugin-owned config", () => {
    const res = normalizeCompatibilityConfigValues({
      tools: {
        web: {
          x_search: {
            apiKey: "xai-legacy-key",
            enabled: true,
            model: "grok-4-1-fast",
          },
        } as Record<string, unknown>,
      },
    });

    expect((res.config.tools?.web as Record<string, unknown> | undefined)?.x_search).toEqual({
      enabled: true,
      model: "grok-4-1-fast",
    });
    expect(res.config.plugins?.entries?.xai).toEqual({
      enabled: true,
      config: {
        webSearch: {
          apiKey: "xai-legacy-key",
        },
      },
    });
    expect(res.changes).toEqual(
      expect.arrayContaining([
        "Moved tools.web.x_search.apiKey → plugins.entries.xai.config.webSearch.apiKey.",
      ]),
    );
  });

  it("leaves legacy voice-call config keys as-is", () => {
    const res = normalizeCompatibilityConfigValues({
      plugins: {
        entries: {
          "voice-call": {
            enabled: true,
            config: {
              provider: "log",
              twilio: {
                from: "+15550001234",
              },
              streaming: {
                enabled: true,
                sttProvider: "openai",
                openaiApiKey: "sk-test", // pragma: allowlist secret
                sttModel: "gpt-4o-transcribe",
                silenceDurationMs: 700,
                vadThreshold: 0.4,
              },
            },
          },
        },
      },
    });

    expect(res.config.plugins?.entries?.["voice-call"]?.config).toEqual({
      provider: "log",
      twilio: {
        from: "+15550001234",
      },
      streaming: {
        enabled: true,
        sttProvider: "openai",
        openaiApiKey: "sk-test",
        sttModel: "gpt-4o-transcribe",
        silenceDurationMs: 700,
        vadThreshold: 0.4,
      },
    });
    expect(res.changes).toEqual([]);
  });

  it("leaves legacy Bedrock discovery config in models", () => {
    const res = normalizeCompatibilityConfigValues({
      models: {
        mode: "merge",
        bedrockDiscovery: {
          enabled: true,
          region: "us-east-1",
          providerFilter: ["anthropic"],
        },
      },
    });

    expect(res.config.models).toEqual({
      mode: "merge",
      bedrockDiscovery: {
        enabled: true,
        region: "us-east-1",
        providerFilter: ["anthropic"],
      },
    });
    expect(res.config.plugins?.entries?.["amazon-bedrock"]).toBeUndefined();
    expect(res.changes).toEqual([]);
  });

  it("leaves Discord account nested dm policy as-is", () => {
    const res = normalizeCompatibilityConfigValues({
      channels: {
        discord: {
          accounts: {
            work: {
              dm: { policy: "allowlist", allowFrom: ["123"], groupEnabled: true },
            },
          },
        },
      },
    });

    expect(res.config.channels?.discord?.accounts?.work?.dmPolicy).toBeUndefined();
    expect(res.config.channels?.discord?.accounts?.work?.allowFrom).toBeUndefined();
    expect(res.config.channels?.discord?.accounts?.work?.dm).toEqual({
      policy: "allowlist",
      allowFrom: ["123"],
      groupEnabled: true,
    });
    expect(res.changes).toEqual([]);
  });

  it("preserves Discord streaming boolean aliases as-is", () => {
    const res = normalizeCompatibilityConfigValues(
      asLegacyConfig({
        channels: {
          discord: {
            streaming: true,
            accounts: {
              work: {
                streaming: false,
              },
            },
          },
        },
      }),
    );

    expect(res.config.channels?.discord?.streaming).toBe(true);
    expect(res.config.channels?.discord?.accounts?.work?.streaming).toBe(false);
    expect(res.changes).toEqual([]);
  });

  it("preserves Discord legacy streamMode as-is", () => {
    const res = normalizeCompatibilityConfigValues(
      asLegacyConfig({
        channels: {
          discord: {
            streaming: false,
            streamMode: "block",
          },
        },
      }),
    );

    expect(res.config.channels?.discord?.streaming).toBe(false);
    expect(getLegacyProperty(res.config.channels?.discord, "streamMode")).toBe("block");
    expect(res.changes).toEqual([]);
  });

  it("preserves Telegram streamMode as-is", () => {
    const res = normalizeCompatibilityConfigValues(
      asLegacyConfig({
        channels: {
          telegram: {
            streamMode: "block",
          },
        },
      }),
    );

    expect(getLegacyProperty(res.config.channels?.telegram, "streamMode")).toBe("block");
    expect(res.config.channels?.telegram?.streaming).toBeUndefined();
    expect(res.changes).toEqual([]);
  });

  it("preserves Slack legacy streaming keys as-is", () => {
    const res = normalizeCompatibilityConfigValues(
      asLegacyConfig({
        channels: {
          slack: {
            streaming: false,
            streamMode: "status_final",
          },
        },
      }),
    );

    expect(res.config.channels?.slack?.streaming).toBe(false);
    expect(getLegacyProperty(res.config.channels?.slack, "streamMode")).toBe("status_final");
    expect(res.changes).toEqual([]);
  });

  it("preserves top-level Telegram allowlist fallback for existing named accounts", () => {
    const res = normalizeCompatibilityConfigValues({
      channels: {
        telegram: {
          enabled: true,
          dmPolicy: "allowlist",
          allowFrom: ["123"],
          groupPolicy: "allowlist",
          accounts: {
            bot1: {
              enabled: true,
              botToken: "bot-1-token",
            },
            bot2: {
              enabled: true,
              botToken: "bot-2-token",
            },
          },
        },
      },
    });

    expect(res.config.channels?.telegram?.dmPolicy).toBe("allowlist");
    expect(res.config.channels?.telegram?.allowFrom).toEqual(["123"]);
    expect(res.config.channels?.telegram?.groupPolicy).toBe("allowlist");
    expect(res.config.channels?.telegram?.accounts?.bot1?.botToken).toBe("bot-1-token");
    expect(res.config.channels?.telegram?.accounts?.bot2?.botToken).toBe("bot-2-token");
    expect(res.changes).not.toContain(
      "Moved channels.telegram single-account top-level values into channels.telegram.accounts.default.",
    );
  });

  it("keeps Telegram policy fallback top-level while still seeding default auth", () => {
    const res = normalizeCompatibilityConfigValues({
      channels: {
        telegram: {
          enabled: true,
          botToken: "legacy-token",
          dmPolicy: "allowlist",
          allowFrom: ["123"],
          groupPolicy: "allowlist",
          accounts: {
            bot1: {
              enabled: true,
              botToken: "bot-1-token",
            },
          },
        },
      },
    });

    expect(res.config.channels?.telegram?.accounts?.default).toMatchObject({
      botToken: "legacy-token",
    });
    expect(res.config.channels?.telegram?.botToken).toBeUndefined();
    expect(res.config.channels?.telegram?.dmPolicy).toBe("allowlist");
    expect(res.config.channels?.telegram?.allowFrom).toEqual(["123"]);
    expect(res.config.channels?.telegram?.groupPolicy).toBe("allowlist");
    expect(res.changes).toContain(
      "Moved channels.telegram single-account top-level values into channels.telegram.accounts.default.",
    );
  });

  it("migrates browser ssrfPolicy allowPrivateNetwork to dangerouslyAllowPrivateNetwork", () => {
    const res = normalizeCompatibilityConfigValues({
      browser: {
        ssrfPolicy: {
          allowPrivateNetwork: true,
          allowedHostnames: ["localhost"],
        },
      },
    } as unknown as KaijiBotConfig);

    expect(
      (res.config.browser?.ssrfPolicy as Record<string, unknown> | undefined)?.allowPrivateNetwork,
    ).toBeUndefined();
    expect(res.config.browser?.ssrfPolicy?.dangerouslyAllowPrivateNetwork).toBe(true);
    expect(res.config.browser?.ssrfPolicy?.allowedHostnames).toEqual(["localhost"]);
    expect(res.changes).toContain(
      "Moved browser.ssrfPolicy.allowPrivateNetwork → browser.ssrfPolicy.dangerouslyAllowPrivateNetwork (true).",
    );
  });

  it("normalizes conflicting browser SSRF alias keys without changing effective behavior", () => {
    const res = normalizeCompatibilityConfigValues({
      browser: {
        ssrfPolicy: {
          allowPrivateNetwork: true,
          dangerouslyAllowPrivateNetwork: false,
        },
      },
    } as unknown as KaijiBotConfig);

    expect(
      (res.config.browser?.ssrfPolicy as Record<string, unknown> | undefined)?.allowPrivateNetwork,
    ).toBeUndefined();
    expect(res.config.browser?.ssrfPolicy?.dangerouslyAllowPrivateNetwork).toBe(true);
    expect(res.changes).toContain(
      "Moved browser.ssrfPolicy.allowPrivateNetwork → browser.ssrfPolicy.dangerouslyAllowPrivateNetwork (true).",
    );
  });

  it("migrates nano-banana skill config to native image generation config", () => {
    const res = normalizeCompatibilityConfigValues({
      skills: {
        entries: {
          "nano-banana-pro": {
            enabled: true,
            apiKey: { source: "env", provider: "default", id: "GEMINI_API_KEY" },
          },
        },
      },
    });

    expect(res.config.agents?.defaults?.imageGenerationModel).toEqual({
      primary: "google/gemini-3-pro-image-preview",
    });
    expect(res.config.models?.providers?.google?.apiKey).toEqual({
      source: "env",
      provider: "default",
      id: "GEMINI_API_KEY",
    });
    expect(res.config.models?.providers?.google?.baseUrl).toBe(
      "https://generativelanguage.googleapis.com/v1beta",
    );
    expect(res.config.models?.providers?.google?.models).toEqual([]);
    expect(res.config.skills?.entries).toBeUndefined();
    expect(res.changes).toEqual([
      "Moved skills.entries.nano-banana-pro → agents.defaults.imageGenerationModel.primary (google/gemini-3-pro-image-preview).",
      "Moved skills.entries.nano-banana-pro.apiKey → models.providers.google.apiKey.",
      "Removed legacy skills.entries.nano-banana-pro.",
    ]);
  });

  it("prefers legacy nano-banana env.GEMINI_API_KEY over skill apiKey during migration", () => {
    const res = normalizeCompatibilityConfigValues({
      skills: {
        entries: {
          "nano-banana-pro": {
            apiKey: "ignored-skill-api-key",
            env: {
              GEMINI_API_KEY: "env-gemini-key",
            },
          },
        },
      },
    });

    expect(res.config.models?.providers?.google?.apiKey).toBe("env-gemini-key");
    expect(res.config.models?.providers?.google?.baseUrl).toBe(
      "https://generativelanguage.googleapis.com/v1beta",
    );
    expect(res.config.models?.providers?.google?.models).toEqual([]);
    expect(res.changes).toContain(
      "Moved skills.entries.nano-banana-pro.env.GEMINI_API_KEY → models.providers.google.apiKey.",
    );
  });

  it("preserves explicit native config while removing legacy nano-banana skill config", () => {
    const res = normalizeCompatibilityConfigValues({
      agents: {
        defaults: {
          imageGenerationModel: {
            primary: "fal/fal-ai/flux/dev",
          },
        },
      },
      models: {
        providers: {
          google: {
            apiKey: "existing-google-key",
            baseUrl: "https://generativelanguage.googleapis.com",
            models: [],
          },
        },
      },
      skills: {
        entries: {
          "nano-banana-pro": {
            apiKey: "legacy-gemini-key",
          },
          peekaboo: { enabled: true },
        },
      },
    });

    expect(res.config.agents?.defaults?.imageGenerationModel).toEqual({
      primary: "fal/fal-ai/flux/dev",
    });
    expect(res.config.models?.providers?.google?.apiKey).toBe("existing-google-key");
    expect(res.config.skills?.entries).toEqual({
      peekaboo: { enabled: true },
    });
    expect(res.changes).toEqual(["Removed legacy skills.entries.nano-banana-pro."]);
  });

  it("removes nano-banana from skills.allowBundled during migration", () => {
    const res = normalizeCompatibilityConfigValues({
      skills: {
        allowBundled: ["peekaboo", "nano-banana-pro"],
      },
    });

    expect(res.config.skills?.allowBundled).toEqual(["peekaboo"]);
    expect(res.changes).toEqual(["Removed nano-banana-pro from skills.allowBundled."]);
  });

  // firecrawl is not a bundled web-search provider here, so its legacy scoped
  // config has no plugin-owned target and is not part of this migration.
  it("migrates legacy web search provider config to plugin-owned config paths", () => {
    const res = normalizeCompatibilityConfigValues({
      tools: {
        web: {
          search: {
            provider: "gemini",
            maxResults: 5,
            apiKey: "brave-key",
            gemini: {
              apiKey: "gemini-key",
              model: "gemini-2.5-flash",
            },
          },
        },
      },
    });

    expect(res.config.tools?.web?.search).toEqual({
      provider: "gemini",
      maxResults: 5,
    });
    expect(res.config.plugins?.entries?.brave).toEqual({
      enabled: true,
      config: {
        webSearch: {
          apiKey: "brave-key",
        },
      },
    });
    expect(res.config.plugins?.entries?.google).toEqual({
      enabled: true,
      config: {
        webSearch: {
          apiKey: "gemini-key",
          model: "gemini-2.5-flash",
        },
      },
    });
    expect(res.changes).toEqual([
      "Moved tools.web.search.apiKey → plugins.entries.brave.config.webSearch.apiKey.",
      "Moved tools.web.search.gemini → plugins.entries.google.config.webSearch.",
    ]);
  });

  it("merges legacy web search provider config into explicit plugin config without overriding it", () => {
    const res = normalizeCompatibilityConfigValues({
      tools: {
        web: {
          search: {
            provider: "gemini",
            gemini: {
              apiKey: "legacy-gemini-key",
              model: "legacy-model",
            },
          },
        },
      },
      plugins: {
        entries: {
          google: {
            enabled: true,
            config: {
              webSearch: {
                model: "explicit-model",
                baseUrl: "https://generativelanguage.googleapis.com",
              },
            },
          },
        },
      },
    });

    expect(res.config.tools?.web?.search).toEqual({
      provider: "gemini",
    });
    expect(res.config.plugins?.entries?.google).toEqual({
      enabled: true,
      config: {
        webSearch: {
          apiKey: "legacy-gemini-key",
          model: "explicit-model",
          baseUrl: "https://generativelanguage.googleapis.com",
        },
      },
    });
    expect(res.changes).toEqual([
      "Merged tools.web.search.gemini → plugins.entries.google.config.webSearch (filled missing fields from legacy; kept explicit plugin config values).",
    ]);
  });

  it("migrates legacy web fetch provider config to plugin-owned config paths", () => {
    const res = normalizeCompatibilityConfigValues({
      tools: {
        web: {
          fetch: {
            provider: "firecrawl",
            timeoutSeconds: 15,
            firecrawl: {
              apiKey: "firecrawl-key",
              baseUrl: "https://api.firecrawl.dev",
              onlyMainContent: false,
            },
          },
        },
      },
    } as KaijiBotConfig);

    expect(res.config.tools?.web?.fetch).toEqual({
      provider: "firecrawl",
      timeoutSeconds: 15,
    });
    expect(res.config.plugins?.entries?.firecrawl).toEqual({
      enabled: true,
      config: {
        webFetch: {
          apiKey: "firecrawl-key",
          baseUrl: "https://api.firecrawl.dev",
          onlyMainContent: false,
        },
      },
    });
    expect(res.changes).toEqual([
      "Moved tools.web.fetch.firecrawl → plugins.entries.firecrawl.config.webFetch.",
    ]);
  });

  it("keeps explicit plugin-owned web fetch config while filling missing legacy fields", () => {
    const res = normalizeCompatibilityConfigValues({
      tools: {
        web: {
          fetch: {
            provider: "firecrawl",
            firecrawl: {
              apiKey: "legacy-firecrawl-key",
              baseUrl: "https://api.firecrawl.dev",
              onlyMainContent: false,
            },
          },
        },
      },
      plugins: {
        entries: {
          firecrawl: {
            enabled: true,
            config: {
              webFetch: {
                apiKey: "explicit-firecrawl-key",
                timeoutSeconds: 30,
              },
            },
          },
        },
      },
    } as KaijiBotConfig);

    expect(res.config.plugins?.entries?.firecrawl).toEqual({
      enabled: true,
      config: {
        webFetch: {
          apiKey: "explicit-firecrawl-key",
          timeoutSeconds: 30,
          baseUrl: "https://api.firecrawl.dev",
          onlyMainContent: false,
        },
      },
    });
    expect(res.changes).toEqual([
      "Merged tools.web.fetch.firecrawl → plugins.entries.firecrawl.config.webFetch (filled missing fields from legacy; kept explicit plugin config values).",
    ]);
  });

  it("migrates legacy talk flat fields to provider/providers", () => {
    const res = normalizeCompatibilityConfigValues({
      talk: {
        voiceId: "voice-123",
        voiceAliases: {
          Clawd: "VoiceAlias1234567890",
        },
        modelId: "eleven_v3",
        outputFormat: "pcm_44100",
        apiKey: "secret-key",
        interruptOnSpeech: false,
        silenceTimeoutMs: 1500,
      },
    } as unknown as KaijiBotConfig);

    expect(res.config.talk).toEqual({
      providers: {
        elevenlabs: {
          voiceId: "voice-123",
          voiceAliases: {
            Clawd: "VoiceAlias1234567890",
          },
          modelId: "eleven_v3",
          outputFormat: "pcm_44100",
          apiKey: "secret-key",
        },
      },
      interruptOnSpeech: false,
      silenceTimeoutMs: 1500,
    });
    expect(res.changes).toEqual([
      "Normalized talk.provider/providers shape (trimmed provider ids and merged missing compatibility fields).",
    ]);
  });

  it("normalizes talk provider ids without overriding explicit provider config", () => {
    const res = normalizeCompatibilityConfigValues({
      talk: {
        provider: " elevenlabs ",
        providers: {
          " elevenlabs ": {
            voiceId: "voice-123",
          },
        },
        apiKey: "secret-key",
      },
    } as unknown as KaijiBotConfig);

    expect(res.config.talk).toEqual({
      provider: "elevenlabs",
      providers: {
        elevenlabs: {
          apiKey: "secret-key",
          voiceId: "voice-123",
        },
      },
    });
    expect(res.changes).toEqual([
      "Normalized talk.provider/providers shape (trimmed provider ids and merged missing compatibility fields).",
    ]);
  });

  it("does not report talk provider normalization for semantically identical key ordering differences", () => {
    const input = {
      talk: {
        interruptOnSpeech: true,
        silenceTimeoutMs: 1500,
        providers: {
          elevenlabs: {
            apiKey: "secret-key",
            voiceId: "voice-123",
            modelId: "eleven_v3",
          },
        },
        provider: "elevenlabs",
      },
    };

    const res = normalizeCompatibilityConfigValues(input);

    expect(res.config).toEqual(input);
    expect(res.changes).toEqual([]);
  });

  it("migrates tools.message.allowCrossContextSend to canonical crossContext settings", () => {
    const res = normalizeCompatibilityConfigValues({
      tools: {
        message: {
          allowCrossContextSend: true,
          crossContext: {
            allowWithinProvider: false,
            allowAcrossProviders: false,
          },
        },
      },
    });

    expect(res.config.tools?.message).toEqual({
      crossContext: {
        allowWithinProvider: true,
        allowAcrossProviders: true,
      },
    });
    expect(res.changes).toEqual([
      "Moved tools.message.allowCrossContextSend → tools.message.crossContext.allowWithinProvider/allowAcrossProviders (true).",
    ]);
  });

  it("migrates legacy deepgram media options to providerOptions.deepgram", () => {
    const res = normalizeCompatibilityConfigValues({
      tools: {
        media: {
          audio: {
            deepgram: {
              detectLanguage: true,
              smartFormat: true,
            },
            providerOptions: {
              deepgram: {
                punctuate: false,
              },
            },
            models: [
              {
                provider: "deepgram",
                deepgram: {
                  punctuate: true,
                },
              },
            ],
          },
          models: [
            {
              provider: "deepgram",
              deepgram: {
                smartFormat: false,
              },
              providerOptions: {
                deepgram: {
                  detect_language: true,
                },
              },
            },
          ],
        },
      },
    });

    expect(res.config.tools?.media?.audio).toEqual({
      providerOptions: {
        deepgram: {
          detect_language: true,
          smart_format: true,
          punctuate: false,
        },
      },
      models: [
        {
          provider: "deepgram",
          providerOptions: {
            deepgram: {
              punctuate: true,
            },
          },
        },
      ],
    });
    expect(res.config.tools?.media?.models).toEqual([
      {
        provider: "deepgram",
        providerOptions: {
          deepgram: {
            smart_format: false,
            detect_language: true,
          },
        },
      },
    ]);
    expect(res.changes).toEqual([
      "Merged tools.media.audio.deepgram → tools.media.audio.providerOptions.deepgram (filled missing canonical fields from legacy).",
      "Moved tools.media.audio.models[0].deepgram → tools.media.audio.models[0].providerOptions.deepgram.",
      "Merged tools.media.models[0].deepgram → tools.media.models[0].providerOptions.deepgram (filled missing canonical fields from legacy).",
    ]);
  });

  it("normalizes persisted mistral model maxTokens that matched the old context-sized defaults", () => {
    const res = normalizeCompatibilityConfigValues({
      models: {
        providers: {
          mistral: {
            baseUrl: "https://api.mistral.ai/v1",
            api: "openai-completions",
            models: [
              {
                id: "mistral-large-latest",
                name: "Mistral Large",
                reasoning: false,
                input: ["text", "image"],
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                contextWindow: 262144,
                maxTokens: 262144,
              },
              {
                id: "magistral-small",
                name: "Magistral Small",
                reasoning: true,
                input: ["text"],
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                contextWindow: 128000,
                maxTokens: 128000,
              },
            ],
          },
        },
      },
    });

    expect(res.config.models?.providers?.mistral?.models).toEqual([
      expect.objectContaining({
        id: "mistral-large-latest",
        maxTokens: 16384,
      }),
      expect.objectContaining({
        id: "magistral-small",
        maxTokens: 40000,
      }),
    ]);
    expect(res.changes).toEqual([
      "Normalized models.providers.mistral.models[0].maxTokens (262144 → 16384) to avoid Mistral context-window rejects.",
      "Normalized models.providers.mistral.models[1].maxTokens (128000 → 40000) to avoid Mistral context-window rejects.",
    ]);
  });
});
