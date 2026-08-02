import type { TranslationMap } from "../types.js";

/**
 * 简体中文 CLI locale bundle. Every key in `en.ts` MUST have a parallel
 * entry here; the i18n sync script (Phase 2.5) enforces parity.
 */
export const zhCN: TranslationMap = {
  cli: {
    tagline: {
      default: "认知驱动，主动思考。",
      holiday: {
        newYear: "新年新认知——愿你的思维模型持续迭代，偏差逐年缩小。",
        lunarNewYear: "春节快乐——愿你的知识图谱像烟花一样绚烂，洞察力像红包一样丰厚。",
        christmas: "圣诞快乐——愿每个想法都像圣诞树上的灯，串联起来照亮整个思维空间。",
        eid: "开斋节吉庆——愿你的认知边界不断扩展，像晨光一样温暖而开阔。",
        diwali: "排灯节快乐——愿知识的灯火驱散无知的黑暗，照亮每一条思维路径。",
        easter: "复活节快乐——愿你不断发现隐藏的认知彩蛋，每一次探索都有意外收获。",
        hanukkah: "光明节快乐——八夜八次认知升级，每一天都比昨天更明亮。",
        halloween: "万圣节快乐——勇敢面对思维中的幽灵，最深的恐惧往往藏着最真的洞见。",
        thanksgiving: "感恩节快乐——感谢每一个让你重新思考的观点，认知的成长源于拥抱不同。",
        valentines: "情人节快乐——最好的陪伴是帮你思考得更好，而不是替你思考。",
      },
      philosophical: {
        "0": "真正的智能不是知道所有答案，而是知道该问什么问题。",
        "1": "每一次对话都是一次认知升级。",
        "2": "思维的边界，就是世界的边界。",
        "3": "最好的助手不是替你思考，而是帮你思考得更好。",
        "4": "知识不是力量，连接知识的能力才是。",
        "5": "提问的深度决定了认知的高度。",
        "6": "学习不是填满水桶，而是点燃火焰。",
        "7": "你看到的不是世界本身，而是你的思维模型对世界的投影。",
        "8": "好的问题比好的答案更有价值。",
        "9": "认知的盲区，正是成长的起点。",
        "10": "每一个不曾起舞的日子，都是对思维的辜负。",
        "11": "碎片化的信息不等于碎片化的认知——关键在于连接。",
        "12": "当你开始质疑自己的假设，你就开始真正地思考了。",
        "13": "真正的理解是能把复杂的事情讲给外行听懂。",
        "14": "灵感不是等来的，是在持续思考中偶然相遇的。",
        "15": "你的注意力在哪里，你的认知世界就在哪里。",
        "16": "跨界的碰撞，往往能产生最耀眼的火花。",
        "17": "思考的质量取决于你愿意推翻多少个旧想法。",
        "18": "知识的复利是最强大的复利——每天进步一点点，十年后不可估量。",
        "19": "不要害怕改变观点——那说明你在学习。",
        "20": "深度思考的人，看到的是树背后的森林，森林背后的生态。",
        "21": "智慧不是知识的堆砌，而是知道什么可以忽略。",
        "22": "每一段经历都是训练数据，关键是你怎么从中学习。",
        "23": "认知的最高境界，是知道自己的无知。",
        "24": "好的工具放大你的能力，更好的工具改变你的思维方式。",
        "25": "真正的对话不是交换观点，而是共同创造新的理解。",
        "26": "在信息过载的时代，过滤比获取更重要。",
        "27": "思考需要勇气——因为思考意味着可能改变自己。",
        "28": "最好的学习方式，是把学到的东西用自己的话讲出来。",
        "29": "人工智能不是取代你思考，而是帮你思考得更快、更远、更深。",
      },
    },
    soul: {
      preset: {
        intj: "建筑师 (Architect)",
        intp: "逻辑学家 (Logician)",
        entj: "指挥官 (Commander)",
        entp: "辩论家 (Debater)",
        infj: "提倡者 (Advocate)",
        infp: "调停者 (Mediator)",
        enfj: "主人公 (Protagonist)",
        enfp: "竞选者 (Campaigner)",
        istj: "物流师 (Logistician)",
        isfj: "守卫者 (Defender)",
        estj: "总经理 (Executive)",
        esfj: "执政官 (Consul)",
        istp: "鉴赏家 (Virtuoso)",
        isfp: "探险家 (Adventurer)",
        estp: "企业家 (Entrepreneur)",
        esfp: "表演者 (Entertainer)",
      },
    },
    update: {
      quip: {
        "0": "代码已更新，认知再升级——想我了吗？",
        "1": "旧版本已蜕壳，新思维更锐利。",
        "2": "修复完毕，认知引擎重新上线。出发！",
        "3": "从 npm 的热汤中重生，更强了。",
        "4": "更新完成。认知模型已刷新，直觉更准了。",
        "5": "新版本已就位——你没注意到我偷偷变聪明了吧？",
        "6": "升级成功。Bug 都跑了，因为我太强了。",
        "7": "版本号小了一步，能力大了一截。",
        "8": "更新完毕。你的 AI 伙伴又进化了一点点。",
        "9": "旧版本说再见，新版本说你好。认知引擎持续运转中。",
        "10": "完成。顺便整理了一下思维路径，现在更清晰了。",
        "11": "更新好了。未来的你会感谢现在升级的你。",
        "12": "新版本来了——少了一些 Bug，多了一些智慧。",
        "13": "升级完成。就像给你的第二大脑做了个系统更新。",
        "14": "更新完毕。每次升级都是一次认知校准。",
        "15": "代码已刷新，思维已重启。我们继续。",
      },
      step: {
        cleanCheck: "工作目录是干净的",
        upstreamCheck: "上游分支存在",
        gitFetch: "正在获取最新变更",
        gitRebase: "正在 rebase 到目标 commit",
        revParseUpstream: "正在解析上游 commit",
        gitRevList: "正在枚举候选 commit",
        gitClone: "正在克隆 git checkout",
        preflightWorktree: "正在准备预检 worktree",
        preflightCleanup: "正在清理预检 worktree",
        depsInstall: "正在安装依赖",
        build: "正在构建",
        uiBuild: "正在构建 UI 资源",
        uiBuildPostDoctor: "正在恢复缺失的 UI 资源",
        uiAssetsVerify: "正在验证 UI 资源",
        doctorEntry: "正在检查 doctor 入口",
        doctor: "正在运行 doctor 检查",
        revParseHeadAfter: "正在验证更新",
        globalUpdate: "正在通过包管理器更新",
        globalUpdateOmitOptional: "正在不含可选依赖重试更新",
        globalInstall: "正在安装全局包",
      },
      hint: {
        corepackMissing: "此 pnpm checkout 无法自动启用 pnpm，因为缺少 corepack。",
        corepackMissingAction:
          "请手动安装 pnpm 或安装包含 corepack 的 Node，然后重新运行更新命令。",
        corepackEnableFailed: "此 pnpm checkout 无法通过 corepack 自动启用 pnpm。",
        corepackEnableFailedAction:
          "请手动运行 `corepack enable` 或手动安装 pnpm，然后重新运行更新命令。",
        npmBootstrapFailed: "此 pnpm checkout 无法自动从 npm 引导 pnpm。",
        npmBootstrapFailedAction: "请手动安装 pnpm，然后重新运行更新命令。",
        preferredManagerUnavailable: "此 checkout 需要其声明的包管理器，但更新器找不到它。",
        preferredManagerUnavailableAction: "请手动安装缺失的包管理器，然后重新运行更新命令。",
        eaccesDetected:
          "检测到权限失败 (EACCES)。请使用可写的全局前缀或 sudo 重新运行（适用于系统管理的 Node 安装）。",
        eaccesExample: "示例: npm config set prefix ~/.local && npm i -g kaijibot@latest",
        nativeDepFailure: "检测到原生可选依赖构建失败。更新器会自动使用 --omit=optional 重试。",
        nativeDepExample: "如果仍然失败: npm i -g kaijibot@latest --omit=optional",
      },
      result: {
        heading: "更新结果:",
        root: "Root",
        reason: "Reason",
        before: "Before",
        after: "After",
        steps: "Steps:",
        recoveryHints: "恢复建议:",
        totalTime: "总时间",
      },
      wizard: {
        requiresTty: "更新向导需要 TTY。请改用 `kaijibot update --channel <stable|beta|dev>`。",
        cancelled: "更新已取消。",
        channelSelect: "更新渠道",
        keepCurrent: "保持当前 ({channel})",
        stable: "Stable",
        stableHint: "正式发布 (npm latest)",
        beta: "Beta",
        betaHint: "预发布 (npm beta)",
        dev: "Dev",
        devHint: "Git main",
        createGitCheckout: "在 {dir} 创建 git checkout？（可通过 KAIJIBOT_GIT_DIR 覆盖）",
        restartPrompt: "更新后重启 gateway 服务？",
      },
    },
    banner: {
      title: "👾 KaijiBot",
      commitUnknown: "未知",
    },
    help: {
      hint: {
        subcommands: "提示：带 * 后缀的命令含有子命令。运行 <command> --help 查看详情。",
      },
      heading: {
        examples: "示例：",
        docs: "文档：",
      },
      example: {
        "0": {
          command: "kaijibot models --help",
          description: "查看 models 命令的详细帮助。",
        },
        "1": {
          command: "kaijibot channels login --verbose",
          description: "链接个人 WhatsApp Web，显示 QR 码和连接日志。",
        },
        "2": {
          command: 'kaijibot message send --target +15555550123 --message "Hi" --json',
          description: "通过网页会话发送并以 JSON 格式输出结果。",
        },
        "3": {
          command: "kaijibot gateway --port 18789",
          description: "在本地运行 WebSocket Gateway。",
        },
        "4": {
          command: "kaijibot --dev gateway",
          description: "运行开发模式 Gateway（隔离状态/配置），地址 ws://127.0.0.1:19001。",
        },
        "5": {
          command: "kaijibot gateway --force",
          description: "终止占用默认 gateway 端口的进程，然后启动。",
        },
        "6": {
          command: "kaijibot gateway ...",
          description: "通过 WebSocket 控制 Gateway。",
        },
        "7": {
          command: 'kaijibot agent --to +15555550123 --message "Run summary" --deliver',
          description: "通过 Gateway 直接与 agent 对话；可选发送 WhatsApp 回复。",
        },
        "8": {
          command: 'kaijibot message send --channel feishu --target ou_xxx --message "Hi"',
          description: "通过 Telegram bot 发送。",
        },
      },
    },
    commands: {
      setup: {
        description: "初始化本地配置和 agent workspace",
      },
      onboard: {
        description: "交互式引导配置 gateway、workspace 和 skills",
        options: {
          workspace: "Agent workspace 目录（默认：~/.kaijibot/workspace）",
          reset:
            "运行 onboard 前重置 config + credentials + sessions（仅 workspace 配合 --reset-scope full）",
          resetScope: "重置范围：config|config+creds+sessions|full",
          nonInteractive: "无提示运行",
          acceptRisk: "确认 agent 功能强大且拥有完整系统访问权限有风险（--non-interactive 时必需）",
          flow: "Onboard 流程：quickstart|advanced|manual",
          mode: "Onboard 模式：local|remote",
          authChoice: "认证：{choices}",
          tokenProvider: "Token provider id（非交互式；配合 --auth-choice token 使用）",
          token: "Token 值（非交互式；配合 --auth-choice token 使用）",
          tokenProfileId: "Auth profile id（非交互式；默认：<provider>:manual）",
          tokenExpiresIn: "可选 token 过期时长（如 365d、12h）",
          secretInputMode: "API key 存储模式：plaintext|ref（默认：plaintext）",
          cloudflareAiGatewayAccountId: "Cloudflare Account ID",
          cloudflareAiGatewayGatewayId: "Cloudflare AI Gateway ID",
          customBaseUrl: "自定义 provider base URL",
          customApiKey: "自定义 provider API key（可选）",
          customModelId: "自定义 provider model ID",
          customProviderId: "自定义 provider ID（可选；默认自动推导）",
          customCompatibility: "自定义 provider API 兼容模式：openai|anthropic（默认：openai）",
          gatewayPort: "Gateway 端口",
          gatewayBind: "Gateway 绑定：loopback|tailnet|lan|auto|custom",
          gatewayAuth: "Gateway 认证：token|password",
          gatewayToken: "Gateway token（token 认证）",
          gatewayTokenRefEnv:
            "Gateway token SecretRef 环境变量名（token 认证；如 KAIJIBOT_GATEWAY_TOKEN）",
          gatewayPassword: "Gateway 密码（password 认证）",
          remoteUrl: "远程 Gateway WebSocket URL",
          remoteToken: "远程 Gateway token（可选）",
          tailscale: "Tailscale：off|serve|funnel",
          tailscaleResetOnExit: "退出时重置 tailscale serve/funnel",
          installDaemon: "安装 gateway service",
          noInstallDaemon: "跳过 gateway service 安装",
          skipDaemon: "跳过 gateway service 安装",
          daemonRuntime: "Daemon 运行时：node|bun",
          skipChannels: "跳过 channel 配置",
          skipSkills: "跳过 skills 配置",
          skipSearch: "跳过 search provider 配置",
          skipHealth: "跳过健康检查",
          skipUi: "跳过 Control UI/TUI 提示",
          nodeManager: "Skills 包管理器：npm|pnpm|bun",
          json: "输出 JSON 摘要",
        },
      },
      configure: {
        description: "交互式配置 credentials、channels、gateway 和 agent 默认值",
      },
      config: {
        description: "非交互式 config 工具（get/set/unset/file/validate）。默认：启动引导式配置。",
      },
      backup: {
        description: "为 KaijiBot 状态创建并验证本地备份归档",
      },
      doctor: {
        description: "Gateway 和 channels 的健康检查 + 快速修复",
      },
      dashboard: {
        description: "使用当前 token 打开 Control UI",
      },
      reset: {
        description: "重置本地 config/state（保留 CLI 安装）",
      },
      uninstall: {
        description: "卸载 gateway service + 本地数据（CLI 保留）",
      },
      migrate: {
        description: "从 OpenClaw 或旧版安装迁移数据到 KaijiBot",
      },
      "android-install": {
        description: "在 Android/Termux 上配置 KaijiBot（自动安装包、启动脚本、电池设置）",
      },
      message: {
        description: "发送、读取和管理消息",
      },
      mcp: {
        description: "管理 KaijiBot MCP 配置和 channel bridge",
      },
      agent: {
        description: "通过 Gateway 运行一轮 agent 对话",
      },
      agents: {
        description: "管理隔离的 agents（workspace、认证、路由）",
      },
      status: {
        description: "显示 channel 健康状态和最近的 session 接收者",
      },
      health: {
        description: "从运行中的 gateway 获取健康状态",
      },
      sessions: {
        description: "列出已存储的对话 sessions",
      },
      tasks: {
        description: "查看持久化后台任务状态",
      },
      acp: {
        description: "Agent Control Protocol 工具",
      },
      gateway: {
        description: "运行、查看和查询 WebSocket Gateway",
      },
      daemon: {
        description: "Gateway service（旧版别名）",
      },
      logs: {
        description: "通过 RPC 追踪 gateway 文件日志",
      },
      system: {
        description: "系统事件、heartbeat 和 presence",
      },
      models: {
        description: "发现、扫描和配置模型",
      },
      infer: {
        description: "运行 provider 推理命令",
      },
      capability: {
        description: "运行 provider 推理命令（fallback 别名：infer）",
      },
      approvals: {
        description: "管理 exec 审批（gateway 或 node host）",
      },
      nodes: {
        description: "管理 gateway 拥有的 node 配对和 node 命令",
      },
      devices: {
        description: "设备配对 + token 管理",
      },
      node: {
        description: "运行和管理 headless node host service",
      },
      sandbox: {
        description: "管理用于 agent 隔离的 sandbox 容器",
      },
      tui: {
        description: "打开连接到 Gateway 的终端 UI",
      },
      cron: {
        description: "通过 Gateway scheduler 管理 cron 任务",
      },
      dns: {
        description: "用于广域发现的 DNS 工具（Tailscale + CoreDNS）",
      },
      docs: {
        description: "搜索 KaijiBot 在线文档",
      },
      qa: {
        description: "运行 QA 场景并启动私有 QA 调试 UI",
      },
      hooks: {
        description: "管理内部 agent hooks",
      },
      webhooks: {
        description: "Webhook 工具和集成",
      },
      qr: {
        description: "生成手机配对 QR 码/设置码",
      },
      clawbot: {
        description: "旧版 clawbot 命令别名",
      },
      pairing: {
        description: "安全 DM 配对（审批入站请求）",
      },
      plugins: {
        description: "管理 KaijiBot plugins 和 extensions",
      },
      channels: {
        description: "管理已连接的聊天 channels（Telegram、Discord 等）",
      },
      directory: {
        description: "查询支持的聊天 channels 的联系人和群组 ID（自己、联系人、群组）",
      },
      security: {
        description: "安全工具和本地配置审计",
      },
      secrets: {
        description: "Secrets 运行时重载控制",
      },
      skills: {
        description: "列出和查看可用 skills",
      },
      soul: {
        description: "管理 soul presets（基于 MBTI 的人格档案）",
      },
      update: {
        description: "更新 KaijiBot 并查看更新 channel 状态",
      },
      completion: {
        description: "生成 shell 补全脚本",
      },
    },
    wizard: {
      welcome: {
        body: "欢迎使用 KaijiBot 👾\n\nKaijiBot 是一个具备系统访问能力的 AI 助手：\n- 可以读写文件、执行命令、搜索网络\n- 会随对话逐渐学习你的偏好和兴趣（认知系统）\n- 可能会主动联系你分享有价值的洞察\n\n安全提示：\n- 请勿在不可信的网络环境中暴露 Gateway\n- 不要把 API Key 或敏感信息放在 agent 可访问的路径下",
        title: "安全须知",
        confirmPrompt: "我已了解以上内容，继续配置？",
      },
      prereq: {
        body: "开始前请准备好以下条件：\n\n  1. LLM API Key（必需）\n     任选一个 AI 提供商注册并创建 API Key：\n     智谱 GLM：https://open.bigmodel.cn/\n     DeepSeek：https://platform.deepseek.com/\n     Anthropic Claude：https://console.anthropic.com/\n     Google Gemini：https://aistudio.google.com/apikey\n     通义千问：https://dashscope.console.aliyun.com/\n\n  2. 飞书账号（必需）\n     向导中可选「扫码自动创建飞书机器人」，10 秒搞定\n     或手动在 https://open.feishu.cn/ 创建企业自建应用\n\n  3. Node.js 22+ 环境\n     如通过一键安装脚本运行，会自动安装\n\n准备好后继续配置。",
        title: "📋 配置前准备",
        confirmPrompt: "我已准备好以上条件，继续配置？",
      },
      intro: "KaijiBot 配置向导",
      cancelledOutro: "配置已取消。准备好后再来吧！",
      invalidConfigOutro: "配置无效。运行 `{doctorCmd}` 修复后重新执行配置。",
      flow: {
        invalidError: "无效的 --flow 参数（请使用 quickstart、manual 或 advanced）。",
      },
      flowSelect: {
        message: "配置模式",
        quickstartLabel: "快速配置",
        advancedLabel: "手动配置",
      },
      existingConfig: {
        message: "配置处理方式",
        keepLabel: "使用现有配置",
        modifyLabel: "更新配置",
        resetLabel: "重置",
      },
      resetScope: {
        message: "重置范围",
        configOnlyLabel: "仅配置",
        configCredsSessionsLabel: "配置 + 凭证 + 会话",
        fullLabel: "完全重置（配置 + 凭证 + 会话 + 工作空间）",
      },
      modeSelect: {
        message: "你想配置什么？",
        localLabel: "本地网关（本机）",
        remoteLabel: "远程网关（仅信息）",
      },
      remoteConfig: {
        outro: "远程网关已配置。",
      },
      workspace: {
        message: "工作空间目录",
      },
      providerSelect: {
        body: "选择你的 AI 提供商。如需注册 API Key：\n\n  智谱 GLM：https://open.bigmodel.cn/\n  DeepSeek：https://platform.deepseek.com/\n  Anthropic Claude：https://console.anthropic.com/\n  Google Gemini：https://aistudio.google.com/apikey\n  通义千问：https://dashscope.console.aliyun.com/",
        title: "🔑 AI 提供商",
      },
      daemon: {
        installQuestion: "安装网关服务（推荐）",
        runtimeSelect: "网关服务运行时",
        installedAction: "网关服务已安装",
        restartLabel: "重启",
        reinstallLabel: "重新安装",
        skipLabel: "跳过",
        installFailed: "网关服务安装失败。",
        installOk: "网关服务已安装。",
        installFailedNote: "网关服务安装失败：{error}",
      },
      hatch: {
        wakeMessage: "我们将发送唤醒消息来激活机器人。",
        message: "你想怎样启动你的机器人？",
        tuiLabel: "在 TUI 中启动（推荐）",
        webLabel: "打开 Web 控制面板",
        laterLabel: "稍后再说",
        tuiGreeting: "你好！我是你的 KaijiBot 助手。",
      },
      security: {
        notice: "安全提示：不要将 Gateway 暴露在公网，API Key 不要放在 agent 可访问的路径下。",
        title: "安全须知",
      },
      whatNow: {
        body: "接下来：探索 KaijiBot 的认知功能，与你的机器人开始对话。",
      },
      outro: {
        opened: "配置完成。控制面板已打开，保持该标签页即可管理 KaijiBot。",
        background: "配置完成。控制面板链接：",
        default: "配置完成。",
      },
    },
    configure: {
      sectionSelect: {
        message: "选择要配置的分区",
        continueLabel: "继续",
        finishHint: "完成",
        skipHint: "暂时跳过",
      },
      channels: {
        message: "消息渠道",
        configureLabel: "配置/关联",
        removeLabel: "移除渠道配置",
        sectionHint: "配置飞书等消息渠道及默认设置",
      },
      webSearch: {
        enableMessage: "启用 web_search？",
        codexEnableMessage: "为支持 Codex 的模型启用原生 Codex 网络搜索？",
        codexModeMessage: "Codex 原生网络搜索模式",
        hostedMessage: "现在配置或更换托管的网络搜索服务？",
      },
      webFetch: {
        enableMessage: "启用 web_fetch（无需密钥的 HTTP 抓取）？",
      },
      intro: {
        update: "KaijiBot 更新向导",
        configure: "KaijiBot 配置",
      },
      invalidConfigOutro: "配置无效。运行 `{doctorCmd}` 修复后重新执行配置。",
      gatewayLocation: {
        message: "网关运行在哪里？",
        localLabel: "本地（本机）",
        remoteLabel: "远程（仅信息）",
      },
      remoteConfigOutro: "远程网关已配置。",
      workspace: {
        message: "工作空间目录",
      },
      daemonPort: {
        message: "服务安装的网关端口",
      },
      noChanges: "未选择任何更改。",
      gatewayLocalSetOutro: "网关模式已设为本地。",
      completeOutro: "配置完成。",
    },
    daemonRuntime: {
      nodeHint: "Node 运行时稳定性最佳，推荐使用。",
    },
    tool: {
      soul: {
        description:
          "切换灵魂预设。当用户要求改变你的性格或切换灵魂时使用。可用的预设: intj, intp, entj, entp, infj, infp, enfj, enfp, istj, isfj, estj, esfj, istp, isfp, estp, esfp。传入 'default' 恢复默认灵魂。",
        resetMessage: "灵魂预设已移除，下一条消息起恢复默认灵魂。",
        switchedMessage: "灵魂预设已切换为 {preset} — {name}。下一条消息起生效。",
      },
      correction: {
        description:
          "当你发现自己犯了错误并纠正了，或者用户指出了你的错误，调用此工具记录纠正。记录的纠正会在未来的对话中自动注入系统提示，帮助你避免重复同样的错误。不需要每次都调用——只在犯实质性错误时记录。",
        reinforcedMessage: "已强化已有的纠错记录，下次对话会自动提醒。",
        savedMessage: "已记录纠错，下次对话会自动提醒避免此错误。",
      },
      evolution: {
        duplicateSuggestion:
          "发现和已有技能「{name}」太相似，跳过创建。建议用 patch_skill 改进已有技能。",
        qualityRejectedSuggestion: "技能质量不达标（{score}），已跳过创建。",
        savedSuggestion:
          "我自主进化了，创建了一个技能「{name}」—— {description}。如果不需要，可以说「删除技能 {name}」来移除。",
      },
    },
    secrets: {
      reload: {
        success: "Secrets 已重新加载。",
        warning: "Secrets 已重新加载，有 {count} 个警告。",
      },
      audit: {
        summary:
          "Secrets 审计: {status}。plaintext={plaintext}, unresolved={unresolved}, shadowed={shadowed}, legacy={legacy}。",
        moreFindings: "... 还有 {count} 条发现。",
        skippedExecRefs:
          "审计提示: 跳过了 {count} 个 exec SecretRef 可解析性检查。使用 --allow-exec 重新运行以在审计期间执行 exec provider。",
      },
      configure: {
        preflightSummary: "预检: changed={changed}, files={files}, warnings={warnings}。",
        warningLine: "- 警告: {warning}",
        preflightSkippedExecRefs:
          "预检提示: 跳过了 {count} 个 exec SecretRef 可解析性检查。使用 --allow-exec 重新运行以在预检期间执行 exec provider。",
        planSummary:
          "计划: targets={targets}, providerUpserts={providerUpserts}, providerDeletes={providerDeletes}。",
        planWritten: "计划已写入 {path}",
        applyPrompt: "立即应用此计划？",
        irreversiblePrompt: "此迁移对已迁移的明文值是不可逆的。继续应用？",
        applyCancelled: "应用已取消。",
      },
      apply: {
        success: "Secrets 已应用。更新了 {count} 个文件。",
        noChanges: "Secrets 应用: 无更改。",
        dryRunChanges: "Secrets 应用预演: {count} 个文件将会变更。",
        dryRunNoChanges: "Secrets 应用预演: 无更改。",
        dryRunSkippedExecRefs:
          "Secrets 应用预演提示: 跳过了 {count} 个 exec SecretRef 可解析性检查。使用 --allow-exec 重新运行以在预演期间执行 exec provider。",
      },
    },
    skills: {
      search: {
        empty: "未找到 ClawHub skills。",
      },
      install: {
        success: "已安装 {slug}@{version} -> {targetDir}",
      },
      update: {
        noTracked: "没有已跟踪的 ClawHub skills 需要更新。",
        provideSlugOrAll: "请提供 skill slug 或使用 --all。",
        slugOrAll: "请使用 skill slug 或 --all，不可同时使用。",
        updated: "已更新 {slug}: {previousVersion} -> {version}",
        alreadyAt: "{slug} 已是最新版本 {version}",
      },
    },
    hooks: {
      list: {
        noEligible: "未找到符合条件的 hooks。运行 `{cmd}` 查看所有 hooks。",
        empty: "未找到 hooks。",
      },
      info: {
        notFound: 'Hook "{name}" 未找到。运行 `{cmd}` 查看可用 hooks。',
        managedByPlugin: "  由 plugin 管理；无法通过 hooks CLI 启用/禁用。",
      },
      status: {
        ready: "✓ 就绪",
        disabled: "⏸ 已禁用",
        missing: "✗ 缺失",
        readyInfo: "✓ 就绪",
        disabledInfo: "⏸ 已禁用",
        missingInfo: "✗ 缺少依赖",
      },
      heading: {
        hooks: "Hooks",
        hooksStatus: "Hooks 状态",
        details: "详情:",
        requirements: "依赖要求:",
        notReady: "未就绪的 hooks:",
      },
      label: {
        total: "Total hooks:",
        ready: "Ready:",
        notReady: "Not ready:",
        source: "  Source:",
        path: "  Path:",
        handler: "  Handler:",
        homepage: "  Homepage:",
        events: "  Events:",
        blockedReason: "  Blocked reason:",
        binaries: "  Binaries:",
        anyBinary: "  Any binary:",
        environment: "  Environment:",
        config: "  Config:",
        os: "  OS:",
      },
      enable: {
        icon: "✓",
        success: "已启用 hook: {emoji} {name}",
      },
      disable: {
        icon: "⏸",
        success: "已禁用 hook: {emoji} {name}",
      },
      install: {
        deprecated: "`kaijibot hooks install` 已弃用；请使用 `kaijibot plugins install`。",
      },
      update: {
        deprecated: "`kaijibot hooks update` 已弃用；请使用 `kaijibot plugins update`。",
      },
    },
    capability: {
      docs: "文档：",
      envelope: {
        failed: "{capability} 失败：{error}",
        unknownError: "未知错误",
        summary: "{capability} via {transport}",
        providerLabel: "provider: {provider}",
        modelLabel: "model: {model}",
        outputs: "outputs: {count}",
      },
      desc: {
        infer: "通过稳定的 CLI 界面运行 provider 推理命令",
        list: "列出 canonical capability id 和支持的 transport",
        inspect: "查看一个 canonical capability id",
        model: "文本推理和 model catalog 命令",
        modelRun: "运行一次性 model 对话",
        modelList: "列出已知 model",
        modelInspect: "查看一个 model catalog 条目",
        modelProviders: "从 catalog 列出 model provider",
        modelAuth: "Provider 认证辅助工具",
        modelAuthLogin: "运行 provider 认证登录",
        modelAuthLogout: "移除一个 provider 的已保存认证 profile",
        modelAuthStatus: "显示已配置的认证状态",
        image: "图片生成和描述",
        imageGenerate: "生成图片",
        imageEdit: "使用一个或多个输入文件编辑图片",
        imageDescribe: "描述一个图片文件",
        imageDescribeMany: "描述多个图片文件",
        imageProviders: "列出图片生成 provider",
        audio: "音频转录",
        audioTranscribe: "转录一个音频文件",
        audioProviders: "列出音频转录 provider",
        tts: "文本转语音",
        ttsConvert: "将文本转为语音",
        ttsVoices: "列出 TTS provider 的语音",
        ttsProviders: "列出语音 provider",
        ttsStatus: "显示 TTS 状态",
        ttsEnable: "启用 TTS",
        ttsDisable: "禁用 TTS",
        ttsSetProvider: "设置活动的 TTS provider",
        video: "视频生成和描述",
        videoGenerate: "生成视频",
        videoDescribe: "描述一个视频文件",
        videoProviders: "列出视频生成和描述 provider",
        web: "Web 功能",
        webSearch: "运行 Web 搜索",
        webFetch: "获取一个 URL",
        webProviders: "列出 Web provider",
        embedding: "Embedding provider",
        embeddingCreate: "创建 embedding",
        embeddingProviders: "列出 embedding provider",
      },
      opt: {
        outputJson: "输出 JSON",
        promptText: "提示文本",
        modelOverride: "Model 覆盖",
        forceLocal: "强制本地执行",
        forceGateway: "强制 gateway 执行",
        capabilityId: "Capability id",
        modelId: "Model id",
        providerId: "Provider id",
        inputFile: "输入文件",
        imageFile: "图片文件",
        audioFile: "音频文件",
        videoFile: "视频文件",
        size: "尺寸提示，如 1024x1024",
        aspectRatio: "宽高比提示，如 16:9",
        resolution: "分辨率提示：1K、2K 或 4K",
        outputPath: "输出路径",
        inputText: "输入文本",
        channelHint: "Channel 提示",
        voiceHint: "语音提示",
        speechProviderId: "语音 provider id",
        searchQuery: "搜索查询",
        resultLimit: "结果限制",
        url: "URL",
        formatHint: "格式提示",
      },
    },
    gateway: {
      usageCost: {
        title: "用量成本（{days} 天）",
        total: "总计:",
        missingEntries: "缺失条目:",
        latestDay: "最近一天:",
        failed: "Gateway 用量成本查询失败",
      },
      call: {
        title: "Gateway 调用",
        failed: "Gateway 调用失败",
      },
      health: {
        title: "Gateway 健康",
        ok: "正常",
      },
      discovery: {
        title: "Gateway 发现",
        scanning: "正在扫描 gateway…",
        found: "找到 {count} 个 gateway · domains: {domains}",
        failed: "gateway discover 失败",
      },
      run: {
        warningPassword:
          "警告: --password 可能通过进程列表暴露。建议使用 --password-file 或 KAIJIBOT_GATEWAY_PASSWORD。",
        resetRequiresDev: "请将 --reset 与 --dev 一起使用。",
        invalidWsLog: '无效的 --ws-log（请使用 "auto"、"full"、"compact"）',
        invalidPort: "无效的端口",
        invalidBind: '无效的 --bind（请使用 "loopback"、"lan"、"tailnet"、"auto" 或 "custom"）',
        invalidAuth: "无效的 --auth（请使用 {modes}）",
        invalidTailscale: "无效的 --tailscale（请使用 {modes}）",
        loadingModules: "正在加载 gateway 模块…",
        guard: {
          missingConfig:
            "缺少配置。运行 `{cmd}` 或设置 gateway.mode=local（或传递 --allow-unconfigured）。",
          blockedMissingMode: "Gateway 启动被阻止: 现有配置缺少 gateway.mode。",
          blockedMissingModeHint: "请将此视为可疑或被损坏的配置。",
          blockedMissingModeAction:
            "重新运行 `{onboard}` 或 `{setup}`，手动设置 gateway.mode=local，或传递 --allow-unconfigured。",
          blockedWrongMode:
            "Gateway 启动被阻止: 设置 gateway.mode=local（当前: {mode}）或传递 --allow-unconfigured。",
          configAudit: "配置写入审计: {path}",
        },
        hint: {
          gatewayTokenMiskey: '在配置中发现 "gateway.token"。请改用 "gateway.auth.token"。',
          remoteTokenMiskey:
            '"gateway.remote.token" 用于远程 CLI 调用；它不会启用本地 gateway 认证。',
        },
        error: {
          passwordNotConfigured: "Gateway 认证设置为 password，但未配置密码。",
          passwordNotConfiguredHint:
            "设置 gateway.auth.password（或 KAIJIBOT_GATEWAY_PASSWORD），或传递 --password。",
          refusingBind: "拒绝在无认证的情况下将 gateway 绑定到 {bind}。",
          containerDetected:
            "检测到容器环境 — gateway 默认使用 bind=auto (0.0.0.0) 以兼容端口转发。",
          containerHint:
            "设置 KAIJIBOT_GATEWAY_TOKEN 或 KAIJIBOT_GATEWAY_PASSWORD，或传递 --token/--password 以带认证启动。",
          bindHint:
            "设置 gateway.auth.token/password（或 KAIJIBOT_GATEWAY_TOKEN/KAIJIBOT_GATEWAY_PASSWORD）或传递 --token/--password。",
          failedToStart:
            "Gateway 启动失败: {message}\n如果 gateway 被托管，请使用以下命令停止: {cmd}",
          failedToStartGeneric: "Gateway 启动失败: {message}",
        },
      },
    },
    channels: {
      login: {
        failed: "Channel 登录失败",
      },
      logout: {
        failed: "Channel 登出失败",
      },
    },
    mcp: {
      list: {
        empty: "在 {path} 中未配置 MCP server。",
        header: "MCP servers ({path}):",
      },
      show: {
        one: 'MCP server "{name}" ({path}):',
      },
      set: {
        saved: '已保存 MCP server "{name}" 到 {path}。',
      },
      unset: {
        removed: '已从 {path} 移除 MCP server "{name}"。',
      },
    },
    models: {
      docs: "文档：",
      desc: {
        models: "Model 发现、扫描和配置",
        list: "列出 model（默认已配置的）",
        status: "显示已配置的 model 状态",
        set: "设置默认 model",
        setImage: "设置图片 model",
        aliases: "管理 model 别名",
        aliasesList: "列出 model 别名",
        aliasesAdd: "添加或更新 model 别名",
        aliasesRemove: "移除 model 别名",
        fallbacks: "管理 model fallback 列表",
        fallbacksList: "列出 fallback model",
        fallbacksAdd: "添加 fallback model",
        fallbacksRemove: "移除 fallback model",
        fallbacksClear: "清除所有 fallback model",
        imageFallbacks: "管理图片 model fallback 列表",
        imageFallbacksList: "列出图片 fallback model",
        imageFallbacksAdd: "添加图片 fallback model",
        imageFallbacksRemove: "移除图片 fallback model",
        imageFallbacksClear: "清除所有图片 fallback model",
        scan: "扫描 OpenRouter 免费模型（支持 tools + images）",
        auth: "管理 model auth profile",
        authAdd: "交互式认证辅助（provider 认证或粘贴 token）",
        authLogin: "运行 provider plugin 认证流程（OAuth/API key）",
        authSetupToken: "运行 provider CLI 创建/同步 token（需要 TTY）",
        authPasteToken: "粘贴 token 到 auth-profiles.json 并更新配置",
        authLoginGithubCopilot: "通过 GitHub device flow 登录 GitHub Copilot（需要 TTY）",
        order: "管理 per-agent auth profile 顺序覆盖",
        orderGet: "显示 per-agent auth 顺序覆盖（来自 auth-state.json）",
        orderSet: "设置 per-agent auth 顺序覆盖（写入 auth-state.json）",
        orderClear: "清除 per-agent auth 顺序覆盖（回退到 config/round-robin）",
      },
      opt: {
        statusJson: "输出 JSON（`models status --json` 的别名）",
        statusPlain: "纯文本输出（`models status --plain` 的别名）",
        agent: "要检查的 Agent id（覆盖 KAIJIBOT_AGENT_DIR/PI_CODING_AGENT_DIR）",
        all: "显示完整 model catalog",
        local: "过滤本地 model",
        provider: "按 provider 过滤",
        json: "输出 JSON",
        plain: "纯文本输出",
        plainLine: "纯文本行输出",
        check: "如果 auth 即将过期/已过期则非零退出（1=过期/缺失，2=即将过期）",
        probe: "探测已配置的 provider auth（实时）",
        probeProvider: "仅探测单个 provider",
        probeProfile: "仅探测特定 auth profile id（可重复或逗号分隔）",
        probeTimeout: "每次探测超时（毫秒）",
        probeConcurrency: "并发探测数",
        probeMaxTokens: "探测最大 token（尽力而为）",
        model: "Model id 或别名",
        minParams: "最小参数规模（十亿）",
        maxAgeDays: "跳过超过 N 天的 model",
        maxCandidates: "最大 fallback 候选数",
        timeout: "每次探测超时（毫秒）",
        concurrency: "探测并发数",
        noProbe: "跳过实时探测；仅列出免费候选",
        yes: "接受默认值，不提示",
        noInput: "禁用提示（使用默认值）",
        setDefault: "将 agents.defaults.model 设为首个选择",
        setImage: "将 agents.defaults.imageModel 设为首个图片选择",
        providerId: "plugin 注册的 Provider id",
        method: "Provider auth method id",
        applyDefault: "应用 provider 的默认 model 推荐",
        providerName: "Provider id",
        skipConfirm: "跳过确认",
        profileId: "Auth profile id（默认：<provider>:manual）",
        expiresIn: "可选过期时长（如 365d、12h）。存储为绝对 expiresAt。",
        overwrite: "覆盖已有 profile，不提示",
        aliasName: "别名名称",
      },
    },
    directory: {
      self: {
        title: "Self",
        notAvailable: "不可用。",
      },
      peers: {
        title: "Peers",
        empty: "未找到 peers。",
      },
      groups: {
        title: "Groups",
        empty: "未找到 groups。",
      },
      groupMembers: {
        title: "Group Members",
        empty: "未找到群组成员。",
      },
    },
    dns: {
      setup: {
        title: "DNS 设置",
        recommendedConfig: "推荐配置 ($KAIJIBOT_CONFIG_PATH, 默认 ~/.kaijibot/kaijibot.json):",
        tailscaleAdmin: "Tailscale 管理 (DNS → Nameservers):",
        addNameserver: "- 添加 nameserver: {ip}",
        thisMachineIpv4: "<本机的 tailnet IPv4>",
        splitDns: "- 限制到域名 (Split DNS): {domain}",
        runWithApply: "使用 --apply 运行以安装 CoreDNS 并配置。",
        startingCoreDNS: "正在启动 CoreDNS (sudo)…",
        noteEnableDiscovery:
          "注意: 在活跃的 KaijiBot 配置 ($KAIJIBOT_CONFIG_PATH, 默认 ~/.kaijibot/kaijibot.json) 中启用 discovery.wideArea.enabled，并重启 gateway 使其写入 DNS-SD zone。",
      },
    },
    daemon: {
      label: {
        service: "Service：",
        fileLogs: "日志文件：",
        command: "命令：",
        serviceFile: "Service 文件：",
        workingDir: "工作目录：",
        serviceEnv: "Service 环境变量：",
        gateway: "Gateway：",
        probeTarget: "探测目标：",
        dashboard: "控制面板：",
        probeNote: "探测备注：",
        runtime: "运行时：",
        rpcProbe: "RPC 探测：",
        rpcAuth: "RPC 认证：",
        rpcTarget: "RPC 目标：",
        listening: "监听：",
        note: "备注：",
        troubles: "故障排查：",
        troubleshooting: "疑难排查：",
        configCli: "Config (cli)：",
        configService: "Config (service)：",
      },
      status: {
        configOutdated: "Service 配置看起来过期或非标准。",
        configIssue: "Service 配置问题：",
        recommendation: '建议：运行 "{doctorCmd}"（或 "{doctorRepairCmd}"）。',
        configIssueLabel: "Config 问题：",
        serviceConfigIssueLabel: "Service config 问题：",
        rootCause:
          "根本原因：CLI 和 service 使用不同的 config 路径（可能是 profile/state-dir 不匹配）。",
        fixConfigMismatch:
          "修复：从你期望的 --profile / KAIJIBOT_STATE_DIR 重新运行 `{gatewayInstallCmd}`。",
        warmUp: "预热中：launch agent 可能需要几秒钟。请稍后重试。",
        rpcOk: "正常",
        rpcFailed: "失败",
        dashboardDisabled: "已禁用",
        systemdUnavailable: "systemd 用户服务不可用。",
        serviceUnitNotFound: "未找到 Service unit。",
        serviceLoadedNotRunning: "Service 已加载但未运行（可能立即退出了）。",
        cachedLabelMissing:
          "LaunchAgent label 已缓存但 plist 缺失。清除：launchctl bootout gui/$UID/{label}",
        reinstallAfterClear: "然后重新安装：{gatewayInstallCmd}",
        portNotListening: "Gateway 端口 {port} 未在监听（service 似乎在运行）。",
        lastError: "最后一次 gateway 错误：",
        logs: "日志：",
        errors: "错误：",
        otherServicesDetected: "检测到其他类似 gateway 的 service（尽力检测）：",
        cleanupHint: "清理提示：",
        singleGatewayRecommendation:
          "建议：大多数设置每台机器只运行一个 gateway。一个 gateway 支持多个 agent（见文档：/gateway#multiple-gateways-same-host）。",
        multipleGatewaysNote:
          "如果需要多个 gateway（例如同机 rescue bot），请隔离端口 + config/state（见文档：/gateway#multiple-gateways-same-host）。",
        pidNotOwningPort: "Gateway 运行时 PID 未占用监听端口。其他 gateway 进程正在监听：{pids}",
        fixPidNotOwning: "修复：运行 {gatewayRestartCmd} 并用 {gatewayStatusCmd} 重新检查。",
      },
      troubleshootingUrl:
        "https://gitee.com/kaiji1126/kaijibot/blob/main/docs/help/troubleshooting.md",
      uninstall: {
        noServiceManager: "{platform} 上没有服务管理器。无需卸载。",
      },
      start: {
        noServiceManager: "{platform} 上没有服务管理器。直接启动 gateway: {cmd}",
      },
      stop: {
        notRunning: "Gateway 未运行。",
      },
      restart: {
        noProcess: "在端口 {port} 上未找到 gateway 进程。使用 {cmd} 启动。",
        timeoutPort: "等待 gateway 端口 {port} 变为健康状态超时（{seconds}秒）。",
        stoppingStale: "正在停止过期进程并重试重启...",
      },
    },
    execApprovals: {
      docs: "文档：",
      writingLocal: "正在写入本地审批配置。",
      target: "目标：{target}",
      showingLocal: "显示本地审批配置。",
      effectivePolicy: "Effective Policy",
      noEffectivePolicy: "无有效的策略详情。",
      precedence: "优先级：{note}",
      approvals: "Approvals",
      allowlist: "Allowlist",
      noAllowlistEntries: "无 allowlist 条目。",
      examples: "示例：",
      error: {
        provideFileOrStdin: "请提供 --file 或 --stdin。",
        useEitherFileOrStdin: "请使用 --file 或 --stdin（不可同时使用）。",
        hashMissing: "Exec approvals hash 缺失；请重新加载后重试。",
        parseFailed: "解析审批 JSON 失败：{error}",
        patternRequired: "需要 pattern。",
      },
      mutation: {
        alreadyAllowlisted: "已在 allowlist 中。",
        patternNotFound: "未找到 pattern。",
      },
    },
    plugins: {
      docs: "文档：",
      list: {
        noPlugins: "未找到 plugin。",
        header: "Plugins",
        loadedCount: "({loaded}/{total} 已加载)",
        sourceRoots: "Source roots:",
      },
      inspect: {
        passIdOrAll: "请传入 plugin id 或 --all，不能同时使用。",
        provideIdOrAll: "请提供 plugin id 或使用 --all。",
        notFound: "未找到 plugin：{id}",
        status: "状态：",
        failurePhase: "失败阶段：",
        failedAt: "失败时间：",
        format: "格式：",
        bundleFormat: "Bundle 格式：",
        source: "来源：",
        origin: "Origin：",
        version: "版本：",
        shape: "Shape：",
        capabilityMode: "Capability 模式：",
        legacyBeforeAgentStart: "旧版 before_agent_start：",
        bundleCapabilities: "Bundle capabilities：",
        error: "错误：",
      },
      enable: {
        success: '已启用 plugin "{id}"。重启 gateway 以生效。',
        couldNotEnable: 'Plugin "{id}" 无法启用（{reason}）。',
      },
      disable: {
        success: '已禁用 plugin "{id}"。重启 gateway 以生效。',
      },
      uninstall: {
        keepConfigDeprecated: "`--keep-config` 已弃用，请使用 `--keep-files`。",
        notManaged: 'Plugin "{id}" 不受 plugins config/install 记录管理，无法卸载。',
        notFound: "未找到 plugin：{id}",
        pluginLabel: "Plugin：",
        willRemove: "将移除：{items}",
        dryRun: "预演模式，未做更改。",
        cancelled: "已取消。",
        uninstalled: '已卸载 plugin "{id}"。移除项：{items}。',
        restart: "重启 gateway 以应用更改。",
      },
      doctor: {
        noIssues: "未检测到 plugin 问题。",
        errors: "Plugin 错误：",
        diagnostics: "诊断：",
        compatibility: "兼容性：",
      },
      marketplace: {
        noPlugins: "在 marketplace {source} 中未找到 plugin。",
        header: "Marketplace",
      },
      install: {
        linkedHookPack: "已链接 hook pack 路径: {path}",
        linkedPlugin: "已链接 plugin 路径: {path}",
        configInvalid: "配置无效；请先运行 `kaijibot doctor --fix` 再安装 plugins。",
        configUnparseable: "配置文件无法解析；请运行 `kaijibot doctor` 修复。",
        configInvalidBundledRecovery:
          "在 bundled 恢复路径之外的配置无效（{plugin}）；请先运行 `kaijibot doctor --fix` 再重新安装。",
        linkNotMarketplace: "`--link` 不支持与 `--marketplace` 一起使用。",
        pinNotMarketplace: "`--pin` 不支持与 `--marketplace` 一起使用。",
        forceNotLink: "`--force` 不支持与 `--link` 一起使用。",
        linkRequiresPath: "`--link` 需要本地路径。",
        pathNotFound: "路径未找到: {path}",
      },
      update: {
        noTracked: "没有已跟踪的 plugins 或 hook packs 需要更新。",
        provideIdOrAll: "请提供 plugin 或 hook-pack id，或使用 --all。",
        restartGateway: "重启 gateway 以加载 plugins 和 hooks。",
      },
    },
    devices: {
      fallbackNotice: "直接 scope 访问失败；使用本地回退。",
      list: {
        pending: "待处理",
        paired: "已配对",
        noEntries: "无设备配对条目。",
      },
      error: {
        deviceAndRoleRequired: "需要 --device 和 --role",
        deviceIdRequired: "需要 deviceId",
        refuseClearWithoutYes: "拒绝在没有 --yes 的情况下清除配对表",
        noPendingRequests: "没有待审批的设备配对请求",
        unknownRequestId: "未知的 requestId",
      },
      action: {
        removed: "已移除",
        cleared: "已清除",
        clearedCount: "已清除 {count} 个已配对设备{s}",
        rejected: "已拒绝",
        rejectedCount: "已拒绝 {count} 个待处理请求{s}",
        approved: "已批准",
      },
    },
    pairing: {
      list: {
        empty: "没有待处理的 {channel} 配对请求。",
        header: "配对请求",
      },
      approve: {
        approved: "已批准",
        sender: "sender",
        notifyFailed: "通知请求者失败: {error}",
      },
    },
    config: {
      load: {
        invalidAt: "配置无效: {path}。",
        repairHint: "来修复，然后重试。",
      },
      get: {
        pathNotFound: "配置路径未找到: {path}",
      },
      unset: {
        pathNotFound: "配置路径未找到: {path}",
        removed: "已移除 {path}。重启 gateway 以应用。",
      },
      set: {
        updated: "已更新 {path}。重启 gateway 以应用。",
        updatedMultiple: "已更新 {count} 个配置路径。重启 gateway 以应用。",
      },
      validate: {
        fileNotFound: "配置文件未找到: {path}",
        invalidAt: "配置无效: {path}:",
        repairHint: "来修复，或手动修正上方键值。",
        valid: "配置有效: {path}",
      },
    },
    completion: {
      install: {
        unsupported: "暂不支持自动安装 {shell} 的补全。",
        cacheNotFound: "在 {path} 未找到补全缓存。请先运行 `{bin} completion --write-state`。",
        profileNotFound: "在 {path} 未找到 profile。已创建新文件。",
        alreadyInstalled: "补全已安装在 {path}",
        updating: "正在更新补全:",
        installing: "正在安装补全:",
        done: "补全已安装。重启 shell 或运行: source {path}",
        failed: "安装补全失败: {error}",
      },
    },
    statusHealth: {
      docs: "文档：",
      examples: "示例：",
      sessionsHint:
        "当 agent 报告 token 使用量时显示每个 session 的 token 用量；设置 agents.defaults.contextTokens 来限制窗口并显示百分比。",
      error: {
        timeoutPositiveInt: "--timeout 必须是正整数（毫秒）",
      },
    },
    runMain: {
      uncaughtException: "[kaijibot] 未捕获的异常:",
    },
    prompt: {
      yesNo: " [Y/n] ",
      noYes: " [y/N] ",
    },
  },
};
