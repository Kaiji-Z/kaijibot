/**
 * High-level runtime resolver for inbound channel access decisions.
 *
 * Channel plugins should use this subpath for new receive paths. It accepts
 * platform facts, raw allowlists, route descriptors, command facts, and access
 * group config, then returns sender/route/command/activation projections plus
 * the ordered ingress graph.
 *
 * NOTE: KaijiBot does not yet have the channels/message-access subsystem
 * ported from upstream. The types are declared here for compilation
 * compatibility; function calls will throw at runtime until the subsystem
 * is ported.
 */

// -- Types --

export type ChannelIngressIdentifierKind =
  | "userId"
  | "groupId"
  | "channelId"
  | "email"
  | "phone"
  | "username"
  | "displayName";

export type ChannelIngressIdentityField = {
  kind: ChannelIngressIdentifierKind;
  value: string;
  normalized?: string;
};

export type ChannelIngressIdentityAlias = {
  kind: ChannelIngressIdentifierKind;
  value: string;
};

export type ChannelIngressIdentitySubjectInput = {
  primary: ChannelIngressIdentityField;
  aliases?: ChannelIngressIdentityAlias[];
};

export type ChannelIngressIdentityDescriptor = {
  stableId: string;
  subjects: ChannelIngressIdentitySubjectInput[];
};

export type AccessGroupMembershipFact = {
  groupId: string;
  memberId: string;
};

export type ChannelIngressAccessGroupMembershipResolver = {
  resolve: (identity: ChannelIngressIdentityDescriptor) => AccessGroupMembershipFact[] | Promise<AccessGroupMembershipFact[]>;
};

export type ChannelIngressPolicyInput = {
  allowFrom?: string[];
  denyFrom?: string[];
  requireMention?: boolean;
};

export type ChannelIngressRouteDescriptor = {
  routeId: string;
  sessionKey: string;
  agentId?: string;
};

export type ChannelIngressEventInput = {
  text: string;
  isMentioned: boolean;
  isDm: boolean;
};

export type ChannelIngressStateInput = {
  isPaused?: boolean;
};

export type ChannelIngressConfigInput = {
  policy: ChannelIngressPolicyInput;
};

export type ChannelIngressCommandPresetInput = {
  prefix?: string;
  commands?: string[];
};

export type ChannelIngressEventPresetInput = {
  requireMention?: boolean;
};

export type ChannelIngressRouteAccess = {
  allowed: boolean;
  reason: string;
};

export type IngressReasonCode =
  | "allowed"
  | "denied_policy"
  | "denied_not_mentioned"
  | "denied_paused"
  | "denied_allowlist"
  | "denied_denylist";

export type ChannelIngressDecision = {
  allowed: boolean;
  reason: IngressReasonCode;
  route?: ChannelIngressRouteAccess;
};

export type ChannelIngressState = {
  decision: ChannelIngressDecision;
};

export type ChannelMessageIngressCommandInput = {
  command?: string;
  args?: string;
};

export type ResolveChannelMessageIngressParams = {
  identity: ChannelIngressIdentityDescriptor;
  route: ChannelIngressRouteDescriptor;
  event: ChannelIngressEventInput;
  config: ChannelIngressConfigInput;
  state?: ChannelIngressStateInput;
  accessGroups?: ChannelIngressAccessGroupMembershipResolver;
};

export type ResolvedChannelMessageIngress = {
  allowed: boolean;
  decision: ChannelIngressDecision;
  identity: ChannelIngressIdentityDescriptor;
  route: ChannelIngressRouteDescriptor;
};

export type ResolveStableChannelMessageIngressParams = ResolveChannelMessageIngressParams & {
  stableIdentity: StableChannelIngressIdentityParams;
};

export type StableChannelIngressIdentityParams = {
  stableId: string;
};

export type ChannelIngressResolver = {
  resolve: (params: ResolveChannelMessageIngressParams) => Promise<ResolvedChannelMessageIngress>;
};

export type ChannelIngressResolverMessageParams = ResolveChannelMessageIngressParams;

export type CreateChannelIngressResolverParams = {
  config: ChannelIngressConfigInput;
  accessGroups?: ChannelIngressAccessGroupMembershipResolver;
};

// -- Runtime stubs --

function throwNotPorted(name: string): never {
  throw new Error(
    `Channel ingress subsystem not yet ported to KaijiBot: ${name}. ` +
      `The channels/message-access module from upstream has not been ported.`,
  );
}

export function createChannelIngressResolver(_params: CreateChannelIngressResolverParams): ChannelIngressResolver {
  throwNotPorted("createChannelIngressResolver");
}

export function defineStableChannelIngressIdentity(_params: StableChannelIngressIdentityParams): ChannelIngressIdentityDescriptor {
  throwNotPorted("defineStableChannelIngressIdentity");
}

export function resolveChannelMessageIngress(_params: ResolveChannelMessageIngressParams): Promise<ResolvedChannelMessageIngress> {
  throwNotPorted("resolveChannelMessageIngress");
}

export function resolveStableChannelMessageIngress(_params: ResolveStableChannelMessageIngressParams): Promise<ResolvedChannelMessageIngress> {
  throwNotPorted("resolveStableChannelMessageIngress");
}

export function channelIngressRoutes(): never {
  throwNotPorted("channelIngressRoutes");
}

export function readChannelIngressStoreAllowFromForDmPolicy(): never {
  throwNotPorted("readChannelIngressStoreAllowFromForDmPolicy");
}
