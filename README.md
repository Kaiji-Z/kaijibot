# KaijiBot 👾

> **你的 AI 助手会主动找你聊天，而不是干等着你提问。**

Fork of [OpenClaw](https://github.com/openclaw/openclaw) · 飞书 + 智谱 GLM · 认知层让 AI 从被动变主动

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

- **Persona 画像** — 每次对话都在学习你。你的专业领域、兴趣方向、沟通风格、语言偏好，全部自动提取并持久化。不是预设标签，而是从对话中自然涌现的认知模型。
- **跨域洞察** — 你同时关注 A 和 B，它发现二者有潜在联系。你之前问过但没深入的问题，它从新角度跟进。你在某个领域钻得够深了，它推荐延伸方向。
- **时机门控** — 不是想发就发。凌晨不打扰，信任度低时克制，你最近活跃度低就先等等。每条洞察都经过"该不该说"的判断。
- **信任演化** — 刚认识时谨慎试探，聊多了之后越来越懂你，最终变成可以大胆推荐的深度伙伴。四个阶段：定向 → 探索 → 融洽 → 伙伴。
- **偏好学习** — 你回复长了、追问了"为什么"，它记下你喜欢这个话题。你敷衍了，它下次换一个方向。每次反馈都会更新概率模型。

洞察内容结合你的画像 + LLM 知识 + 实时网络搜索生成。配了 Exa 或 Tavily API Key，洞察会紧跟时事。

### 🔌 35+ LLM 提供商开箱即用

不绑死任何一家。国内国际随意切换，`kaijibot onboard` 向导自动发现已配置的 API Key。

| 国内（推荐） | 国际主流 | 聚合 / 自部署 |
|---|---|---|
| 智谱 GLM（默认）· DeepSeek · 通义千问 · Kimi · MiniMax · 百度千帆 · 阶跃星辰 · 火山引擎 · 小米 · Alibaba | Claude · Gemini · Grok · Mistral · Perplexity · Groq · Nvidia · OpenAI | OpenRouter · LiteLLM · Together · Fireworks · SGLang · vLLM · Ollama · LMStudio |

切换模型只需一行：

```bash
kaijibot config set agent.model "deepseek/deepseek-chat"
kaijibot config set agent.model "qwen/qwen-max"
kaijibot config set agent.model "anthropic/claude-sonnet-4-20250514"
```

### 🛠️ 21 个内置技能 + 完整智能体

**Agent 循环**：推理 → 调用工具 → 观察 → 继续推理，支持流式输出、上下文压缩、子智能体并行派生。

**内置工具**：代码执行、网页抓取、PDF 操作、图片/视频/音乐生成、TTS 语音合成、Canvas 画布、文件读写、cron 定时任务，共 20+。支持模型故障转移和 API Key 轮换。

**记忆系统**：三种存储后端（内存、LanceDB 向量库、Wiki 知识库），语义搜索历史对话，定期整理巩固记忆（类似人类睡眠时的记忆处理），短期重要信息自动晋升为长期知识。

**定时任务**：`at`（一次性）、`every`（间隔）、`cron`（cron 表达式 + 时区），支持消息投递、webhook 回调或静默执行，失败自动重试。

**技能市场**：github、weather、summarize、coding-agent、notion、obsidian、nano-pdf、taskflow、blogwatcher 等 21 个内置技能，更多从 ClawHub 安装：

```bash
kaijibot skills install <skill-name>
```

## 🚀 快速开始

**前置要求**：Node.js >= 22（推荐 24）、pnpm

**方式一：Docker（推荐）**

```bash
git clone https://github.com/Kaiji-Z/kaijibot.git
cd kaijibot
docker compose up -d
```

**方式二：本地安装**

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
# LLM API Key（任选一个）
export ZAI_API_KEY="your-key"              # 智谱 GLM（默认）
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

认知系统的核心流程：事件源（定时器 / 画像变更 / 信息扫描）→ 调度器 → 门控判断（该不该说）→ 洞察生成（跨域连接 / 问题跟进）→ 投递路由（找到你的会话并推送）。

Gateway 提供 WebSocket + HTTP 双协议，100+ RPC 方法，兼容 OpenAI API（`/v1/chat/completions`）和 MCP 协议。插件 SDK 支持 20+ 生命周期钩子，扩展可按 npm 包、Git 仓库或内置方式加载。会话默认按渠道 + 对话方隔离。

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

## 🤝 社区与贡献

欢迎 Star 和 PR。同步上游更新：

```bash
git remote add upstream https://gitee.com/kaiji1126/kaijibot
git fetch upstream
git merge upstream/main
```

核心代码完全兼容，认知层（`src/cognitive/`）是独立模块，不影响上游同步。

## 致谢

基于 [OpenClaw](https://github.com/openclaw/openclaw) 项目开发，上游同步自 [KaijiBot Gitee 镜像](https://gitee.com/kaiji1126/kaijibot)。认知系统的设计借鉴了信号检测论（Green & Swets, 1966）、关系型智能体（Bickmore & Picard, 2005）、Thompson Sampling（Thompson, 1933）、惊喜度推荐（Kotkov et al., 2016）、社会渗透理论（Altman & Taylor, 1973）、结构映射理论（Gentner, 1983）等前沿研究。

主要开源依赖：[智谱 GLM](https://open.bigmodel.cn/)、[飞书开放平台](https://open.feishu.cn/)、[Vitest](https://vitest.dev/)、[Playwright](https://playwright.dev/)、[tsdown](https://github.com/nicepkg/tsdown)、[Zod](https://zod.dev/)。

## 许可证

[MIT](LICENSE)
