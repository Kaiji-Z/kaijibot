import { cliI18n } from "./i18n/translate.js";

export type TaglineMode = "random" | "default" | "off";

/**
 * Identifier for a holiday that has a tagline. Rules are keyed by ID rather
 * than by tagline text so that locale switches do not break rule lookup.
 */
type HolidayId =
  | "newYear"
  | "lunarNewYear"
  | "christmas"
  | "eid"
  | "diwali"
  | "easter"
  | "hanukkah"
  | "halloween"
  | "thanksgiving"
  | "valentines";

/**
 * A single entry in the tagline pool. Philosophical entries have no
 * `holidayId`; holiday entries do, and are only active on their dates.
 */
interface TaglineEntry {
  /** Stable identifier used for KAIJIBOT_TAGLINE_INDEX lookup. */
  id: string;
  /** Localized text, resolved from the CLI i18n bundle. */
  text: string;
  /** When set, the entry is active only when the holiday rule returns true. */
  holidayId?: HolidayId;
}

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

/**
 * Holiday activation rules, keyed by {@link HolidayId}. Lookup is decoupled
 * from the localized tagline text so a locale switch never breaks rule
 * resolution.
 */
const HOLIDAY_RULES_BY_ID = new Map<HolidayId, HolidayRule>([
  ["newYear", onMonthDay(0, 1)],
  [
    "lunarNewYear",
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
    "eid",
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
    "diwali",
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
    "easter",
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
    "hanukkah",
    inYearWindow([
      { year: 2025, month: 11, day: 15, duration: 8 },
      { year: 2026, month: 11, day: 5, duration: 8 },
      { year: 2027, month: 11, day: 25, duration: 8 },
    ]),
  ],
  ["halloween", onMonthDay(9, 31)],
  ["thanksgiving", isFourthThursdayOfNovember],
  ["valentines", onMonthDay(1, 14)],
  ["christmas", onMonthDay(11, 25)],
]);

/** Holiday IDs in the order they appear in the tagline pool. */
const HOLIDAY_ORDER: readonly HolidayId[] = [
  "newYear",
  "lunarNewYear",
  "christmas",
  "eid",
  "diwali",
  "easter",
  "hanukkah",
  "halloween",
  "thanksgiving",
  "valentines",
];

const PHILOSOPHICAL_COUNT = 30;

/**
 * Build the tagline pool for the active locale. The shape is deterministic
 * regardless of locale: 30 philosophical entries followed by 10 holiday
 * entries in {@link HOLIDAY_ORDER}. Indices stay stable across locale
 * switches so `KAIJIBOT_TAGLINE_INDEX` continues to behave predictably.
 */
function buildTaglinePool(): TaglineEntry[] {
  const philosophical: TaglineEntry[] = [];
  for (let i = 0; i < PHILOSOPHICAL_COUNT; i++) {
    philosophical.push({
      id: `p${i}`,
      text: cliI18n.t(`cli.tagline.philosophical.${i}`),
    });
  }
  const holidays: TaglineEntry[] = HOLIDAY_ORDER.map((holidayId) => ({
    id: `h-${holidayId}`,
    text: cliI18n.t(`cli.tagline.holiday.${holidayId}`),
    holidayId,
  }));
  return [...philosophical, ...holidays];
}

function isTaglineActive(entry: TaglineEntry, date: Date): boolean {
  if (!entry.holidayId) {
    return true;
  }
  const rule = HOLIDAY_RULES_BY_ID.get(entry.holidayId);
  return rule ? rule(date) : true;
}

export interface TaglineOptions {
  env?: NodeJS.ProcessEnv;
  random?: () => number;
  now?: () => Date;
  mode?: TaglineMode;
}

/**
 * Returns the list of currently active taglines. Holiday entries are
 * filtered out unless their rule matches "today". The pool is rebuilt on
 * every call so locale changes take effect immediately.
 */
export function activeTaglines(options: TaglineOptions = {}): string[] {
  const pool = buildTaglinePool();
  const today = options.now ? options.now() : new Date();
  const filtered = pool.filter((entry) => isTaglineActive(entry, today));
  if (filtered.length === 0) {
    return pool.map((entry) => entry.text);
  }
  return filtered.map((entry) => entry.text);
}

export function pickTagline(options: TaglineOptions = {}): string {
  if (options.mode === "off") {
    return "";
  }
  if (options.mode === "default") {
    return cliI18n.t("cli.tagline.default");
  }
  const env = options.env ?? process.env;
  const override = env?.KAIJIBOT_TAGLINE_INDEX;
  if (override !== undefined) {
    const parsed = Number.parseInt(override, 10);
    if (!Number.isNaN(parsed) && parsed >= 0) {
      const pool = buildTaglinePool();
      const entry = pool[parsed % pool.length];
      return entry ? entry.text : cliI18n.t("cli.tagline.default");
    }
  }
  const pool = activeTaglines(options);
  const rand = options.random ?? Math.random;
  const index = Math.floor(rand() * pool.length) % pool.length;
  return pool[index];
}

/**
 * Returns the holiday-tagline text for `id` in the active locale. Exposed
 * for callers that want to inspect specific holidays directly.
 */
export function getHolidayTagline(id: HolidayId): string {
  return cliI18n.t(`cli.tagline.holiday.${id}`);
}

/**
 * Read-only view of the holiday rules, keyed by holiday ID. Exposed for
 * tooling that needs to enumerate active holidays without touching the
 * localized strings.
 */
export const HOLIDAY_RULES: ReadonlyMap<HolidayId, HolidayRule> = HOLIDAY_RULES_BY_ID;

/**
 * Returns the default tagline for the active locale. Replaces the old
 * `DEFAULT_TAGLINE` string constant.
 */
export function getDefaultTagline(): string {
  return cliI18n.t("cli.tagline.default");
}
