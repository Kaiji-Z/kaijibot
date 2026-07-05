import { resolveNodeService } from "../daemon/node-service.js";
import { tryResolveGatewayService } from "../daemon/service.js";
import { formatDaemonRuntimeShort } from "./status.format.js";
import { readServiceStatusSummary } from "./status.service-summary.js";

type DaemonStatusSummary = {
  label: string;
  installed: boolean | null;
  loaded: boolean;
  managedByKaijiBot: boolean;
  externallyManaged: boolean;
  loadedText: string;
  runtime: Awaited<ReturnType<typeof readServiceStatusSummary>>["runtime"];
  runtimeShort: string | null;
};

async function buildDaemonStatusSummary(
  serviceLabel: "gateway" | "node",
): Promise<DaemonStatusSummary | null> {
  if (serviceLabel === "gateway") {
    const service = tryResolveGatewayService();
    if (!service) {
      return null;
    }
    const summary = await readServiceStatusSummary(service, "Daemon");
    return {
      label: summary.label,
      installed: summary.installed,
      loaded: summary.loaded,
      managedByKaijiBot: summary.managedByKaijiBot,
      externallyManaged: summary.externallyManaged,
      loadedText: summary.loadedText,
      runtime: summary.runtime,
      runtimeShort: formatDaemonRuntimeShort(summary.runtime),
    };
  }
  const service = resolveNodeService();
  if (!service) {
    return null;
  }
  const fallbackLabel = "Node";
  const summary = await readServiceStatusSummary(service, fallbackLabel);
  return {
    label: summary.label,
    installed: summary.installed,
    loaded: summary.loaded,
    managedByKaijiBot: summary.managedByKaijiBot,
    externallyManaged: summary.externallyManaged,
    loadedText: summary.loadedText,
    runtime: summary.runtime,
    runtimeShort: formatDaemonRuntimeShort(summary.runtime),
  };
}

export async function getDaemonStatusSummary(): Promise<DaemonStatusSummary | null> {
  return await buildDaemonStatusSummary("gateway");
}

export async function getNodeDaemonStatusSummary(): Promise<DaemonStatusSummary | null> {
  return await buildDaemonStatusSummary("node");
}
