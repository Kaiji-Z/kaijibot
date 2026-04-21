export interface QuickSettingEntry {
  path: string[];
  label: string;
  description?: string;
  section: string;
}

export const QUICK_SETTINGS: readonly QuickSettingEntry[] = [
  {
    path: ["cognitive", "enabled"],
    label: "认知系统",
    description: "主动学习用户画像并推送洞察",
    section: "cognitive",
  },
  {
    path: ["cognitive", "proactive", "enabled"],
    label: "主动推送",
    description: "主动向用户发送洞察消息",
    section: "cognitive",
  },
  {
    path: ["cognitive", "persona", "autoExtract"],
    label: "用户画像",
    description: "自动从对话中提取兴趣和偏好",
    section: "cognitive",
  },
  {
    path: ["cognitive", "evolution", "enabled"],
    label: "自进化",
    description: "基于错误学习自动建议新技能",
    section: "cognitive",
  },
] as const;
