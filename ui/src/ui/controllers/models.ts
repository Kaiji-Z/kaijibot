import type { GatewayBrowserClient } from "../gateway.ts";
import type { ModelCatalogEntry, ProviderAuthInfo } from "../types.ts";

export async function loadModels(
  client: GatewayBrowserClient,
  opts?: { fullCatalog?: boolean },
): Promise<ModelCatalogEntry[]> {
  try {
    const result = await client.request<{ models: ModelCatalogEntry[] }>("models.list", {
      fullCatalog: opts?.fullCatalog ?? false,
    });
    return result?.models ?? [];
  } catch {
    return [];
  }
}

export async function loadProviderStatus(
  client: GatewayBrowserClient,
): Promise<string[]> {
  try {
    const result = await client.request<{ providers: string[] }>(
      "auth.listProviderStatus",
      {},
    );
    return result?.providers ?? [];
  } catch {
    return [];
  }
}

export async function loadProviderAuthOptions(
  client: GatewayBrowserClient,
): Promise<ProviderAuthInfo[]> {
  try {
    const result = await client.request<{ providers: ProviderAuthInfo[] }>(
      "auth.listProviderAuthOptions",
      {},
    );
    return result?.providers ?? [];
  } catch {
    return [];
  }
}
