# KaijiBot 👾

> **你的 AI 助手会主动找你聊天，而不是干等着你提问。**

可插拔 provider/channel 架构 · 认知层让 AI 从被动变主动 · 30+ LLM 提供商

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js >=22](https://img.shields.io/badge/Node.js-%3E%3D22-339933.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.x-3178C6.svg)](https://www.typescriptlang.org/)

**README** | [English](./README.en.md) | **简体中文**

## 为什么是 KaijiBot

你用过的 AI 助手都一个模式：你问，它答。你不问，它就安静地待在那里。

KaijiBot 不一样。它在飞书里跟你聊了几次之后，会开始**主动**给你发消息。不是广告，不是提醒喝水，而是你真正可能感兴趣的东西。

|              | 普通聊天机器人       | KaijiBot                                       |
| ------------ | -------------------- | ---------------------------------------------- |
| **交互方式** | 你问它才答           | 主动推送洞察 + 正常对话                        |
| **用户理解** | 无状态，每次从零开始 | 持续学习你的兴趣、领域、偏好                   |
| **时机感知** | 不管你在干嘛         | 尊重活跃时段、信任阶段、对话频率               |
| **中文支持** | 英文优先，中文常掉队 | 中文原生优化，模式路由、画像提取均针对中文设计 |
| **渠道集成** | 需要 Web/SDK 接入    | 飞书即终端，发消息就能用                       |

## ✨ 核心特性

### 🔮 认知引擎 — 从被动回复到主动洞察

你在飞书里跟 KaijiBot 聊了几次 AI 架构和分布式系统，下周它主动发来一条消息：

> "最近看到一篇关于用 eBPF 做分布式追踪的文章，结合你之前关注的可观测性方向，可能有启发。"

这不是预设推送，是 KaijiBot 真正**理解了你**之后产生的洞察。

再过两周，你又聊了几个关于 Rust 和嵌入式的话题。某天它告诉你：

> "你最近在学 Rust，同时之前对嵌入式系统感兴趣，这两者的交集里有一篇关于用 Rust 写 RTOS 内核的实战文章，值得看看。"

它怎么做到的：

- **Persona 画像** — 每次对话都在学习你。LLM 驱动的结构化提取，从对话中自动发现领域和兴趣。洞察按类别独立衰减，兴趣生命周期自动追踪。领域由 LLM 动态发现，不依赖硬编码关键词。
- **跨域洞察** — 你同时关注 A 和 B，它发现二者有潜在联系。你之前问过但没深入的问题，它从新角度跟进。你在某个领域钻得够深了，它推荐延伸方向。LLM 自我精炼保证质量，语义去重确保每次推送都有新意。
- **时机门控** — 不是想发就发。PRISM 模型计算每条洞察的期望价值，只有预期收益超过打扰成本时才推送。凌晨不打扰，信任度低时克制，你最近活跃度低就先等等。
- **信任演化** — 刚认识时谨慎试探，聊多了越来越懂你，最终变成可以大胆推荐的深度伙伴。SARA 框架驱动四个阶段的信任演化，信任等级决定系统被允许做什么。
- **偏好学习** — 你回复长了、追问了"为什么"，它记下你喜欢这个话题。你敷衍了，它下次换一个方向。Thompson Sampling 驱动的偏好学习，隐式反馈比显式反馈更诚实。

洞察内容结合你的画像 + LLM 知识 + 实时网络搜索生成。配了搜索 API Key，洞察会紧跟时事。

### 🧬 自我进化 — Agent 自主判断何时学新技能

你跟 KaijiBot 连续做了几次复杂的飞书知识库整理操作——搜索会议记录、提取纪要、创建文档、设置任务。KaijiBot 发现这个流程重复且复杂，主动跟你说：

> "我注意到你最近几次都在做类似的会议纪要归档流程，我给自己写了个技能，以后你说'归档会议'我就自动执行整个流程。"

它怎么做到的：

- **Hard Trigger 检测** — 代码层只做噪音过滤，不做质量判断。检测到复杂任务后注入系统事件。
- **Agent 自主决策** — Agent 拥有完整对话上下文，自己判断是否值得做成技能。不值得就忽略。
- **完整生命周期** — 创建前去重检查、创建后跟踪使用频率、长期不用自动清理。

### 🔄 纠错自进化 — 同样的错误不犯第二次

AI 助手每次新建会话都犯同样的错？KaijiBot 不会。它有一套纠错记忆系统，保证同样的错误只犯一次。

- **双路径检测** — Agent 自报错误，或会话结束时系统自动从对话中提取纠错记录。
- **去重 + 强化** — 重复的错误不会新建记录，而是增加权重，确保高频问题优先被看到。
- **系统提示注入** — 纠错记录注入到 Agent 每一轮都能看到的系统提示中，而不是放在可能不被读取的文件里。

同样的坑，踩过一次就够了。

### 🔌 可插拔架构

不绑死任何一家。国内国际随意切换，`kaijibot onboard` 向导自动发现已配置的 API Key。

| 国内（推荐）                                     | 国际主流                                           | 聚合 / 自部署                                         |
| ------------------------------------------------ | -------------------------------------------------- | ----------------------------------------------------- |
| 智谱 GLM · DeepSeek · 通义千问 · Kimi · MiniMax … | Claude · Gemini · Grok · Mistral · Perplexity …    | OpenRouter · Together · Ollama · LMStudio · vLLM …    |

切换模型只需一行：

```bash
kaijibot config set agent.model "deepseek/deepseek-chat"
kaijibot config set agent.model "anthropic/claude-sonnet-4-20250514"
```

### 🛠️ 完整智能体

**Agent 循环**：推理 → 调用工具 → 观察 → 继续推理，支持流式输出、上下文压缩、子智能体并行派生。内置代码执行、网页抓取、PDF 操作、图片/视频/音乐生成、TTS 语音合成、Canvas 画布等工具。

**记忆系统**：多存储后端，语义搜索历史对话。会话记忆、每日整合、手动整理三个系统协同维护 Agent 上下文。

**技能市场**：数十个内置技能（github、weather、summarize、coding-agent、notion、obsidian、taskflow 等），更多从 ClawHub 安装：

```bash
kaijibot skills install <skill-name>
```

## 🚀 快速开始

### macOS / Linux

**一键安装**（推荐，自动检测环境、安装依赖、运行 onboard 向导）：

```bash
curl -fsSL https://kaijibot.ai/install.sh | bash
```

也支持 npm 全局安装：

```bash
npm install -g kaijibot
kaijibot onboard
```

### Windows

PowerShell 一键安装：

```powershell
iwr -useb https://kaijibot.ai/install.ps1 | iex
```

或 npm：

```powershell
npm install -g kaijibot
kaijibot onboard
```

### Docker

```bash
git clone https://github.com/Kaiji-Z/kaijibot.git
cd kaijibot
docker compose up -d
```

### 从源码构建

```bash
git clone https://github.com/Kaiji-Z/kaijibot.git
cd kaijibot
# 国内镜像加速
pnpm install --registry https://registry.npmmirror.com
pnpm build
kaijibot onboard   # 交互式向导，自动配置
# 从 OpenClaw 迁移？运行：
kaijibot migrate
```

### 启动

```bash
kaijibot gateway --port 18789 --verbose
```

启动后在飞书里找到你的机器人，发一条消息。KaijiBot 自动开始构建你的认知画像，几轮对话后会主动推送第一条洞察。

## ⚙️ 配置

**必需**：至少一个 LLM 提供商的 API Key + 飞书机器人凭证。

```bash
# LLM API Key（任选一个）
export ZAI_API_KEY="your-key"              # 智谱 GLM
# export DEEPSEEK_API_KEY="your-key"       # DeepSeek
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

配置文件位于 `~/.kaijibot/kaijibot.json`，支持热重载。认知系统可通过 `cognitive.enabled: false` 关闭。详细配置参考 `AGENTS.md`。

## 致谢

基于 [OpenClaw](https://github.com/openclaw/openclaw) 开源项目开发。

### 学术研究

认知系统的设计借鉴了以下研究：

**基础理论**

- Green, D. M., & Swets, J. A. (1966). _Signal detection theory and psychophysics_. Wiley.
- Thompson, W. R. (1933). On the likelihood that one unknown probability exceeds another in view of the evidence of two samples. _Biometrika_, 25(3/4), 285–294.
- Altman, I., & Taylor, D. A. (1973). _Social penetration: The development of interpersonal relationships_. Holt, Rinehart & Winston.
- Gentner, D. (1983). Structure-mapping: A theoretical framework for analogy. _Cognitive Science_, 7(2), 155–170.

**人机关系与推荐系统**

- Bickmore, T. W., & Picard, R. W. (2005). Establishing and maintaining long-term human-computer relationships. _ACM Transactions on Computer-Human Interaction_, 12(2), 293–327.
- Kotkov, D., Wang, S., & Veijalainen, J. (2016). A survey of serendipity in recommender systems. _Knowledge-Based Systems_, 111, 180–192.

**LLM 画像与记忆**

- DEEPER: Directed Persona Refinement. (2025). _Proceedings of ACL 2025_. 32.2% error reduction via active contradiction resolution in persona maintenance.
- PERSONAMEM: Persona-Aware Memory in LLMs. (2025). _Proceedings of COLM 2025_. Benchmark showing LLMs achieve ~50% accuracy on evolving profile tasks.
- DV365: Dynamic User Representations over 365 Days. (2025). _Proceedings of KDD 2025_. Instagram's multi-slicing user embedding architecture.
- GemiRec: Gemini-Powered Recommendations. (2025). Xiaohongshu's multi-interest vector architecture with codebook quantization.
- PIE: Personalized Interest Exploration. (2023). _Proceedings of WWW 2023_. Personalized PageRank with bandit exploration.
- ProfiLLM: Fully Implicit User Profiling from Chatbot Interactions. (2025).

### 开源依赖

[飞书开放平台](https://open.feishu.cn/)、[Vitest](https://vitest.dev/)、[Playwright](https://playwright.dev/)、[tsdown](https://github.com/nicepkg/tsdown)、[Zod](https://zod.dev/)。

## 许可证

[MIT](LICENSE)
