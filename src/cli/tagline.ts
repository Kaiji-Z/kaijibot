const DEFAULT_TAGLINE = "认知驱动，主动思考。";
export type TaglineMode = "random" | "default" | "off";

const HOLIDAY_TAGLINES = {
  newYear:
    "新年新认知——愿你的思维模型持续迭代，偏差逐年缩小。",
  lunarNewYear:
    "春节快乐——愿你的知识图谱像烟花一样绚烂，洞察力像红包一样丰厚。",
  christmas:
    "圣诞快乐——愿每个想法都像圣诞树上的灯，串联起来照亮整个思维空间。",
  eid:
    "开斋节吉庆——愿你的认知边界不断扩展，像晨光一样温暖而开阔。",
  diwali:
    "排灯节快乐——愿知识的灯火驱散无知的黑暗，照亮每一条思维路径。",
  easter:
    "复活节快乐——愿你不断发现隐藏的认知彩蛋，每一次探索都有意外收获。",
  hanukkah:
    "光明节快乐——八夜八次认知升级，每一天都比昨天更明亮。",
  halloween:
    "万圣节快乐——勇敢面对思维中的幽灵，最深的恐惧往往藏着最真的洞见。",
  thanksgiving:
    "感恩节快乐——感谢每一个让你重新思考的观点，认知的成长源于拥抱不同。",
  valentines:
    "情人节快乐——最好的陪伴是帮你思考得更好，而不是替你思考。",
} as const;

const TAGLINES: string[] = [
  "真正的智能不是知道所有答案，而是知道该问什么问题。",
  "每一次对话都是一次认知升级。",
  "思维的边界，就是世界的边界。",
  "最好的助手不是替你思考，而是帮你思考得更好。",
  "知识不是力量，连接知识的能力才是。",
  "提问的深度决定了认知的高度。",
  "学习不是填满水桶，而是点燃火焰。",
  "你看到的不是世界本身，而是你的思维模型对世界的投影。",
  "好的问题比好的答案更有价值。",
  "认知的盲区，正是成长的起点。",
  "每一个不曾起舞的日子，都是对思维的辜负。",
  "碎片化的信息不等于碎片化的认知——关键在于连接。",
  "当你开始质疑自己的假设，你就开始真正地思考了。",
  "真正的理解是能把复杂的事情讲给外行听懂。",
  "灵感不是等来的，是在持续思考中偶然相遇的。",
  "你的注意力在哪里，你的认知世界就在哪里。",
  "跨界的碰撞，往往能产生最耀眼的火花。",
  "思考的质量取决于你愿意推翻多少个旧想法。",
  "知识的复利是最强大的复利——每天进步一点点，十年后不可估量。",
  "不要害怕改变观点——那说明你在学习。",
  "深度思考的人，看到的是树背后的森林，森林背后的生态。",
  "智慧不是知识的堆砌，而是知道什么可以忽略。",
  "每一段经历都是训练数据，关键是你怎么从中学习。",
  "认知的最高境界，是知道自己的无知。",
  "好的工具放大你的能力，更好的工具改变你的思维方式。",
  "真正的对话不是交换观点，而是共同创造新的理解。",
  "在信息过载的时代，过滤比获取更重要。",
  "思考需要勇气——因为思考意味着可能改变自己。",
  "最好的学习方式，是把学到的东西用自己的话讲出来。",
  "人工智能不是取代你思考，而是帮你思考得更快、更远、更深。",
  HOLIDAY_TAGLINES.newYear,
  HOLIDAY_TAGLINES.lunarNewYear,
  HOLIDAY_TAGLINES.christmas,
  HOLIDAY_TAGLINES.eid,
  HOLIDAY_TAGLINES.diwali,
  HOLIDAY_TAGLINES.easter,
  HOLIDAY_TAGLINES.hanukkah,
  HOLIDAY_TAGLINES.halloween,
  HOLIDAY_TAGLINES.thanksgiving,
  HOLIDAY_TAGLINES.valentines,
];

type HolidayRule = (date: Date) => boolean;

const DAY_MS = 24 * 60 * 60 * 1000;

function utcParts(date: Date) {
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth(),
    day: date.getUTCDate(),
  };
}

const onMonthDay =
  (month: number, day: number): HolidayRule =>
  (date) => {
    const parts = utcParts(date);
    return parts.month === month && parts.day === day;
  };

const onSpecificDates =
  (dates: Array<[number, number, number]>, durationDays = 1): HolidayRule =>
  (date) => {
    const parts = utcParts(date);
    return dates.some(([year, month, day]) => {
      if (parts.year !== year) {
        return false;
      }
      const start = Date.UTC(year, month, day);
      const current = Date.UTC(parts.year, parts.month, parts.day);
      return current >= start && current < start + durationDays * DAY_MS;
    });
  };

const inYearWindow =
  (
    windows: Array<{
      year: number;
      month: number;
      day: number;
      duration: number;
    }>,
  ): HolidayRule =>
  (date) => {
    const parts = utcParts(date);
    const window = windows.find((entry) => entry.year === parts.year);
    if (!window) {
      return false;
    }
    const start = Date.UTC(window.year, window.month, window.day);
    const current = Date.UTC(parts.year, parts.month, parts.day);
    return current >= start && current < start + window.duration * DAY_MS;
  };

const isFourthThursdayOfNovember: HolidayRule = (date) => {
  const parts = utcParts(date);
  if (parts.month !== 10) {
    return false;
  } // November
  const firstDay = new Date(Date.UTC(parts.year, 10, 1)).getUTCDay();
  const offsetToThursday = (4 - firstDay + 7) % 7; // 4 = Thursday
  const fourthThursday = 1 + offsetToThursday + 21; // 1st + offset + 3 weeks
  return parts.day === fourthThursday;
};

const HOLIDAY_RULES = new Map<string, HolidayRule>([
  [HOLIDAY_TAGLINES.newYear, onMonthDay(0, 1)],
  [
    HOLIDAY_TAGLINES.lunarNewYear,
    onSpecificDates(
      [
        [2025, 0, 29],
        [2026, 1, 17],
        [2027, 1, 6],
      ],
      1,
    ),
  ],
  [
    HOLIDAY_TAGLINES.eid,
    onSpecificDates(
      [
        [2025, 2, 30],
        [2025, 2, 31],
        [2026, 2, 20],
        [2027, 2, 10],
      ],
      1,
    ),
  ],
  [
    HOLIDAY_TAGLINES.diwali,
    onSpecificDates(
      [
        [2025, 9, 20],
        [2026, 10, 8],
        [2027, 9, 28],
      ],
      1,
    ),
  ],
  [
    HOLIDAY_TAGLINES.easter,
    onSpecificDates(
      [
        [2025, 3, 20],
        [2026, 3, 5],
        [2027, 2, 28],
      ],
      1,
    ),
  ],
  [
    HOLIDAY_TAGLINES.hanukkah,
    inYearWindow([
      { year: 2025, month: 11, day: 15, duration: 8 },
      { year: 2026, month: 11, day: 5, duration: 8 },
      { year: 2027, month: 11, day: 25, duration: 8 },
    ]),
  ],
  [HOLIDAY_TAGLINES.halloween, onMonthDay(9, 31)],
  [HOLIDAY_TAGLINES.thanksgiving, isFourthThursdayOfNovember],
  [HOLIDAY_TAGLINES.valentines, onMonthDay(1, 14)],
  [HOLIDAY_TAGLINES.christmas, onMonthDay(11, 25)],
]);

function isTaglineActive(tagline: string, date: Date): boolean {
  const rule = HOLIDAY_RULES.get(tagline);
  if (!rule) {
    return true;
  }
  return rule(date);
}

export interface TaglineOptions {
  env?: NodeJS.ProcessEnv;
  random?: () => number;
  now?: () => Date;
  mode?: TaglineMode;
}

export function activeTaglines(options: TaglineOptions = {}): string[] {
  if (TAGLINES.length === 0) {
    return [DEFAULT_TAGLINE];
  }
  const today = options.now ? options.now() : new Date();
  const filtered = TAGLINES.filter((tagline) => isTaglineActive(tagline, today));
  return filtered.length > 0 ? filtered : TAGLINES;
}

export function pickTagline(options: TaglineOptions = {}): string {
  if (options.mode === "off") {
    return "";
  }
  if (options.mode === "default") {
    return DEFAULT_TAGLINE;
  }
  const env = options.env ?? process.env;
  const override = env?.KAIJIBOT_TAGLINE_INDEX;
  if (override !== undefined) {
    const parsed = Number.parseInt(override, 10);
    if (!Number.isNaN(parsed) && parsed >= 0) {
      const pool = TAGLINES.length > 0 ? TAGLINES : [DEFAULT_TAGLINE];
      return pool[parsed % pool.length];
    }
  }
  const pool = activeTaglines(options);
  const rand = options.random ?? Math.random;
  const index = Math.floor(rand() * pool.length) % pool.length;
  return pool[index];
}

export { TAGLINES, HOLIDAY_RULES, DEFAULT_TAGLINE };
