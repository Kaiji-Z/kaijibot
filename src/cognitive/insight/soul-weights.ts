/**
 * SOUL personality weight modifiers.
 *
 * Maps the 16 MBTI personality presets (see `src/cli/soul-presets/{type}.md`) into
 * four MBTI groups and assigns per-group weight modifiers for the different kinds of
 * proactive insight content the cognitive layer can produce.
 *
 * This module is the prep layer for future message-type-aware weighting. For now it
 * only exposes pure data + resolvers; it is NOT wired into the mode-selection logic
 * (that is tracked as future work).
 */

export type SoulGroup = "analysts" | "diplomats" | "sentinels" | "explorers";

export const MBTI_TO_GROUP: Record<string, SoulGroup> = {
  intj: "analysts",
  intp: "analysts",
  entj: "analysts",
  entp: "analysts",
  infj: "diplomats",
  infp: "diplomats",
  enfj: "diplomats",
  enfp: "diplomats",
  istj: "sentinels",
  isfj: "sentinels",
  estj: "sentinels",
  esfj: "sentinels",
  istp: "explorers",
  isfp: "explorers",
  estp: "explorers",
  esfp: "explorers",
};

export type SoulWeightModifier = {
  observation: number;
  discovery: number;
  connection: number;
  fragment: number;
  question: number;
};

export const SOUL_GROUP_WEIGHTS: Record<SoulGroup, SoulWeightModifier> = {
  analysts: { observation: 1.3, discovery: 1.2, connection: 0.8, fragment: 0.8, question: 1.0 },
  diplomats: { observation: 0.8, discovery: 0.9, connection: 1.3, fragment: 1.2, question: 1.1 },
  sentinels: { observation: 1.1, discovery: 1.2, connection: 0.9, fragment: 1.0, question: 0.8 },
  explorers: { observation: 0.9, discovery: 0.8, connection: 1.0, fragment: 1.3, question: 1.2 },
};

export function resolveSoulGroup(mbtiType?: string): SoulGroup | undefined {
  if (!mbtiType) {
    return undefined;
  }
  return MBTI_TO_GROUP[mbtiType.toLowerCase()] ?? undefined;
}

export function resolveSoulWeightModifier(mbtiType?: string): SoulWeightModifier | undefined {
  const group = resolveSoulGroup(mbtiType);
  if (!group) {
    return undefined;
  }
  return SOUL_GROUP_WEIGHTS[group];
}
