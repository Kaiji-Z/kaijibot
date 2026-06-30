/**
 * Kaomoji for agent status cards.
 *
 * •ω• is the most popular kawaii core. State variants change eyes/symbols.
 * All chars verified Kindle serif-safe (ASCII + ω + · + × + ♡ + ヾ).
 */

export type DogStatus = "idle" | "thinking" | "tool_calling" | "completed" | "failed";

var IDLE = "( -\u03c9- ) zZ";
var THINKING = "(\u30fb\u03c9\u30fb)?";
var RUNNING = "\u30be(\u2022\u03c9\u2022\u02cb)o";
var DONE = "( ^\u03c9^ ) \u2661";
var FAILED = "(\u00d7\u03c9\u00d7)";

var DOGS: Record<DogStatus, string> = {
  idle: IDLE,
  thinking: THINKING,
  tool_calling: RUNNING,
  completed: DONE,
  failed: FAILED,
};

export function getDogArt(status: DogStatus): string {
  return DOGS[status] ?? IDLE;
}
