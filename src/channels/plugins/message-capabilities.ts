export const CHANNEL_MESSAGE_CAPABILITIES = [
  "interactive",
  "buttons",
  "cards",
  "components",
  "blocks",
  "delivery-pin",
  "presentation",
] as const;

export type ChannelMessageCapability = (typeof CHANNEL_MESSAGE_CAPABILITIES)[number];
