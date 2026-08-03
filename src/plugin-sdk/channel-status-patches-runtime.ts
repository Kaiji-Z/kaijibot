// Gateway channel-status patch helpers exposed via the plugin SDK.
//
// KaijiBot's `src/gateway/channel-status-patches.ts` ships the connected
// patch helper. The transport-activity patch lives here so plugin SDK
// consumers (e.g. channel plugins that report polling/transport liveness)
// can build the same patch shape without reaching into host internals.

export type ConnectedChannelStatusPatch = {
  connected: true;
  lastConnectedAt: number;
  lastEventAt: number;
};

export type TransportActivityChannelStatusPatch = {
  lastTransportActivityAt: number;
};

export {
  createConnectedChannelStatusPatch,
} from "../gateway/channel-status-patches.js";
export type { ConnectedChannelStatusPatch as _HostConnectedChannelStatusPatch } from "../gateway/channel-status-patches.js";

export function createTransportActivityStatusPatch(
  at: number = Date.now(),
): TransportActivityChannelStatusPatch {
  return {
    lastTransportActivityAt: at,
  };
}
