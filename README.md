# KaijiBot 👾

> **你的 AI 助手会主动找你聊天，而不是干等着你提问。**

Fork of [OpenClaw](https://github.com/openclaw/openclaw) · 飞书 + 30+ LLM 提供商 · 认知层让 AI 从被动变主动

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js >=22](https://img.shields.io/badge/Node.js-%3E%3D22-339933.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.x-3178C6.svg)](https://www.typescriptlang.org/)
[![Vitest 420+ tests](https://img.shields.io/badge/Vitest-420%2B%20tests-6DA55F.svg)](https://vitest.dev/)
[![简体中文](https://img.shields.io/badge/语言-简体中文-red.svg)]()

## 为什么是 KaijiBot

你用过的 AI 助手都一个模式：你问，它答。你不问，它就安静地待在那里。

KaijiBot 不一样。它在飞书里跟你聊了几次之后，会开始**主动**给你发消息。不是广告，不是提醒喝水，而是你真正可能感兴趣的东西。

| | 普通聊天机器人 | KaijiBot |
|---|---|---|
| **交互方式** | 你问它才答 | 主动推送洞察 + 正常对话 |
| **用户理解** | 无状态，每次从零开始 | 持续学习你的兴趣、领域、偏好 |
| **时机感知** | 不管你在干嘛 | 尊重活跃时段、信任阶段、对话频率 |
| **中文支持** | 英文优先，中文常掉队 | 中文原生优化，模式路由、画像提取均针对中文设计 |
| **渠道集成** | 需要 Web/SDK 接入 | 飞书即终端，发消息就能用 |

## ✨ 核心特性

### 🔮 认知引擎 — 从被动回复到主动洞察

你在飞书里跟 KaijiBot 聊了几次 AI 架构和分布式系统，下周它主动发来一条消息：

> "最近看到一篇关于用 eBPF 做分布式追踪的文章，结合你之前关注的可观测性方向，可能有启发。"

这不是预设推送，是 KaijiBot 真正**理解了你**之后产生的洞察。

再过两周，你又聊了几个关于 Rust 和嵌入式的话题。某天它告诉你：

> "你最近在学 Rust，同时之前对嵌入式系统感兴趣，这两者的交集里有一篇关于用 Rust 写 RTOS 内核的实战文章，值得看看。"

它怎么做到的：

- **Persona 画像** — 每次对话都在学习你。采用双阶段提取（规则引擎 + LLM 兜底），从对话中提取领域、兴趣、沟通风格并存入结构化画像。兴趣和领域知识带时间衰减，不再讨论的话题会自然淡化。
- **跨域洞察** — 你同时关注 A 和 B，它发现二者有潜在联系。你之前问过但没深入的问题，它从新角度跟进。你在某个领域钻得够深了，它推荐延伸方向。领域间通过共现图谱建立关联（支持 2-hop 间接连接），图谱边同样带衰减。域冷却机制避免短期内重复推荐同一领域。
- **时机门控** — 不是想发就发。基于信号检测论的 PRISM 模型计算每条洞察的期望价值，只有当预期收益超过打扰成本时才推送。凌晨不打扰，信任度低时克制，你最近活跃度低就先等等。
- **信任演化** — 刚认识时谨慎试探，聊多了之后越来越懂你，最终变成可以大胆推荐的深度伙伴。四个阶段（SARA 框架）：定向 → 探索 → 融洽 → 伙伴，信任等级决定系统被允许做什么。
- **偏好学习** — 你回复长了、追问了"为什么"，它记下你喜欢这个话题。你敷衍了，它下次换一个方向。每个话题维护一组 Thompson Sampling 参数（Beta 分布），隐式反馈（回复深度、响应延迟）比显式反馈更诚实。

洞察内容结合你的画像 + LLM 知识 + 实时网络搜索生成。配了 Exa 或 Tavily API Key，洞察会紧跟时事。

### 🧬 自我进化 — Agent 自主判断何时学新技能

你跟 KaijiBot 连续做了几次复杂的飞书知识库整理操作——搜索会议记录、提取纪要、创建文档、设置任务。KaijiBot 发现这个流程重复且复杂，主动跟你说：

> "我注意到你最近几次都在做类似的会议纪要归档流程，我给自己写了个技能，以后你说'归档会议'我就自动执行整个流程。"

或者它默默学会了，过几天找机会轻描淡写地告诉你它进化了什么。

它怎么做到的：

- **Hard Trigger 检测** — 代码层只做一件事：检测你这次对话用了 3 个以上工具（噪音过滤）。不调 LLM、不做质量判断。
- **Agent 自主决策** — 检测到后注入一条系统事件（含工具序列和错误信息），触发 Agent turn。Agent 拥有完整对话上下文，自己判断是否值得做成技能。不值得就忽略。
- **无冷却无上限** — 没有代码级的频率限制或复杂度门槛。Agent 看到近期建议历史，自己决定频率。如果觉得频繁但确实值得，就默默创建技能、不打扰你，等合适时机再提。
- **完整生命周期** — 创建前去重检查、创建后跟踪使用频率、30 天不用自动清理。

### 🔌 62 个扩展开箱即用

不绑死任何一家。国内国际随意切换，`kaijibot onboard` 向导自动发现已配置的 API Key。

| 国内（推荐） | 国际主流 | 聚合 / 自部署 |
|---|---|---|
| 智谱 GLM · DeepSeek · 通义千问 · Kimi · MiniMax · 百度千帆 · 阶跃星辰 · 火山引擎 · BytePlus · Kimi Coding · 小米 · Alibaba | Claude · Gemini · Grok · Mistral · Perplexity · Groq · Nvidia · HuggingFace · OpenAI | OpenRouter · LiteLLM · Together · Fireworks · Cloudflare AI · Vercel AI · SGLang · vLLM · Ollama · LMStudio |

切换模型只需一行：

```bash
kaijibot config set agent.model "deepseek/deepseek-chat"
kaijibot config set agent.model "qwen/qwen-max"
kaijibot config set agent.model "anthropic/claude-sonnet-4-20250514"
```

### 🛠️ 21 个内置技能 + 完整智能体

**Agent 循环**：推理 → 调用工具 → 观察 → 继续推理，支持流式输出、上下文压缩、子智能体并行派生。

**内置工具**：代码执行、网页抓取、PDF 操作、图片/视频/音乐生成、TTS 语音合成、Canvas 画布、文件读写、cron 定时任务，共 20+。支持模型故障转移和 API Key 轮换。

**记忆系统**：三种存储后端（内存、LanceDB 向量库、Wiki 知识库），语义搜索历史对话，定期整理巩固记忆（类似人类睡眠时的记忆处理），短期重要信息自动晋升为长期知识。梦境系统独立存储，不污染每日记忆文件。会话记忆双输出：结构化摘要用于搜索检索 + 折叠的原始对话用于上下文恢复。

**定时任务**：`at`（一次性）、`every`（间隔）、`cron`（cron 表达式 + 时区），支持消息投递、webhook 回调或静默执行，失败自动重试。

**技能市场**：github、weather、summarize、coding-agent、notion、obsidian、nano-pdf、taskflow、blogwatcher 等 21 个内置技能，更多从 ClawHub 安装：

```bash
kaijibot skills install <skill-name>
```

## 🚀 快速开始

**前置要求**：Node.js >= 22（推荐 24）、pnpm、git

**方式一：一键安装**

```bash
curl -fsSL https://raw.githubusercontent.com/Kaiji-Z/kaijibot/main/install.sh | bash
```

**方式二：Docker**

```bash
git clone https://github.com/Kaiji-Z/kaijibot.git
cd kaijibot
docker compose up -d
```

**方式三：手动安装**

```bash
git clone https://github.com/Kaiji-Z/kaijibot.git
cd kaijibot
# 国内镜像加速
pnpm install --registry https://registry.npmmirror.com
pnpm build
kaijibot onboard   # 交互式向导，自动配置
```

**启动**

```bash
kaijibot gateway --port 18789 --verbose
```

启动后在飞书里找到你的机器人，发一条消息。KaijiBot 自动开始构建你的认知画像，几轮对话后会主动推送第一条洞察。

## ⚙️ 配置

**必需**：至少一个 LLM 提供商的 API Key + 飞书机器人凭证。

```bash
# LLM API Key（任选一个，模型用哪个就配哪个）
export ZAI_API_KEY="your-key"              # 智谱 GLM
# export DEEPSEEK_API_KEY="your-key"       # DeepSeek
# export DASHSCOPE_API_KEY="your-key"      # 通义千问
# export MOONSHOT_API_KEY="your-key"       # Kimi
# export ANTHROPIC_API_KEY="your-key"      # Claude
# export GOOGLE_API_KEY="your-key"         # Gemini

# 飞书频道
kaijibot config set channels.feishu.appId "your-app-id"
kaijibot config set channels.feishu.appSecret "your-app-secret"
```

**可选**：网络搜索增强洞察时效性。

```bash
export EXA_API_KEY="your-key"
export TAVILY_API_KEY="your-key"
```

配置文件位于 `~/.kaijibot/kaijibot.json`，支持热重载。认知系统可通过 `cognitive.enabled: false` 关闭，退化为纯 OpenClaw 体验。

## 🏗️ 架构概览

### 认知洞察流程

```
事件源（定时器 + 随机抖动 / 画像变更 / 信息扫描）
  → PRISM 门控（pNeed × pAccept > 成本阈值？）
    → 搜索洞察机会（跨域连接 / 领域深度 / 三模式探索）
      → 域冷却 + 饥饿加成 → 选最佳机会
        → 统一管线生成洞察（模式路由 via timestamp % 100）：
            知识模式（40%）：Web 搜索 + LLM → 质量重试 → 来源验证
            模式模式（50%）：对话碎片聚类 → LLM 行为洞察 → 部分验证
            延伸模式（10%）：用户已知领域 → LLM 深度建议
          → 安全网去重（三元组 0.95）
            → 投递到你的飞书会话
              → 收集反馈 → 更新画像与信任模型
```

### 自我进化流程

```
Agent 完成任务（≥3 次工具调用）
→ 代码检测 ≥3 次工具调用（噪音过滤，不调 LLM）
→ 直接注入系统事件 → 触发 Agent turn
      → Agent 看到完整对话上下文 + 近期建议历史
        → 值得做技能？→ 生成技能草稿 → 问用户或静默创建
        → 不值得？→ 忽略
        → 太频繁但值得？→ 默默创建，稍后告知
```

### 技术架构

Gateway 提供 WebSocket + HTTP 双协议，100+ RPC 方法，兼容 OpenAI API（`/v1/chat/completions`）和 MCP 协议。插件 SDK 支持 20+ 生命周期钩子，扩展可按 npm 包、Git 仓库或内置方式加载。会话按渠道 + 对话方隔离。

Agent 系统实现完整的推理循环：系统提示组装（上下文文件 + 认知模式 + 工具描述 + 记忆搜索）→ LLM 推理 → 工具调用 → 观察 → 继续推理 → 流式输出。支持上下文压缩、子 agent 并行派生、模型故障转移和 API Key 轮换。

项目规模：`src/agents/`（762 文件）、`src/infra/`（484）、`src/gateway/`（356）、`src/plugin-sdk/`（341）、`src/plugins/`（256）、`src/cognitive/`（9+ 模块）。

## 📦 扩展与技能

**62 个扩展**覆盖全部能力层：

| 类别 | 扩展 |
|---|---|
| **消息渠道** | feishu（飞书） |
| **国内 LLM** | 智谱 GLM · DeepSeek · 通义千问 · Kimi · MiniMax · 百度千帆 · 阶跃星辰 · 火山引擎 · BytePlus · Kimi Coding · 小米 · Alibaba |
| **国际 LLM** | Claude · Gemini · Grok · Mistral · Perplexity · Groq · Nvidia · HuggingFace · OpenAI |
| **聚合 / 网关** | OpenRouter · LiteLLM · Together · Fireworks · Cloudflare AI · Vercel AI · Copilot Proxy · Microsoft · Microsoft Foundry · Anthropic Vertex |
| **自部署** | Ollama · LMStudio · SGLang · vLLM |
| **开发工具** | OpenCode · OpenCode-Go · Open-Prose · OpenShell · Kilocode · Arcee · Chutes · Venice · Vydra · Runway |
| **搜索 / 浏览器** | Exa · Tavily · Browser（Playwright） |
| **记忆** | Memory-Core · Memory-LanceDB · Memory-Wiki |
| **语音 / 媒体** | Speech-Core · Talk-Voice · Media-Understanding · Image-Generation |
| **工具类** | Diffs · LLM-Task · Device-Pair · Webhooks · Shared · GitHub-Copilot |

**21 个内置技能**：github、gh-issues、weather、summarize、coding-agent、mcporter、skill-creator、session-logs、healthcheck、notion、obsidian、canvas、nano-pdf、taskflow、taskflow-inbox-triage、clawhub、video-frames、gifgrep、node-connect、blogwatcher、sherpa-onnx-tts。

需要更多？`kaijibot skills install <name>` 从 ClawHub 安装。

## 致谢

基于 [OpenClaw](https://github.com/openclaw/openclaw) 开源项目开发。

### 学术研究

认知系统的设计借鉴了以下研究：

**基础理论**

- Green, D. M., & Swets, J. A. (1966). *Signal detection theory and psychophysics*. Wiley.
- Thompson, W. R. (1933). On the likelihood that one unknown probability exceeds another in view of the evidence of two samples. *Biometrika*, 25(3/4), 285–294.
- Altman, I., & Taylor, D. A. (1973). *Social penetration: The development of interpersonal relationships*. Holt, Rinehart & Winston.
- Gentner, D. (1983). Structure-mapping: A theoretical framework for analogy. *Cognitive Science*, 7(2), 155–170.

**人机关系与推荐系统**

- Bickmore, T. W., & Picard, R. W. (2005). Establishing and maintaining long-term human-computer relationships. *ACM Transactions on Computer-Human Interaction*, 12(2), 293–327.
- Kotkov, D., Wang, S., & Veijalainen, J. (2016). A survey of serendipity in recommender systems. *Knowledge-Based Systems*, 111, 180–192.

**LLM 画像与记忆**

- DEEPER: Directed Persona Refinement. (2025). *Proceedings of ACL 2025*. 32.2% error reduction via active contradiction resolution in persona maintenance.
- PERSONAMEM: Persona-Aware Memory in LLMs. (2025). *Proceedings of COLM 2025*. Benchmark showing LLMs achieve ~50% accuracy on evolving profile tasks.
- DV365: Dynamic User Representations over 365 Days. (2025). *Proceedings of KDD 2025*. Instagram's multi-slicing user embedding architecture.
- GemiRec: Gemini-Powered Recommendations. (2025). Xiaohongshu's multi-interest vector architecture with codebook quantization.
- PIE: Personalized Interest Exploration. (2023). *Proceedings of WWW 2023*. Personalized PageRank with bandit exploration.
- ProfiLLM: Fully Implicit User Profiling from Chatbot Interactions. (2025).

### 工业界参考

画像提取的双阶段设计（事实抽取 + 冲突消解）参考了 [ChatGPT Memory](https://openai.com/index/memory/) 的 mem0 架构。时间衰减的兴趣权重借鉴了 [Spotify](https://research.atspotify.com/) 的 taste profile 机制。领域共现图谱的思路来自 [TikTok/抖音](https://www.tiktok.com/) 的兴趣图和 [小红书](https://www.xiaohongshu.com/) 的多兴趣向量设计。隐式反馈优于显式反馈的判断依据来自 [Instagram](https://about.instagram/) 的 DM 分享质量信号和 [Netflix](https://research.netflix.com/) 的留存优化研究。关系叙事压缩参考了 [Character.AI](https://character.ai/) 的关系摘要机制。

### 开源依赖

[飞书开放平台](https://open.feishu.cn/)、[Vitest](https://vitest.dev/)、[Playwright](https://playwright.dev/)、[tsdown](https://github.com/nicepkg/tsdown)、[Zod](https://zod.dev/)。

## 许可证

[MIT](LICENSE)
