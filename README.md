# KaijiBot — 主动型 AI 私人助手

> 基于 [OpenClaw](https://github.com/openclaw/openclaw) 精简改造，面向国内用户的**主动型智能体**平台。内置完整的认知系统，融合多篇前沿论文思想，让 AI 从被动工具进化为主动思考的伙伴。

## 这是什么

KaijiBot 是 OpenClaw 的精简中文发行版。OpenClaw 是一个功能强大的多渠道 AI 网关平台，我们做了三件事：

1. **精简** — 砍掉国内用不了的 85 个渠道和 32 个技能，保留核心引擎 + 飞书
2. **整合** — 接入 40+ 国内外 LLM 提供商（DeepSeek、通义千问、Kimi、Anthropic、Google、OpenRouter 等），开箱即用
3. **进化** — 在精简后的 OpenClaw 上构建了完整的**认知主动系统**，让它从"你问它才答"的工具，变成一个**会主动找你聊天的 AI 伙伴**

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

### 信任演化（关系阶段模型）

借鉴 Bickmore & Picard (2005) 的关系型智能体理论，关系是分阶段的：

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
| 62 个扩展（飞书 + 40+ LLM 提供商 + 工具） | ~85 个不用的频道 |
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
# 设置 LLM 提供商 API Key（选一个你有的即可）
export ZAI_API_KEY="your-api-key"          # 智谱 GLM（默认）
# export DEEPSEEK_API_KEY="your-key"       # DeepSeek
# export DASHSCOPE_API_KEY="your-key"      # 通义千问
# export MOONSHOT_API_KEY="your-key"       # Kimi
# export ANTHROPIC_API_KEY="your-key"      # Claude
# export GOOGLE_API_KEY="your-key"         # Gemini
# export OPENAI_API_KEY="your-key"         # OpenAI

# 切换默认模型（可选）
kaijibot config set agent.model "deepseek/deepseek-chat"
kaijibot config set agent.model "qwen/qwen-max"
kaijibot config set agent.model "anthropic/claude-sonnet-4-20250514"

# 配置飞书频道
kaijibot config set channels.feishu.appId "your-app-id"
kaijibot config set channels.feishu.appSecret "your-app-secret"

# 可选：配置网络搜索
export EXA_API_KEY="your-exa-key"
export TAVILY_API_KEY="your-tavily-key"
```

**支持的 LLM 提供商一览（40+）：**

| 国内（推荐） | 国际主流 | 聚合/自部署 |
|-------------|---------|------------|
| Z.AI 智谱 GLM · DeepSeek · 通义千问 · Kimi · MiniMax · 百度千帆 · 阶跃星辰 · 火山引擎 · 小米 | Anthropic Claude · Google Gemini · xAI Grok · Mistral · Perplexity · Groq | OpenRouter · LiteLLM · Together · Fireworks · SGLang · vLLM · Ollama · LMStudio |

配置了任一提供商的 API Key 后，通过 `kaijibot onboard` 向导即可自动选择并配置。

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

## 保留的扩展（62 个）

| 类别 | 扩展 |
|------|------|
| **消息渠道** | feishu（飞书，148 源文件完整实现） |
| **🇨🇳 国内 LLM** | zai（智谱 GLM）、deepseek、qwen（通义千问）、moonshot（Kimi）、minimax、qianfan（百度千帆）、stepfun（阶跃星辰）、volcengine（火山引擎）、byteplus、kimi-coding、xiaomi（小米）、alibaba |
| **🌍 国际 LLM** | anthropic（Claude）、google（Gemini）、xai（Grok）、mistral、perplexity、groq、nvidia、huggingface |
| **🔄 聚合/网关** | openrouter、litellm、together、fireworks、cloudflare-ai-gateway、vercel-ai-gateway、copilot-proxy、microsoft、microsoft-foundry、anthropic-vertex |
| **🖥️ 自部署** | ollama、lmstudio、sglang、vllm |
| **🛠️ 开发工具** | opencode、opencode-go、open-prose、openshell、kilocode、arcee、chutes、venice、vydra、runway、synthetic |
| **网络搜索** | exa、tavily |
| **浏览器** | browser（Playwright 自动化） |
| **记忆** | memory-core、memory-lancedb、memory-wiki |
| **语音** | speech-core、talk-voice |
| **媒体** | media-understanding-core、image-generation-core |
| **工具类** | diffs、llm-task、device-pair、webhooks、shared、github-copilot |

## 保留的技能

github, gh-issues, weather, summarize, coding-agent, mcporter, skill-creator, session-logs, healthcheck, notion, obsidian, canvas, nano-pdf, taskflow, taskflow-inbox-triage, clawhub, video-frames, gifgrep, node-connect, blogwatcher, sherpa-onnx-tts

需要更多技能？从 ClawHub 安装：`kaijibot skills install <skill-name>`

## 技术栈

- TypeScript (ESM) + pnpm monorepo
- Vitest 测试框架（420+ 认知层测试）
- tsdown 构建
- Gateway: WebSocket + HTTP 服务器
- 数据存储：本地文件（`~/.kaijibot/`）
- 运行环境：Node 22+（推荐 24）

## 许可证

MIT — 与上游 OpenClaw 相同。

## 致谢

基于 [OpenClaw](https://github.com/openclaw/openclaw) 项目及社区开发。上游同步自 [KaijiBot Gitee 镜像](https://gitee.com/kaiji1126/kaijibot)。

## 参考文献

KaijiBot 的认知系统并非闭门造车——我们站在学术前沿的肩膀上，将论文思想工程化为可运行的代码。以下是我们在设计与实现中直接引用和借鉴的研究成果。

### 智能体框架

| 来源 | 在 KaijiBot 中的应用 |
|------|---------------------|
| [OpenClaw](https://github.com/openclaw/openclaw) | 上游项目。KaijiBot 的完整 Agent 循环、插件系统、Gateway 架构、记忆系统均继承自 OpenClaw |
| [@mariozechner/pi-ai](https://github.com/mariozechner/pi-ai) | OpenClaw 底层的 AI 抽象层。统一的消息格式 (`Message`)、模型接口 (`complete()`)、流式输出协议 |

### 主动交互与决策理论

| 论文/来源 | 核心思想 | 在 KaijiBot 中的应用 |
|-----------|---------|---------------------|
| **Green, D.M. & Swets, J.A. (1966)** *Signal Detection Theory and Psychophysics*. New York: Wiley. Reissued 1988, Peninsula Publishing | 信号检测论——在不确定条件下做决策，权衡漏报（Miss）与虚报（False Alarm）的不对称代价 | `gate.ts` 的 `computeGradedGate()`：用 C_FN / C_FA 计算动态阈值 `pAct > C_FA/(C_FN+C_FA)`，漏掉一条好洞察的代价是打扰用户的 5 倍 |
| **Bickmore & Picard (2005)** *"Establishing and Maintaining Long-Term Human-Computer Relationships"*, ToCHI 12(2), 293–327. DOI: [10.1145/1067860.1067867](https://doi.org/10.1145/1067860.1067867) | 关系型智能体理论——长期人机关系需要分阶段策略（小talk、自我披露、共情、幽默等） | `trust-calculator.ts`：四阶段信任模型（定向→探索→融洽→伙伴），低信任时克制主动、高信任时大胆推荐 |
| **Thompson, W.R. (1933)** *"On the Likelihood that One Unknown Probability Exceeds Another"*, Biometrika 25(3–4), 285–294. DOI: [10.1093/biomet/25.3-4.285](https://doi.org/10.1093/biomet/25.3-4.285) | 贝叶斯赌博机——用 Beta 分布的后验采样平衡探索与利用 | `preference-learner.ts`：每个话题维护一对 (α, β) 参数，采样决定下一个推送的话题；带指数衰减回退先验 |
| **Kotkov et al. (2016)** *"A survey of serendipity in recommender systems"*, Knowledge-Based Systems 111, 180–192. DOI: [10.1016/j.knosys.2016.08.014](https://doi.org/10.1016/j.knosys.2016.08.014) | 推荐系统中的惊喜度——不是越相关越好，适度意外才有价值 | `serendipity-scorer.ts`：洞察的惊喜度评分，平衡相关性与新颖性 |

### 洞察多样性与 LLM 生成

| 论文/来源 | 核心思想 | 在 KaijiBot 中的应用 |
|-----------|---------|---------------------|
| **Lanchantin et al. (2025)** *"Diverse Preference Optimization (DivPO)"*, arXiv:2501.18101. Submitted to ICLR 2026 | RLHF 后训练倾向于收窄输出分布，降低多样性；DivPO 通过显式保多样性的偏好优化，在 persona 属性多样性上比 DPO 提升 45.6% | 研究动机：为什么模型每次都说"刚看到那篇xx"——RLHF 收敛到安全模式。据此调整 temperature 和 prompt 结构 |
| **Ruan et al. (2025)** *"G2: Guided Generation for Enhanced Output Diversity in LLMs"*, EMNLP 2025, pp. 14116–14134. arXiv:2511.00432 | 无需训练的即插即用解码策略——用模型自身的先前输出作为对比反例，比静态规则更有效地推开分布 | `llm-engine.ts`：动态反重复机制——把最近 5 条已发洞察原文注入 prompt 作为对比，每次内容变了约束就变了，不会收敛到新模板 |
| **Garces Arias et al. (2025)** *"Decoding Decoded: Understanding Hyperparameter Effects in Open-Ended Text Generation"*, COLING 2025, pp. 9992–10020. arXiv:2410.06097 | 1242 组实验表明 T=0.9 是多样性最优操作点（QText 指标），温度 >0.7 时多样性显著提升 | `llm-engine.ts`：temperature 从 0.7 提升到 1.0（GLM-5-turbo 上限），对 1-3 句短消息连贯性风险极低 |
| **Prompt Variance → Output Variance**（G2 论文观察） | 输入的多样性产生输出的多样性——改变提问方式比改变参数更有效 | `llm-engine.ts`：5 个随机中文 prompt 框架变体（`PROMPT_FRAMES`），每次生成随机选一个 |

### 心理学基础

KaijiBot 的认知系统深度借鉴心理学理论。以下是从经典心理学到代码实现的映射。

| 心理学理论 | 经典文献 | 在 KaijiBot 中的应用 |
|-----------|---------|---------------------|
| **社会渗透理论**（Social Penetration Theory） | Altman, I. & Taylor, D.A. (1973). *Social Penetration: The Development of Interpersonal Relationships*. Holt, Rinehart & Winston | `trust-calculator.ts` + `extractor.ts`：人际关系从表层（定向）到深层（伙伴）逐层渗透——信任分数随阶段递进，persona 从基础信息逐步深入到情感偏好和深层兴趣 |
| **关系型智能体**（Relational Agents） | Bickmore, T.W. & Picard, R.W. (2005). Establishing and Maintaining Long-Term Human-Computer Relationships. *ACM ToCHI*, 12(2), 293–327. DOI: [10.1145/1067860.1067867](https://doi.org/10.1145/1067860.1067867) | `trust-calculator.ts`：四阶段信任模型（定向→探索→融洽→伙伴），借鉴 Bickmore 的长期人机关系策略——低信任时用小 talk、克制主动，高信任时大胆推荐 |
| **操作条件反射**（Operant Conditioning） | Skinner, B.F. (1953). *Science and Human Behavior*. Macmillan | `collector.ts` + `preference-learner.ts`：隐式反馈即强化信号——用户回复长了 = 正强化，回复短了 = 负强化；Thompson Sampling 将每次反馈转化为概率模型更新，塑造后续推送行为 |
| **结构映射理论**（Structure-Mapping Theory） | Gentner, D. (1983). Structure-mapping: A theoretical framework for analogy. *Cognitive Science*, 7(2), 155–170. DOI: [10.1207/s15516709cog0702_3](https://doi.org/10.1207/s15516709cog0702_3) | `cross-domain-mapper.ts`：类比的核心是结构对齐——领域共现图谱 + 语义邻接矩阵，发现跨域的结构性联系而非表面相似 |
| **认知失调理论**（Cognitive Dissonance） | Festinger, L. (1957). *A Theory of Cognitive Dissonance*. Stanford University Press | `contradiction-resolver.ts`：多源信息融合时的矛盾检测与解决——4 条确定性规则处理新旧信息冲突，新信息置信度更高时替换旧的，避免认知失调累积 |
| **跨理论变化模型**（Transtheoretical Model） | Prochaska, J.O. & DiClemente, C.C. (1983). Stages and processes of self-change of smoking. *JCCP*, 51(3), 390–395. DOI: [10.1037/0022-006x.51.3.390](https://doi.org/10.1037/0022-006x.51.3.390) | `lifecycle.ts`：用户生命周期 4 阶段状态机（new→active→dormant→lapsed），借鉴变化阶段论——不同阶段需要不同交互策略和频率因子 |
| **启发式与偏差**（Heuristics and Biases） | Tversky, A. & Kahneman, D. (1974). Judgment under Uncertainty: Heuristics and Biases. *Science*, 185(4157), 1124–1131. DOI: [10.1126/science.185.4157.1124](https://doi.org/10.1126/science.185.4157.1124) | `calibration.ts`：校准 pAccept 预测——模型的置信度应与实际准确率一致，用最小二乘回归斜率校正系统性高估/低估，≥10 条记录时生效 |
| **情感计算**（Affective Computing） | Picard, R.W. (1997). *Affective Computing*. MIT Press | `sentiment-detector.ts`：从文本中检测用户情绪状态，用于调整交互策略——中英文混合情感检测，支持趋势追踪（improving/stable/declining） |
| **信号检测论**（Signal Detection Theory） | Green, D.M. & Swets, J.A. (1966). *Signal Detection Theory and Psychophysics*. Wiley | `gate.ts`：在不确定条件下做决策，权衡漏报（漏掉好洞察）与虚报（打扰用户）的不对称代价——C_FN/C_FA 动态阈值 |
| **组织信任整合模型** | Mayer, R.C., Davis, J.H. & Schoorman, F.D. (1995). An integrative model of organizational trust. *AMR*, 20(3), 709–734. DOI: [10.5465/amr.1995.9508080335](https://doi.org/10.5465/amr.1995.9508080335) | `trust-calculator.ts`：信任的形成依赖能力（ability）、善意（benevolence）、正直（integrity）三个维度——反馈信号从这三个角度更新信任分数 |

### 开源工具与基础设施

| 项目 | 用途 |
|------|------|
| [Z.AI / 智谱 GLM](https://open.bigmodel.cn/) | 主力 LLM 提供商（GLM-5-turbo），洞察生成、Persona 深度提取均基于此 |
| [飞书开放平台](https://open.feishu.cn/) | 唯一消息渠道，148 源文件完整实现（WebSocket 长连接 + 事件订阅） |
| [Exa](https://exa.ai/) | 高质量语义搜索 API，洞察实时性保障 |
| [Tavily](https://tavily.com/) | AI 摘要搜索 + 网页提取 |
| [Vitest](https://vitest.dev/) | 测试框架（420+ 认知层测试，70% 覆盖率阈值） |
| [tsdown](https://github.com/nicepkg/tsdown) | TypeScript 构建 |
| [Zod](https://zod.dev/) | 运行时类型验证（Persona 持久化的向后兼容迁移） |
| [Playwright](https://playwright.dev/) | 浏览器自动化（Browser 扩展） |
