import { HEARTBEAT_TOKEN } from "../auto-reply/tokens.js";
import { normalizeLowercaseStringOrEmpty } from "../shared/string-coerce.js";

// Build a dynamic prompt for cron events by embedding the actual event content.
// This ensures the model sees the reminder text directly instead of relying on
// "shown in the system messages above" which may not be visible in context.
export function buildCronEventPrompt(
  pendingEvents: string[],
  opts?: {
    deliverToUser?: boolean;
  },
): string {
  const deliverToUser = opts?.deliverToUser ?? true;
  const eventText = pendingEvents.join("\n").trim();
  if (!eventText) {
    if (!deliverToUser) {
      return (
        "A scheduled cron event was triggered, but no event content was found. " +
        "Handle this internally and reply HEARTBEAT_OK when nothing needs user-facing follow-up."
      );
    }
    return (
      "A scheduled cron event was triggered, but no event content was found. " +
      "Reply HEARTBEAT_OK."
    );
  }
  if (!deliverToUser) {
    return (
      "A scheduled reminder has been triggered. The reminder content is:\n\n" +
      eventText +
      "\n\nHandle this reminder internally. Do not relay it to the user unless explicitly requested."
    );
  }
  return (
    "A scheduled reminder has been triggered. The reminder content is:\n\n" +
    eventText +
    "\n\nPlease relay this reminder to the user in a helpful and friendly way."
  );
}

export function buildExecEventPrompt(opts?: { deliverToUser?: boolean }): string {
  const deliverToUser = opts?.deliverToUser ?? true;
  if (!deliverToUser) {
    return (
      "An async command you ran earlier has completed. The result is shown in the system messages above. " +
      "Handle the result internally. Do not relay it to the user unless explicitly requested."
    );
  }
  return (
    "An async command you ran earlier has completed. The result is shown in the system messages above. " +
    "Please relay the command output to the user in a helpful way. If the command succeeded, share the relevant output. " +
    "If it failed, explain what went wrong."
  );
}

const HEARTBEAT_OK_PREFIX = normalizeLowercaseStringOrEmpty(HEARTBEAT_TOKEN);

// Detect heartbeat-specific noise so cron reminders don't trigger on non-reminder events.
function isHeartbeatAckEvent(evt: string): boolean {
  const trimmed = evt.trim();
  if (!trimmed) {
    return false;
  }
  const lower = normalizeLowercaseStringOrEmpty(trimmed);
  if (!lower.startsWith(HEARTBEAT_OK_PREFIX)) {
    return false;
  }
  const suffix = lower.slice(HEARTBEAT_OK_PREFIX.length);
  if (suffix.length === 0) {
    return true;
  }
  return !/[a-z0-9_]/.test(suffix[0]);
}

function isHeartbeatNoiseEvent(evt: string): boolean {
  const lower = normalizeLowercaseStringOrEmpty(evt);
  if (!lower) {
    return false;
  }
  return (
    isHeartbeatAckEvent(lower) ||
    lower.includes("heartbeat poll") ||
    lower.includes("heartbeat wake")
  );
}

export function isExecCompletionEvent(evt: string): boolean {
  return normalizeLowercaseStringOrEmpty(evt).includes("exec finished");
}

export function isEvolutionSignalEvent(evt: string): boolean {
  return evt.includes("[Evolution Signal]");
}

export function buildEvolutionEventPrompt(opts?: { deliverToUser?: boolean }): string {
  const deliverToUser = opts?.deliverToUser ?? true;
  if (!deliverToUser) {
    return (
      "A skill evolution signal has been received (shown in system messages above). " +
      "Evaluate the signal and call evaluate_skill_evolution if the pattern is worth saving as a reusable skill. " +
      "Handle this internally."
    );
  }
  return [
    "你收到了一个技能进化信号（内容在系统消息中）。请根据完整对话上下文自主判断这个任务模式是否值得保存为可复用技能。",
    "",
    "判断流程：",
    "1. 调用 evaluate_skill_evolution 工具生成技能草稿",
    "2. 根据返回的 complexityScore 和 recentSuggestions 决定：",
    "   - 值得且不频繁 → 直接告诉用户你生成了一个技能草稿，问要不要保存",
    "   - 值得但近期已建议过类似内容 → 告诉用户你静默创建了技能，下次需要时可以直接用",
    "   - 不值得（太简单、一次性需求） → 简短告诉用户你评估了但觉得不值得保存",
    "3. 无论哪种情况，你都必须输出一段自然语言回复给用户",
    "",
    "如果用户想修改已有技能，使用 patch_skill 工具。",
  ].join("\n");
}

// Returns true when a system event should be treated as real cron reminder content.
export function isCronSystemEvent(evt: string) {
  if (!evt.trim()) {
    return false;
  }
  return !isHeartbeatNoiseEvent(evt) && !isExecCompletionEvent(evt);
}
