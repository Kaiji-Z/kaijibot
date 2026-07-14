// Shared provider-facing HTTP helpers. Keep generic transport utilities here so
// capability SDKs do not depend on each other.

export {
  assertOkOrThrowHttpError,
  fetchWithTimeout,
  fetchWithTimeoutGuarded,
  normalizeBaseUrl,
  postJsonRequest,
  postTranscriptionRequest,
  resolveProviderHttpRequestConfig,
  requireTranscriptionText,
} from "../media-understanding/shared.js";
export type {
  ProviderAttributionPolicy,
  ProviderRequestCapabilities,
  ProviderRequestCapabilitiesInput,
  ProviderRequestCompatibilityFamily,
  ProviderEndpointClass,
  ProviderEndpointResolution,
  ProviderRequestCapability,
  ProviderRequestPolicyInput,
  ProviderRequestPolicyResolution,
  ProviderRequestTransport,
} from "../agents/provider-attribution.js";
export type {
  ProviderRequestAuthOverride,
  ProviderRequestProxyOverride,
  ProviderRequestTlsOverride,
  ProviderRequestTransportOverrides,
} from "../agents/provider-request-config.js";
export {
  resolveProviderEndpoint,
  resolveProviderRequestCapabilities,
  resolveProviderRequestPolicy,
} from "../agents/provider-attribution.js";

export function createProviderOperationDeadline(): { deadline: number } {
  return { deadline: Date.now() + 300_000 };
}
export function resolveProviderOperationTimeoutMs(): number {
  return 300_000;
}
export function sanitizeConfiguredModelProviderRequest<T>(req: T): T {
  return req;
}
export function waitProviderOperationPollInterval(): Promise<void> {
  return Promise.resolve();
}
export function createProviderOperationTimeoutResolver(): () => number {
  return () => 300_000;
}
export async function fetchProviderDownloadResponse(): Promise<Response> {
  throw new Error("not implemented in this build");
}
export async function pollProviderOperationJson(): Promise<unknown> {
  throw new Error("not implemented in this build");
}
