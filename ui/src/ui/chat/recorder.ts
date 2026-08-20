/**
 * Microphone recorder for voice input (dictation).
 *
 * Hold-to-talk on touch devices, click-toggle on desktop. Produces a Blob for
 * the gateway `stt.transcribe` RPC. Falls back to nothing when
 * MediaRecorder/getUserMedia are unavailable (caller then uses legacy
 * Web Speech STT where supported).
 */

const PREFERRED_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
];

export function isRecorderSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    navigator.mediaDevices?.getUserMedia != null &&
    typeof MediaRecorder !== "undefined"
  );
}

/**
 * True when the browser has MediaRecorder but withholds getUserMedia because
 * the page was opened over plain http on a non-localhost origin (e.g. phone
 * browsing a LAN gateway at http://192.168.x.x). Mic input is impossible there.
 */
export function isMicBlockedByInsecureOrigin(): boolean {
  if (typeof window === "undefined" || typeof MediaRecorder === "undefined") {
    return false;
  }
  if (window.isSecureContext) {
    return false;
  }
  return navigator?.mediaDevices?.getUserMedia == null;
}

export function pickRecorderMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") {
    return undefined;
  }
  for (const candidate of PREFERRED_MIME_TYPES) {
    try {
      if (MediaRecorder.isTypeSupported(candidate)) {
        return candidate;
      }
    } catch {
      // some browsers throw on unknown codecs — keep probing
    }
  }
  return undefined;
}

export type VoiceRecorderCallbacks = {
  onStart?: () => void;
  onStop?: () => void;
  onError?: (error: string) => void;
};

const MAX_RECORDING_MS = 60_000;

const MIC_ERROR_BY_NAME: Record<string, string> = {
  NotAllowedError:
    "Microphone permission denied — allow it via the site icon in the address bar",
  PermissionDeniedError:
    "Microphone permission denied — allow it via the site icon in the address bar",
  NotFoundError: "No microphone device found",
  OverconstrainedError: "No microphone device found",
  NotReadableError: "Microphone is in use by another application",
  SecurityError: "Microphone requires HTTPS or localhost access",
  AbortError: "Microphone access aborted",
};

function micErrorMessage(err: unknown): string {
  const name = (err as DOMException)?.name ?? "";
  return MIC_ERROR_BY_NAME[name] ?? "Microphone permission denied";
}

export class VoiceRecorder {
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];
  private stoppedAt = 0;
  private active = false;

  constructor(private callbacks: VoiceRecorderCallbacks = {}) {}

  private releaseStream(): void {
    for (const track of this.stream?.getTracks() ?? []) {
      track.stop();
    }
    this.stream = null;
    this.recorder = null;
  }

  get isActive(): boolean {
    return this.active;
  }

  async start(): Promise<boolean> {
    if (this.active) {
      return false;
    }
    if (!isRecorderSupported()) {
      this.callbacks.onError?.("Audio recording is not supported in this browser");
      return false;
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      this.callbacks.onError?.(micErrorMessage(err));
      return false;
    }
    const mimeType = pickRecorderMimeType();
    try {
      this.recorder = mimeType
        ? new MediaRecorder(this.stream, { mimeType })
        : new MediaRecorder(this.stream);
    } catch {
      this.releaseStream();
      this.callbacks.onError?.("Audio recorder failed to start");
      return false;
    }
    this.chunks = [];
    this.recorder.addEventListener("dataavailable", (event: BlobEvent) => {
      if (event.data.size > 0) {
        this.chunks.push(event.data);
      }
    });
    this.active = true;
    this.recorder.start(250);
    this.callbacks.onStart?.();
    return true;
  }

  /** Stop recording and resolve the captured audio, or null when nothing was captured. */
  async stop(): Promise<Blob | null> {
    if (!this.active || !this.recorder) {
      return null;
    }
    const blob = await new Promise<Blob | null>((resolve) => {
      const recorder = this.recorder;
      if (!recorder) {
        resolve(null);
        return;
      }
      const finalize = () => {
        const type = recorder.mimeType || this.chunks[0]?.type || "audio/webm";
        resolve(this.chunks.length > 0 ? new Blob(this.chunks, { type }) : null);
      };
      recorder.addEventListener("stop", finalize);
      recorder.addEventListener("error", () => finalize());
      try {
        recorder.stop();
      } catch {
        finalize();
      }
    });
    this.stoppedAt = Date.now();
    this.active = false;
    this.releaseStream();
    this.callbacks.onStop?.();
    return blob;
  }

  /** Discard the recording without producing audio. */
  async cancel(): Promise<void> {
    if (!this.active) {
      return;
    }
    if (this.recorder && this.recorder.state !== "inactive") {
      this.recorder.stop();
    }
    this.active = false;
    this.releaseStream();
    this.callbacks.onStop?.();
  }

  /** True when the last stop happened within the auto-stop window (≥60s). */
  get hitAutoStop(): boolean {
    return this.stoppedAt > 0 && Date.now() - this.stoppedAt < 5_000;
  }
}

export function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export const RECORDING_MAX_MS = MAX_RECORDING_MS;

export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
