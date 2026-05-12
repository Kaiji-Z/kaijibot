export const SOUL_PRESETS = [
  "intj",
  "intp",
  "entj",
  "entp",
  "infj",
  "infp",
  "enfj",
  "enfp",
  "istj",
  "isfj",
  "estj",
  "esfj",
  "istp",
  "isfp",
  "estp",
  "esfp",
] as const;

export type SoulPreset = (typeof SOUL_PRESETS)[number];

export type SoulConfig = {
  /** Active soul preset (MBTI type key). When set, overrides SOUL.md with preset content. */
  preset?: SoulPreset;
};
