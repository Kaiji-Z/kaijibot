// KaijiBot cognitive palette for CLI/UI theming.
// Blue-purple accent reflecting the cognitive AI identity.
export const KAIJIBOT_PALETTE = {
  accent: "#6C5CE7",
  accentBright: "#A29BFE",
  accentDim: "#4834D4",
  info: "#74B9FF",
  success: "#2FBF71",
  warn: "#FFB020",
  error: "#E23D2D",
  muted: "#8B8FA3",
} as const;

/** @deprecated Use KAIJIBOT_PALETTE instead. */
export const LOBSTER_PALETTE = KAIJIBOT_PALETTE;
