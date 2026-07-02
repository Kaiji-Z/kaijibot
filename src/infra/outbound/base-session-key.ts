import type { KaijiBotConfig } from "../../config/config.js";
import { buildAgentSessionKey, type RoutePeer } from "../../routing/resolve-route.js";
import { resolveEffectiveDmScope } from "../../routing/session-key.js";

export function buildOutboundBaseSessionKey(params: {
  cfg: KaijiBotConfig;
  agentId: string;
  channel: string;
  accountId?: string | null;
  peer: RoutePeer;
}): string {
  return buildAgentSessionKey({
    agentId: params.agentId,
    channel: params.channel,
    accountId: params.accountId,
    peer: params.peer,
    dmScope: resolveEffectiveDmScope(params.cfg),
    identityLinks: params.cfg.session?.identityLinks,
  });
}
