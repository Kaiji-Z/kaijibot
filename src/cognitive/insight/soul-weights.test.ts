import { describe, expect, it } from "vitest";
import {
  MBTI_TO_GROUP,
  SOUL_GROUP_WEIGHTS,
  resolveSoulGroup,
  resolveSoulWeightModifier,
  type SoulGroup,
} from "./soul-weights.js";

const ALL_SIXTEEN = [
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

const EXPECTED_GROUP: Record<(typeof ALL_SIXTEEN)[number], SoulGroup> = {
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

const WEIGHT_KEYS: Array<keyof typeof SOUL_GROUP_WEIGHTS.analysts> = [
  "observation",
  "discovery",
  "connection",
  "fragment",
  "question",
];

describe("soul-weights: MBTI_TO_GROUP mapping", () => {
  it("maps all 16 MBTI types to a group", () => {
    for (const t of ALL_SIXTEEN) {
      expect(MBTI_TO_GROUP[t]).toBeDefined();
    }
  });

  it("maps every type to the expected group", () => {
    for (const t of ALL_SIXTEEN) {
      expect(MBTI_TO_GROUP[t]).toBe(EXPECTED_GROUP[t]);
    }
  });

  it("analysts group contains exactly the 4 NT types", () => {
    const analysts = ALL_SIXTEEN.filter((t) => MBTI_TO_GROUP[t] === "analysts");
    expect(analysts).toEqual(["intj", "intp", "entj", "entp"]);
  });

  it("diplomats group contains exactly the 4 NF types", () => {
    const diplomats = ALL_SIXTEEN.filter((t) => MBTI_TO_GROUP[t] === "diplomats");
    expect(diplomats).toEqual(["infj", "infp", "enfj", "enfp"]);
  });

  it("sentinels group contains exactly the 4 SJ types", () => {
    const sentinels = ALL_SIXTEEN.filter((t) => MBTI_TO_GROUP[t] === "sentinels");
    expect(sentinels).toEqual(["istj", "isfj", "estj", "esfj"]);
  });

  it("explorers group contains exactly the 4 SP types", () => {
    const explorers = ALL_SIXTEEN.filter((t) => MBTI_TO_GROUP[t] === "explorers");
    expect(explorers).toEqual(["istp", "isfp", "estp", "esfp"]);
  });
});

describe("soul-weights: resolveSoulGroup", () => {
  it('resolveSoulGroup("intj") returns "analysts"', () => {
    expect(resolveSoulGroup("intj")).toBe("analysts");
  });

  it('resolveSoulGroup("enfp") returns "diplomats"', () => {
    expect(resolveSoulGroup("enfp")).toBe("diplomats");
  });

  it("resolveSoulGroup(undefined) returns undefined", () => {
    expect(resolveSoulGroup(undefined)).toBeUndefined();
  });

  it('resolveSoulGroup("unknown") returns undefined', () => {
    expect(resolveSoulGroup("unknown")).toBeUndefined();
  });

  it("is case-insensitive (uppercase input)", () => {
    expect(resolveSoulGroup("INTJ")).toBe("analysts");
    expect(resolveSoulGroup("Enfp")).toBe("diplomats");
    expect(resolveSoulGroup("ESTP")).toBe("explorers");
    expect(resolveSoulGroup("isfJ")).toBe("sentinels");
  });
});

describe("soul-weights: SOUL_GROUP_WEIGHTS", () => {
  const GROUPS: SoulGroup[] = ["analysts", "diplomats", "sentinels", "explorers"];

  it("each group has all 5 weight keys", () => {
    for (const g of GROUPS) {
      const weights = SOUL_GROUP_WEIGHTS[g];
      for (const key of WEIGHT_KEYS) {
        expect(weights, `${g}.${key} should be defined`).toBeDefined();
        expect(typeof weights[key]).toBe("number");
      }
    }
  });

  it("every weight value is a positive finite number", () => {
    for (const g of GROUPS) {
      for (const key of WEIGHT_KEYS) {
        const v = SOUL_GROUP_WEIGHTS[g][key];
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThan(0);
      }
    }
  });
});

describe("soul-weights: resolveSoulWeightModifier", () => {
  it("returns the group weights for a known MBTI type", () => {
    expect(resolveSoulWeightModifier("intj")).toEqual(SOUL_GROUP_WEIGHTS.analysts);
    expect(resolveSoulWeightModifier("enfp")).toEqual(SOUL_GROUP_WEIGHTS.diplomats);
  });

  it("returns undefined for undefined input", () => {
    expect(resolveSoulWeightModifier(undefined)).toBeUndefined();
  });

  it("returns undefined for unknown MBTI type", () => {
    expect(resolveSoulWeightModifier("unknown")).toBeUndefined();
  });
});
