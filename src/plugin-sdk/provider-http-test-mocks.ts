import { afterEach, vi, type Mock } from "vitest";

type AnyMock = Mock<(...args: unknown[]) => unknown>;

interface ProviderHttpMocks {
  resolveApiKeyForProviderMock: Mock<() => Promise<{ apiKey: string }>>;
  postJsonRequestMock: AnyMock;
  fetchWithTimeoutMock: AnyMock;
  fetchWithTimeoutGuardedMock: AnyMock;
  assertOkOrThrowHttpErrorMock: Mock<(response: Response, label: string) => Promise<void>>;
  resolveProviderHttpRequestConfigMock: AnyMock;
}

const providerHttpMocks = vi.hoisted(() => ({
  resolveApiKeyForProviderMock: vi.fn(async () => ({ apiKey: "provider-key" })),
  postJsonRequestMock: vi.fn(),
  fetchWithTimeoutMock: vi.fn(),
  fetchWithTimeoutGuardedMock: vi.fn(),
  assertOkOrThrowHttpErrorMock: vi.fn(async (_response: Response, _label: string) => {}),
  resolveProviderHttpRequestConfigMock: vi.fn((...args: unknown[]) => ({
    baseUrl: "",
    allowPrivateNetwork: false,
    headers: new Headers(),
    dispatcherPolicy: undefined,
  })),
}));

providerHttpMocks.fetchWithTimeoutGuardedMock.mockImplementation(async (...args: unknown[]) => {
  const [url, init, timeoutMs, fetchFn] = args as [string, unknown?, number?, typeof fetch?];
  const response = await providerHttpMocks.fetchWithTimeoutMock(
    url,
    init ?? {},
    timeoutMs ?? 60_000,
    fetchFn,
  );
  return {
    response,
    finalUrl: url,
    release: async () => {},
  };
});

vi.mock("kaijibot/plugin-sdk/provider-auth-runtime", () => ({
  resolveApiKeyForProvider: providerHttpMocks.resolveApiKeyForProviderMock,
}));

vi.mock("kaijibot/plugin-sdk/provider-http", () => ({
  assertOkOrThrowHttpError: providerHttpMocks.assertOkOrThrowHttpErrorMock,
  fetchWithTimeout: providerHttpMocks.fetchWithTimeoutMock,
  fetchWithTimeoutGuarded: providerHttpMocks.fetchWithTimeoutGuardedMock,
  normalizeBaseUrl: (url: string) => url,
  postJsonRequest: providerHttpMocks.postJsonRequestMock,
  resolveProviderHttpRequestConfig: providerHttpMocks.resolveProviderHttpRequestConfigMock,
}));

export function getProviderHttpMocks(): ProviderHttpMocks {
  return providerHttpMocks;
}

export function installProviderHttpMockCleanup(): void {
  afterEach(() => {
    providerHttpMocks.resolveApiKeyForProviderMock.mockClear();
    providerHttpMocks.postJsonRequestMock.mockReset();
    providerHttpMocks.fetchWithTimeoutMock.mockReset();
    providerHttpMocks.fetchWithTimeoutGuardedMock.mockClear();
    providerHttpMocks.assertOkOrThrowHttpErrorMock.mockClear();
    providerHttpMocks.resolveProviderHttpRequestConfigMock.mockClear();
  });
}
