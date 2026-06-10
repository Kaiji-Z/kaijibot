/**
 * Local date/time formatting utilities.
 *
 * All KaijiBot user-visible timestamps (filenames, frontmatter, topic dates)
 * MUST use these functions instead of `toISOString()` to respect the runtime
 * timezone (Asia/Shanghai in production).
 */

/** Returns local date as `YYYY-MM-DD`. */
export function localDateStr(date: Date = new Date()): string {
  const y = date.getFullYear().toString();
  const m = (date.getMonth() + 1).toString().padStart(2, "0");
  const d = date.getDate().toString().padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Returns local time as `HHMM` (4 digits). */
export function localTimeStr(date: Date = new Date()): string {
  const hh = date.getHours().toString().padStart(2, "0");
  const mm = date.getMinutes().toString().padStart(2, "0");
  return `${hh}${mm}`;
}

/** Returns local datetime as `YYYY-MM-DDTHH:MM:00`. */
export function localDateTimeStr(date: Date = new Date()): string {
  return `${localDateStr(date)}T${localTimeStr(date).slice(0, 2)}:${localTimeStr(date).slice(2, 4)}:00`;
}
