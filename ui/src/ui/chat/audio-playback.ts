/**
 * Read-aloud playback: gateway TTS first (natural server voices), browser
 * SpeechSynthesis as fallback when the gateway cannot serve audio.
 *
 * Playback goes through a WebAudio AudioContext. The context is resumed
 * synchronously inside the click gesture; a resumed context stays unlocked
 * for the rest of the page lifetime, so synthesis latency of any length
 * cannot trip browser autoplay policies (unlike <audio> element playback,
 * which only plays within the ~5s transient-activation window).
 *
 * A session token guards cancellation: stop() invalidates the current session
 * so in-flight RPC results and fallback speech are discarded instead of
 * leaving the button stuck in the active state.
 */

import type { GatewayBrowserClient } from "../gateway.js";
import { isTtsSupported, speakText, stopTts } from "./speech.js";

let gatewayClient: GatewayBrowserClient | null = null;
let audioContext: AudioContext | null = null;
let currentSource: AudioBufferSourceNode | null = null;
let currentSourceAbort: AbortController | null = null;
let sessionToken = 0;
let sessionActive = false;

export function setGatewayAudioClient(client: GatewayBrowserClient | null): void {
  gatewayClient = client;
}

export function stopGatewayAudio(): void {
  sessionToken += 1;
  sessionActive = false;
  if (currentSource) {
    currentSourceAbort?.abort();
    try {
      currentSource.stop();
    } catch {
      // already stopped
    }
    currentSource = null;
    currentSourceAbort = null;
  }
  if (isTtsSupported()) {
    stopTts();
  }
}

export function isGatewayAudioSpeaking(): boolean {
  return sessionActive;
}

type GatewayTtsResponse = {
  audioBase64?: string;
  outputFormat?: string;
};

function getAudioContextCtor(): (new () => AudioContext) | null {
  const w = globalThis as Record<string, unknown>;
  const ctor = w.AudioContext ?? w.webkitAudioContext;
  return typeof ctor === "function" ? (ctor as new () => AudioContext) : null;
}

async function unlockAudioContext(): Promise<AudioContext | null> {
  const ctor = getAudioContextCtor();
  if (!ctor) {
    return null;
  }
  if (!audioContext) {
    audioContext = new ctor();
  }
  try {
    await audioContext.resume();
  } catch {
    return null;
  }
  return audioContext.state === "running" ? audioContext : null;
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export type SpeakOptions = {
  onStart?: () => void;
  onEnd?: () => void;
  onError?: (error: string) => void;
};

/**
 * Speak text via gateway `tts.convert`; fall back to browser speech synthesis
 * when the RPC fails, audio cannot be decoded, or no audio context is
 * available. Resolves when the speech finishes, is stopped, or fails.
 */
export async function speakViaGatewayOrBrowser(
  text: string,
  opts: SpeakOptions = {},
): Promise<void> {
  const cleaned = text.replace(/```[\s\S]*?```/g, "").trim();
  if (!cleaned) {
    return;
  }
  stopGatewayAudio();
  const token = ++sessionToken;

  if (!gatewayClient) {
    speakViaBrowser(cleaned, opts, token);
    return;
  }
  const context = await unlockAudioContext();
  if (token !== sessionToken) {
    return;
  }
  if (!context) {
    speakViaBrowser(cleaned, opts, token);
    return;
  }
  try {
    const response = await gatewayClient.request<GatewayTtsResponse>("tts.convert", {
      text: cleaned,
      includeAudio: true,
    });
    if (token !== sessionToken) {
      return;
    }
    if (!response.audioBase64) {
      throw new Error("tts.convert returned no audio");
    }
    const buffer = await context.decodeAudioData(
      base64ToUint8Array(response.audioBase64).buffer as ArrayBuffer,
    );
    if (token !== sessionToken) {
      return;
    }
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    currentSource = source;
    const abort = new AbortController();
    currentSourceAbort = abort;
    sessionActive = true;
    opts.onStart?.();
    let started = false;
    await new Promise<void>((resolve) => {
      source.addEventListener(
        "ended",
        () => {
          started = true;
          resolve();
        },
        { signal: abort.signal },
      );
      try {
        source.start();
        started = true;
      } catch {
        resolve();
      }
    });
    if (token !== sessionToken) {
      return;
    }
    currentSource = null;
    sessionActive = false;
    if (started) {
      opts.onEnd?.();
      return;
    }
    speakViaBrowser(cleaned, opts, token);
  } catch {
    if (token !== sessionToken) {
      return;
    }
    currentSource = null;
    sessionActive = false;
    speakViaBrowser(cleaned, opts, token);
  }
}

function speakViaBrowser(text: string, opts: SpeakOptions, token: number): void {
  const started = speakText(text, {
    onStart: () => {
      if (token === sessionToken) {
        sessionActive = true;
        opts.onStart?.();
      }
    },
    onEnd: () => {
      if (token === sessionToken) {
        sessionActive = false;
        opts.onEnd?.();
      }
    },
    onError: () => {
      if (token === sessionToken) {
        sessionActive = false;
        opts.onError?.("speech failed");
      }
    },
  });
  if (!started) {
    sessionActive = false;
    opts.onError?.("speech not supported");
  }
}
