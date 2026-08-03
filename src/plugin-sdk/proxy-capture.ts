// Minimal proxy-capture SDK surface for channel plugins that optional depend
// on debug proxy capture. KaijiBot does not ship the upstream debug proxy
// capture subsystem, so these helpers are no-op stubs that preserve the
// upstream API shape. Set KAIJIBOT_DEBUG_PROXY_ENABLED=1 to opt-in; behavior
// remains a no-op until a capture subsystem is ported.

export type DebugProxySettings = {
  enabled: boolean;
  required: boolean;
  proxyUrl?: string;
  dbPath: string;
  blobDir: string;
  certDir: string;
  sessionId: string;
  sourceProcess: string;
};

export const KAIJIBOT_DEBUG_PROXY_ENABLED = "KAIJIBOT_DEBUG_PROXY_ENABLED";
export const KAIJIBOT_DEBUG_PROXY_URL = "KAIJIBOT_DEBUG_PROXY_URL";

function isTruthy(value: string | undefined): boolean {
  return value !== undefined && !/^(?:0|false)$/iu.test(value.trim());
}

export function resolveDebugProxySettings(
  env: NodeJS.ProcessEnv = process.env,
): DebugProxySettings {
  return {
    enabled: isTruthy(env[KAIJIBOT_DEBUG_PROXY_ENABLED]),
    required: isTruthy(env[KAIJIBOT_DEBUG_PROXY_ENABLED]),
    proxyUrl: env[KAIJIBOT_DEBUG_PROXY_URL]?.trim() || undefined,
    dbPath: "",
    blobDir: "",
    certDir: "",
    sessionId: "",
    sourceProcess: "kaijibot",
  };
}

export function resolveEffectiveDebugProxyUrl(configuredProxyUrl?: string): string | undefined {
  const explicit = configuredProxyUrl?.trim();
  if (explicit) {
    return explicit;
  }
  const settings = resolveDebugProxySettings();
  return settings.enabled ? settings.proxyUrl : undefined;
}

export function createDebugProxyWebSocketAgent(): undefined {
  return undefined;
}

export function isDebugProxyGlobalFetchPatchInstalled(): boolean {
  return false;
}

export function captureHttpExchange(_params: {
  url: string;
  method: string;
  requestHeaders?: Headers | Record<string, string> | undefined;
  requestBody?: BodyInit | Buffer | string | null;
  response: Response;
  transport?: "http" | "sse";
  flowId?: string;
  meta?: Record<string, unknown>;
}): void {
  // No-op stub. KaijiBot does not yet ship a debug proxy capture subsystem.
}

export function captureWsEvent(_params: {
  url: string;
  direction: "send" | "receive";
  event: string;
  payload?: unknown;
  meta?: Record<string, unknown>;
}): void {
  // No-op stub.
}

export type CaptureEventRecord = {
  id: string;
  sessionId: string;
  url: string;
  method: string;
  status: number | null;
  flowId: string | null;
  recordedAt: string;
};

export type CaptureQueryPreset = {
  sessionId?: string;
  urlContains?: string;
  limit?: number;
};

export type CaptureQueryRow = CaptureEventRecord;

export type CaptureSessionSummary = {
  sessionId: string;
  eventCount: number;
  startedAt: string;
  lastEventAt: string;
};

export class DebugProxyCaptureStore {
  listEvents(): CaptureQueryRow[] {
    return [];
  }
  listSessions(): CaptureSessionSummary[] {
    return [];
  }
}

export function getDebugProxyCaptureStore(): DebugProxyCaptureStore {
  return new DebugProxyCaptureStore();
}
