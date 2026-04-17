import chalk, { Chalk } from "chalk";
import { KAIJIBOT_PALETTE } from "./palette.js";

const hasForceColor =
  typeof process.env.FORCE_COLOR === "string" &&
  process.env.FORCE_COLOR.trim().length > 0 &&
  process.env.FORCE_COLOR.trim() !== "0";

const baseChalk = process.env.NO_COLOR && !hasForceColor ? new Chalk({ level: 0 }) : chalk;

const hex = (value: string) => baseChalk.hex(value);

export const theme = {
  accent: hex(KAIJIBOT_PALETTE.accent),
  accentBright: hex(KAIJIBOT_PALETTE.accentBright),
  accentDim: hex(KAIJIBOT_PALETTE.accentDim),
  info: hex(KAIJIBOT_PALETTE.info),
  success: hex(KAIJIBOT_PALETTE.success),
  warn: hex(KAIJIBOT_PALETTE.warn),
  error: hex(KAIJIBOT_PALETTE.error),
  muted: hex(KAIJIBOT_PALETTE.muted),
  heading: baseChalk.bold.hex(KAIJIBOT_PALETTE.accent),
  command: hex(KAIJIBOT_PALETTE.accentBright),
  option: hex(KAIJIBOT_PALETTE.warn),
} as const;

export const isRich = () => Boolean(baseChalk.level > 0);

export const colorize = (rich: boolean, color: (value: string) => string, value: string) =>
  rich ? color(value) : value;
