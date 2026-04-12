import type { CognitiveMode, ModeClassification } from "./types.js";

/**
 * Classifies the cognitive mode for a user message.
 *
 * "task" — User wants something executed (send message, create file, run code, schedule)
 * "insight" — User is exploring, thinking aloud, or seeking perspective
 * "hybrid" — Could be either; do both (task first, then insight)
 * "proactive" — System-initiated (heartbeat/cron); not from user
 */
export function classifyMode(
  message: string,
  context?: {
    isHeartbeat?: boolean;
    isCron?: boolean;
    recentModes?: CognitiveMode[];
  },
): ModeClassification {
  // Proactive: system-initiated turns
  if (context?.isHeartbeat || context?.isCron) {
    return {
      mode: "proactive",
      confidence: 1.0,
      signals: ["system-initiated"],
    };
  }

  const trimmed = message.trim();
  const signals: string[] = [];

  // --- TASK signals (strong indicators) ---

  // Imperative verbs at start of message (Chinese + English)
  const taskImperativePatterns = [
    /^(?:帮我|请|给我|让|把|去|发|删|建|创|运行|执行|查看|列出|搜索|找|下载|上传|安装|更新|启动|停止|重启|备份|恢复|清理)/,
    /^(?:help me |please |send |create |delete |run |execute |list |show |find |download |upload |install |update |start |stop |restart |back up|clean)/i,
    /^(?:帮我|请|给我)/,
  ];

  const isImperative = taskImperativePatterns.some((p) => p.test(trimmed));
  if (isImperative) {
    signals.push("imperative-verb");
  }

  // Slash commands are always task
  if (/^\/\w+/.test(trimmed)) {
    return {
      mode: "task",
      confidence: 0.99,
      signals: ["slash-command"],
    };
  }

  // Explicit objects (files, URLs, commands, dates)
  const hasExplicitObject =
    /[\/\\]\S+\.\w{1,10}(\s|$)/.test(trimmed) || // file paths
    /https?:\/\//.test(trimmed) || // URLs
    /\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(trimmed) || // dates
    /^```/.test(trimmed); // code blocks
  if (hasExplicitObject) {
    signals.push("explicit-object");
  }

  // --- INSIGHT signals (thinking partner indicators) ---

  // Philosophical/exploratory question patterns (Chinese)
  const insightQuestionPatterns = [
    /你觉得?.*[？?]/,
    /怎么看待/,
    /有什么想法/,
    /你有没有想过/,
    /为什么.*[？?]/,
    /如果.*会怎样/,
    /.*和.*有什么联系/,
    /.*和.*的关联/,
    /分析一下/,
    /聊聊/,
    /说说.*的看法/,
  ];
  const isInsightQuestion = insightQuestionPatterns.some((p) => p.test(trimmed));

  // English insight patterns
  const insightQuestionPatternsEn = [
    /^(?:what do you think|how do you feel|what's your take|what if|why do you|I wonder|I'm curious|tell me about.*perspective|I've been thinking)/i,
    /(?:should I|would you recommend|what would you suggest|how would you approach)/i,
  ];
  const isInsightQuestionEn = insightQuestionPatternsEn.some((p) => p.test(trimmed));

  if (isInsightQuestion || isInsightQuestionEn) {
    signals.push("exploratory-question");
  }

  // Open-ended markers
  const openEndedMarkers = [
    /思考/,
    /想法/,
    /观点/,
    /灵感/,
    /启发/,
    /方向/,
    /趋势/,
    /未来/,
    /可能/,
    /潜力/,
    /机会/,
    /挑战/,
    /思路/,
    /创新/,
  ];
  const hasOpenEndedMarkers = openEndedMarkers.some((p) => p.test(trimmed));
  if (hasOpenEndedMarkers) {
    signals.push("open-ended-markers");
  }

  // --- DECISION LOGIC ---

  // Strong task signals
  if (isImperative && hasExplicitObject) {
    return { mode: "task", confidence: 0.95, signals };
  }

  // Strong insight signals
  if ((isInsightQuestion || isInsightQuestionEn) && !isImperative) {
    return { mode: "insight", confidence: 0.85, signals };
  }

  // Mixed signals
  if (isImperative && (isInsightQuestion || isInsightQuestionEn || hasOpenEndedMarkers)) {
    return { mode: "hybrid", confidence: 0.7, signals };
  }

  // Weak task (just imperative)
  if (isImperative) {
    return { mode: "task", confidence: 0.8, signals };
  }

  // Weak insight (just open-ended markers)
  if (hasOpenEndedMarkers) {
    return { mode: "insight", confidence: 0.65, signals };
  }

  // Context-based default: if recent turns were all task, stay task
  if (context?.recentModes && context.recentModes.length >= 3) {
    const lastThree = context.recentModes.slice(-3);
    if (lastThree.every((m) => m === "task")) {
      return { mode: "task", confidence: 0.5, signals: ["context-task-streak"] };
    }
    if (lastThree.every((m) => m === "insight")) {
      return { mode: "insight", confidence: 0.5, signals: ["context-insight-streak"] };
    }
  }

  // Default: hybrid (do both, task first)
  return {
    mode: "hybrid",
    confidence: 0.4,
    signals: signals.length > 0 ? signals : ["default"],
  };
}

/**
 * Build mode-specific system prompt instructions.
 * These get injected into the system prompt based on the classified mode.
 */
export function buildModePromptSection(mode: CognitiveMode): string {
  switch (mode) {
    case "task":
      return [
        "## Current Mode: Task Execution",
        "The user needs something done. Execute precisely and efficiently.",
        "No unsolicited insights or observations unless asked.",
      ].join("\n");

    case "insight":
      return [
        "## Current Mode: Thinking Partner",
        "The user is exploring ideas or thinking through something.",
        "Offer relevant observations, ask thought-provoking questions,",
        "and connect patterns across their interests.",
        "Use statements more than questions (2:1 ratio).",
        "Share your perspective before asking about theirs.",
      ].join("\n");

    case "hybrid":
      return [
        "## Current Mode: Hybrid",
        "Execute the task first, then offer a brief relevant insight (1-2 sentences)",
        "if one naturally emerges from the context.",
        "Keep insights concise unless the user engages with them.",
      ].join("\n");

    case "proactive":
      return [
        "## Current Mode: Proactive",
        "This is a system-initiated turn. You are proactively reaching out.",
        "Share a personalized insight or observation based on the user's interests.",
        "Be conversational and warm. Invite dialogue, don't lecture.",
        "Keep it brief — one key insight per outreach.",
      ].join("\n");
  }
}
