/**
 * Quick Settings manifest for the Settings page.
 *
 * Each entry maps a high-frequency config path to a display label,
 * optional description, and the section key it belongs to (for
 * "see more" navigation).
 *
 * Consumed by config.ts to render inline controls via renderNode().
 */

export interface QuickSettingEntry {
  path: string[];
  label: string;
  description?: string;
  section: string;
}

export const QUICK_SETTINGS: readonly QuickSettingEntry[] = [
  // ── Agents ──────────────────────────────────────────────
  {
    path: ["agents", "model"],
    label: "默认模型",
    description: "Agent 使用的默认 LLM 模型",
    section: "agents",
  },
  {
    path: ["agents", "thinkingDefault"],
    label: "思考模式",
    description: "默认是否启用深度思考",
    section: "agents",
  },
  {
    path: ["agents", "maxConcurrent"],
    label: "最大并发",
    description: "同时运行的最大 Agent 数量",
    section: "agents",
  },

  // ── Cognitive ───────────────────────────────────────────
  {
    path: ["cognitive", "enabled"],
    label: "认知系统",
    description: "启用主动认知和洞察推送",
    section: "cognitive",
  },
  {
    path: ["cognitive", "proactive", "enabled"],
    label: "主动推送",
    description: "启用主动洞察消息推送",
    section: "cognitive",
  },
  {
    path: ["cognitive", "proactive", "minIntervalHours"],
    label: "最小间隔(小时)",
    description: "两次主动推送之间的最短时间",
    section: "cognitive",
  },
  {
    path: ["cognitive", "persona", "enabled"],
    label: "用户画像",
    description: "自动学习用户兴趣和偏好",
    section: "cognitive",
  },

  // ── Session ─────────────────────────────────────────────
  {
    path: ["session", "typingMode"],
    label: "打字模式",
    description: "流式输出时模拟逐字显示",
    section: "session",
  },

  // ── Logging ─────────────────────────────────────────────
  {
    path: ["logging", "level"],
    label: "日志级别",
    description: "系统日志的详细程度",
    section: "logging",
  },

  // ── Messages ────────────────────────────────────────────
  {
    path: ["messages", "maxHistory"],
    label: "最大历史",
    description: "每个会话保留的最大消息数",
    section: "messages",
  },
  {
    path: ["messages", "contextWindow"],
    label: "上下文窗口",
    description: "发送给模型的上下文长度限制",
    section: "messages",
  },

  // ── Plugins ─────────────────────────────────────────────
  {
    path: ["plugins", "autoUpdate"],
    label: "自动更新插件",
    description: "自动检查并更新已安装的插件",
    section: "plugins",
  },
] as const;
