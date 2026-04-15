# KaijiBot Simplify — 主动型 AI 私人助手

> 基于 [OpenClaw](https://github.com/openclaw/openclaw) 精简改造，面向国内用户的**主动型智能体**平台。

## 这是什么

KaijiBot 是 OpenClaw 的精简中文发行版。OpenClaw 是一个功能强大的多渠道 AI 网关平台，我们做了两件事：

1. **精简** — 砍掉国内用不了的 85 个渠道和 32 个技能，保留核心引擎 + 飞书 + 智谱
2. **进化** — 在精简后的 OpenClaw 上构建了完整的**认知主动系统**，让它从"你问它才答"的工具，变成一个**会主动找你聊天的 AI 伙伴**

## 核心特色：主动型智能体

这是 KaijiBot 区别于其他 AI 助手的关键——不是被动等你提问，而是像一个关心你的朋友一样主动。

### 它怎么认识你（Persona 系统）

每次聊天它都在学习你——自动提取你的兴趣领域、专业背景、沟通风格、语言偏好（中/英/混合），存成一份持续更新的认知画像。

领域识别有两条通道：
- **快速通道**（规则匹配，<50ms）：内置了 8 个常见技术/商业领域的关键词（AI、架构、编程、产品、创业、数据、安全、云），作为兜底
- **深度通道**（LLM 提取，5s 超时）：让 LLM 自由分析对话内容，**可以识别任意领域**（比如"量子计算""区块链""数字艺术"等）

实际效果：你的画像里可以有任意数量的任意领域，不局限于预设的 8 个。

### 它怎么想你（Insight 引擎）

基于你的画像，它能发现你可能没想到的关联：

- **跨域洞察** — 你对 A 和 B 都感兴趣，它发现二者有潜在联系并告诉你
- **待答问题** — 你之前问过但没得到满意答案的问题，它从新角度启发你思考
- **域深度提醒** — 某个领域你深入到一定程度，推荐你关注相关延伸方向

洞察有惊喜度评分——不是越相关越好，而是适度新颖。

洞察内容会结合你的画像 + LLM 通用知识 + **实时网络搜索**（如果配置了 Exa 或 Tavily API Key）生成。配置了搜索 API Key 后，洞察会紧跟时事，引用最新的网络信息；未配置时则使用纯 LLM 知识生成，依然有效但缺乏时效性。

### 它怎么决定要不要说（Gate 门控）

每次想主动联系你，它都会计算：

- **pNeed** — 你现在需要这个信息吗？（基于距离上次主动的时间、事件类型、领域活跃度）
- **pAccept** — 你会接受吗？（基于信任度、历史反馈、Thompson Sampling 赌博机模型）
- **硬否决** — 凌晨 3 点不吵你、信任度太低先不急、最近聊得太少先建立关系、你明确不想被打扰就闭嘴

### 它怎么学习你的偏好（Feedback 系统）

- 你回复长了 = 感兴趣；回复短了 = 可能不感兴趣
- 你继续聊这个话题 = 感兴趣；突然换话题 = 不感兴趣
- 你问"为什么""怎么做到的" = 深度参与信号
- 这些信号会更新每个话题的概率模型，下次更精准

### 信任演化（SARA 模型）

关系是分阶段的：

- **定向期**（<0.3）— 刚认识，谨慎为主，少打扰
- **探索期**（<0.5）— 开始了解你，试探性主动
- **融洽期**（<0.7）— 摸清了你的偏好，更精准地主动
- **伙伴期**（≥0.7）— 深度信任，可以大胆推荐

## 从 OpenClaw 继承的强大能力

OpenClaw 本身是一个成熟的 AI 网关平台，我们完整继承了它的核心引擎：

### 智能体系统

- **Agent 循环** — 完整的推理-工具-观察循环，支持流式输出、上下文压缩、token 管理
- **子智能体** — 可以派生子 agent 并行处理任务，有深度限制和会话隔离
- **20+ 内置工具** — 文件读写、代码执行、网页抓取、消息发送、cron 管理、PDF 操作、图片/视频/音乐生成、TTS 语音合成、Canvas 画布等

### 定时任务系统

- 支持 `at`（一次性）、`every`（间隔）、`cron`（cron 表达式 + 时区）三种调度
- 可以执行系统事件注入或独立 agent 运行
- 投递方式：发消息、调 webhook、或静默执行
- 失败告警和自动重试

### 记忆系统

- **三种存储后端** — 内存、LanceDB 向量库、Wiki 知识库
- **语义搜索** — 搜索历史对话和知识
- **记忆梦境** — 定期整理和巩固记忆（类似人类睡眠时的记忆处理）
- **短期→长期晋升** — 重要的短期记忆自动晋升为长期知识

### 插件与技能系统

- 完整的插件 SDK，支持 npm 包、Git 仓库、内置插件
- **Hook 系统** — 10+ 生命周期钩子（before-agent-reply、before-tool-call 等）
- **技能系统** — 21 个内置技能，支持技能市场（ClawHub）

### 网关架构

- WebSocket + HTTP 服务器，100+ RPC 方法
- OpenAI 兼容 API（`/v1/chat/completions`）
- MCP 协议支持
- 设备配对、节点管理、Web 控制面板
- 配置热重载、频道健康监控

## KaijiBot 新增和优化的功能

### 新增

| 功能 | 说明 |
|------|------|
| **认知主动系统** | Persona + Insight + Scheduler + Gate + Feedback 五大模块，让 AI 能主动思考并联系用户 |
| **Exa 搜索** | 从 OpenClaw 移植，高质量语义搜索，国内可用 |
| **Tavily 搜索** | 从 OpenClaw 移植，AI 摘要搜索 + 网页提取，国内可用 |
| **认知投递路由** | 自动将洞察路由到正确的用户 session |
| **心跳认知唤醒** | 绕过 HEARTBEAT.md 门控，确保洞察可靠投递 |

### 优化

| 改进 | 说明 |
|------|------|
| **TUI 终端界面** | 修复 streaming 卡住、添加滚轮滚动、支持文字复制、工具调用折叠显示 |
| **默认模型** | 切换到 `zai/glm-5-turbo`，更快的响应速度 |
| **飞书频道** | 修复认证循环引用、优化消息策略 |
| **中文适配** | 模式路由、Persona 提取、洞察生成都针对中文优化 |

## 精简内容

| 保留 | 移除 |
|------|------|
| 21 个扩展（飞书、Z.AI、OpenAI、Ollama、LMStudio、浏览器、记忆、语音等） | ~85 个不用的频道和 LLM 提供商 |
| 21 个国内可用的技能 | ~32 个国内不可用的技能 |
| CLI + TUI + Web API（Gateway） | macOS/iOS/Android 原生应用 |
| 完整的插件系统、技能系统、认知系统 | 上游 CI、Docker 沙箱、部署配置 |

## 快速开始

### 前置要求

- Node.js 22+（推荐 24）
- pnpm
- Z.AI API Key（[获取地址](https://open.bigmodel.cn/)）
- 飞书机器人（[创建指南](https://open.feishu.cn/)）

### 安装与构建

```bash
git clone <你的仓库地址>
cd kaijibot
pnpm install
pnpm build
```

### 配置

```bash
# 设置 Z.AI API Key（推荐）
export ZAI_API_KEY="your-api-key"

# 配置飞书频道
kaijibot config set channels.feishu.appId "your-app-id"
kaijibot config set channels.feishu.appSecret "your-app-secret"

# 可选：配置网络搜索
export EXA_API_KEY="your-exa-key"
export TAVILY_API_KEY="your-tavily-key"
```

### 运行

```bash
# 启动 Gateway
kaijibot gateway --port 18789 --verbose

# 或使用 pnpm
pnpm kaijibot gateway --port 18789 --verbose
```

启动后，在飞书中找到你的机器人发条消息即可。KaijiBot 会自动建立你的认知画像，经过几轮对话后开始主动向你推送洞察。

## 同步上游

```bash
git remote add upstream https://gitee.com/kaiji1126/kaijibot
git fetch upstream
git merge upstream/main
```

核心代码（`src/`）完全兼容，合并冲突极少。认知层（`src/cognitive/`）是独立模块，不影响同步。

## 保留的扩展

| 类别 | 扩展 |
|------|------|
| **消息渠道** | feishu（飞书，148 源文件完整实现） |
| **LLM 提供商** | zai（智谱 GLM，14 个模型）、openai（兼容层） |
| **网络搜索** | exa、tavily |
| **浏览器** | browser（Playwright 自动化） |
| **记忆** | memory-core、memory-lancedb、memory-wiki |
| **语音** | speech-core、talk-voice |
| **媒体** | media-understanding-core、image-generation-core |
| **工具类** | diffs、llm-task、device-pair、webhooks、shared |

## 保留的技能

github, gh-issues, weather, summarize, coding-agent, mcporter, skill-creator, session-logs, healthcheck, notion, obsidian, canvas, nano-pdf, taskflow, taskflow-inbox-triage, clawhub, video-frames, gifgrep, node-connect, blogwatcher, sherpa-onnx-tts

需要更多技能？从 ClawHub 安装：`kaijibot skills install <skill-name>`

## 技术栈

- TypeScript (ESM) + pnpm monorepo
- Vitest 测试框架（233+ 认知层测试）
- tsdown 构建
- Gateway: WebSocket + HTTP 服务器
- 数据存储：本地文件（`~/.kaijibot/`）
- 运行环境：Node 22+（推荐 24）

## 许可证

MIT — 与上游 OpenClaw 相同。

## 致谢

基于 [OpenClaw](https://github.com/openclaw/openclaw) 项目及社区开发。上游同步自 [KaijiBot Gitee 镜像](https://gitee.com/kaiji1126/kaijibot)。
