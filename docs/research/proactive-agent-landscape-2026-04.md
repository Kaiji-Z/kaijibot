# 主动型智能体（Proactive Agent）发展现状调研报告

> 调研时间：2026 年 4 月
> 数据来源：arXiv、ICLR 2025/2026、NeurIPS 2025、GitHub、商业产品官网

---

## 一、定义与分类

### 1.1 核心定义

**主动型智能体**（Proactive Agent）是指在**没有用户明确指令**的情况下，能够主动感知环境、预测需求、并自主采取行动的 AI 系统。

| 维度 | 被动型（Reactive） | 主动型（Proactive） |
|------|---------------------|----------------------|
| 行动触发 | 用户输入后才响应 | 基于历史/模式/预测主动发起 |
| 决策方式 | 评估当前输入 | 预测未来场景，使用记忆+策略 |
| 记忆 | 无状态或会话级 | 持久化，从经验中学习 |
| 规划 | 单轮响应 | 多步骤、自适应规划 |
| 目标导向 | 局限于当前输入 | 维护长期目标 |
| 时间性 | 按需 | 预判**何时**行动 |

### 1.2 自主权等级（Stanford HAI 2025 AI Agent Index）

| 等级 | 描述 | 代表产品 |
|------|------|----------|
| L1 | 用户给指令 → Agent 执行 | ChatGPT 基础对话 |
| L2 | 用户与 Agent 协作规划并执行 | Claude Cowork |
| L3 | Agent 提出计划 → 用户批准 → 执行 | OpenClaw, KaijiBot |
| L4 | Agent 规划并执行 → 用户可干预 | Autopilot 模式的 Elani, Demi |
| L5 | 完全自主（有约束） | 理论阶段 |

目前大多数"主动型"产品处于 **L2–L3** 级别。

---

## 二、学术研究前沿（2024–2026）

### 2.1 里程碑论文

| 论文 | 会议 | 核心贡献 |
|------|------|----------|
| **Proactive Agent**（Lu et al., 清华 THUNLP） | ICLR 2025 | 首次正式定义主动型 Agent 任务；发布 ProactiveBench（6,790 事件）；微调 LLaMA-3.1-8B 达到 66.47% F1 |
| **PROBE**（Pasternak et al., Fastino.ai） | ICLR 2026 | 分解主动行为为 搜索→识别→解决 三阶段流水线；揭示即使是 SOTA 模型也存在"惊人的能力缺口" |
| **PRISM**（Fu et al.） | ICLR 2026 | 将主动性建模为"说还是不说"的非对称代价决策；风险敏感的干预门控 |
| **ContextAgent**（Yang et al., 哥伦比亚+港中文） | NeurIPS 2025 | 首个基于可穿戴传感器数据的上下文感知主动 Agent；ContextAgentBench（1,000 样本，9 场景） |
| **Training Proactive and Personalized LLM Agents**（Sun et al., CMU） | arXiv 2025 | PPP 框架（多目标 RL 优化生产力+主动性+个性化）；UserVille 环境模拟 |
| **BAO: Behavior Agentic Optimization**（Yao et al.） | arXiv 2026 | Agent RL 框架，平衡任务表现 vs. 用户负担 |
| **ProAct: Agentic Lookahead**（Yu et al.） | arXiv 2026 | MCTS + 蒙特卡洛批评家实现长期规划；4B 模型匹敌闭源 SOTA |

**关键论文链接：**
- ProactiveAgent: https://github.com/thunlp/ProactiveAgent
- PROBE: https://arxiv.org/abs/2510.19771
- PRISM: https://arxiv.org/abs/2602.01532
- ContextAgent: https://arxiv.org/abs/2505.14668
- PPP: https://arxiv.org/abs/2511.02208
- BAO: https://arxiv.org/abs/2602.11351
- ProAct: https://arxiv.org/abs/2602.05327

### 2.2 关键研究机构

- **清华大学 THUNLP** — ProactiveAgent（ICLR 2025）
- **哥伦比亚大学 ICSL + 港中文 AIoT Lab** — ContextAgent（NeurIPS 2025）
- **CMU** — PPP 框架（多目标 RL 优化主动性）
- **Stanford HAI** — AI Agent Index（自主权分级）
- **Fastino.ai** — PROBE 基准（ICLR 2026）
- **Ohio State / Carnegie Mellon** — PRISM（ICLR 2026）

### 2.3 评测基准

| 基准 | 规模 | 侧重方向 |
|------|------|----------|
| **ProactiveBench** | 6,790 事件，12 场景 | 从环境监控中预测任务 |
| **PROBE** | 1,000 样本 | 搜索→识别→解决流水线 |
| **ContextAgentBench** | 1,000 样本，9 场景，20 工具 | 感官数据驱动的上下文感知 |
| **ProAgentBench** | 真实 PC 工作场景数据 | 真实环境下的主动协助评估 |
| **UserRL** | 多任务套件 | 多轮主动交互（任务表现 vs. 用户参与度） |

---

## 三、技术实现路径

### 3.1 主动性设计模式

| 模式 | 描述 | 代表项目 |
|------|------|----------|
| **定时调度** | Agent 按计时器运行（一次性/间隔/cron） | OpenClaw Heartbeat, Claude Scheduled Tasks |
| **上下文监控** | Agent 观察环境（桌面/传感器/数据流），模式触发 | ContextAgent（穿戴设备）, THUNLP ProactiveAgent（Activity Watcher） |
| **任务预判** | 基于行为历史预测用户需求 | ProactiveBench, PRISM 门控 |
| **目标驱动自主** | Agent 追求高层目标，无需逐步指令 | Ralph（PRD→自主实现）, protoMaker（看板→自主 PR） |
| **多目标优化** | 平衡任务完成 vs. 用户负担（不要烦人） | BAO（帕累托前沿）, PRISM（风险敏感门控） |
| **事件驱动触发** | Webhook/事件流唤醒 Agent | Apteva（200+ 集成）, SuperAgentX |
| **自改进循环** | Agent 从自身行为中学习并持续改进 | OpenClaw proactive-agent skill, Ouroboros |

### 3.2 记忆系统（主动性的架构核心）

| 系统 | 方法 | 核心创新 |
|------|------|----------|
| **MemPO**（清华+阿里通义） | 自记忆策略优化 | Agent 自主压缩/重组历史；+25.98% F1，token 减少 67.58% |
| **Memex** | 索引化经验记忆 | 压缩上下文但不丢弃证据；写入/读取策略经 RL 优化 |
| **AgeMem** | 记忆操作作为工具 | Agent 自主决定记住什么（store/retrieve/update/summarize/discard） |
| **AutoAgent** | 演化认知 + 弹性记忆编排 | 闭环认知进化；动态上下文压缩 |
| **PISA**（ICLR 2026 投稿） | Piaget 认知发展启发 | 统一记忆框架，自适应更新策略 |
| **Nemori** | 认知科学启发的自组织记忆 | 双支柱：两步对齐原则 + 预测-校准原则 |

### 3.3 "说不说"决策模型（PRISM，ICLR 2026）

PRISM 将主动性的核心问题形式化为**非对称代价决策**：

- **假阳性**（不必要地干预）→ 用户烦扰
- **假阴性**（该干预时保持沉默）→ 价值损失

在每个时间步估计两个校准概率：
- `p_need` = Pr(用户需要帮助 | 上下文)
- `p_accept` = Pr(用户会接受 | 干预内容)

仅当 `p_need × p_accept > cost_threshold` 时才行动。

这解耦了**帮助的能力**和**干预的决策**。

### 3.4 规划与调度

- **COMPASS**: 分层框架（Main Agent + Meta-Thinker + Context Manager）；Meta-Thinker 监控进度并发出战略干预
- **AOI**: 动态任务调度，基于实时系统状态自适应优先排序；3 层记忆（工作/情景/语义）
- **ProAct**: Grounded LookAhead Distillation — 将搜索树压缩为因果推理链，用于长期规划

---

## 四、商业产品与开源项目

### 4.1 商业产品（2025–2026 爆发期）

| 产品 | 定位 | 主动能力 | 渠道 |
|------|------|----------|------|
| **Claude Cowork + Dispatch**（Anthropic） | 个人 AI 助手 | Scheduled Tasks, /loop 定时任务, 电脑使用 | 桌面+手机 |
| **Google CC** | 每日主动助手 | "Your Day Ahead" 每日简报，基于日历/邮件主动推送 | Google 生态 |
| **ChatGPT Pulse**（OpenAI） | 研究助手 | 基于历史交互主动研究（2025.9 发布，12月暂停） | Web |
| **Elani** | 高管 AI 助手 | 每日简报、自动跟进、承诺追踪、autopilot 模式 | Email+Telegram |
| **Demi AI** | 全能 AI 助手 | 主动智能分析器（邮件/日历/Slack）、cron 自主任务、Apple Watch 推送 | 多平台 |
| **Mio** | 个人 AI Agent | 5 层认知记忆（会话/短期/语义/情景/技能）、MCP 服务器、跨渠道主动推送 | iMessage+WhatsApp+Email |
| **Meli** | 个人 AI Agent | MeliNet（Agent 间通信）、自动跟进、后台 24/7 | 多平台 |
| **Mira** | 通信管理 | 自动收件箱清理、跟进、跨平台消息聚合 | Gmail+WhatsApp+LinkedIn+Slack |
| **Donna** | 团队 AI 助手 | 主动简报、任务提醒、电话代打 | Web+多渠道 |
| **Aria** | 日程 AI 助手 | 行为模式学习、预测性日程优化、专注时段保护 | Web |
| **Revo** | iOS AI 助手 | 健康+行为+位置感知、锁屏实时建议 | iOS |
| **Autonomous Intern** | 本地 AI 设备 | $299 硬件，本地运行，Slack/WhatsApp/Discord 主动助手 | 物理设备 |
| **Retinue** | 生活 AI 助手 | 人物性格选择、承诺追踪、上下文理解 | 多平台 |
| **Arahi AI** | 企业 AI 助手 | 多 Agent 工作流、1500+ 集成、记忆学习 | Web |

### 4.2 开源项目

| 项目 | ⭐ Stars | 主动性实现方式 |
|------|---------|-----------------|
| **XAgent**（OpenBMB） | 8,517 | 自主任务分解，无需人类逐步指导 |
| **ProAgent**（OpenBMB） | 860 | Agentic Process Automation：从 RPA 到 APA 的范式转换 |
| **THUNLP/ProactiveAgent** | 570 | 环境感知→任务预测→主动协助；ICLR 2025 论文代码 |
| **SuperAgentX** | 185 | 策略驱动自主 Agent + 治理/审计/人工审批门 |
| **AgentPro** | 52 | ReAct 风格 Agent + 工具系统 + 知识库 |
| **Pocketrb** | 36 | Ruby AI Agent 框架，内置 cron 调度 + 心跳 + 主动任务 |
| **leomariga/ProactiveAgent** | 25 | Python 库：时间感知决策引擎（Wake→Decide→Respond→Sleep） |
| **ProAct** | 16 | MCTS + 蒙特卡洛批评家实现长期前瞻规划 |
| **Apteva** | 5 | Go 语言"持续思考引擎"：observe→reason→act→sleep→repeat；200+ 集成 |

---

## 五、行业趋势与核心洞察

### 5.1 六大趋势

1. **主动性成为一等公民的研究问题**：2023 年只是论文中的一个注脚，到 2025–2026 年已成为 ICLR/NeurIPS 的独立研究方向，有专属基准和评估框架。

2. **"烦人 vs 有用"是核心未解问题**：所有框架都在解决同一个矛盾——如何主动但不打扰。PRISM、BAO、PPP 从不同角度攻击这个问题。

3. **记忆是架构枢纽**：每个主要主动 Agent 系统都在记忆系统上重金投入。AgeMem、Memex、MemPO 都将记忆管理视为**可学习的策略**而非固定模块。

4. **从"能不能做"转向"该不该做+何时做"**：这是从能力到判断力的根本性转变。ICLR 2026 PROBE 评估揭示"即使 SOTA LLM 在真正的主动问题解决上也存在惊人能力缺口"。

5. **商业产品 2025–2026 爆发**：Claude Scheduled Tasks、Google CC、Elani、Demi、Mio 等产品集中出现，主动 AI 助手从开发者 DIY 变成大众可用的产品。

6. **Agent 间协作是新前沿**：Meli 的 MeliNet 让不同用户的 Agent 互相通信协调，这是从单用户到多用户主动 AI 的进化。

### 5.2 KaijiBot 认知层的定位

KaijiBot 的认知层设计（人格提取→反馈学习→洞察生成→主动推送）与学术界的前沿方向高度对齐：

| 学术概念 | KaijiBot 实现 |
|----------|---------------|
| PRISM 风险敏感门控 | 5 道门检查（信任分≥0.5、最小间隔 4h、活跃时段等） |
| 记忆驱动主动性 | PersonaStore 持久化 + LLM 提取器 + 规则引擎兜底 |
| Thompson Sampling 频率自适应 | Beta(alpha,beta) 后验调整推送频率（1-48h） |
| SARA 信任模型 | 4 阶段信任进化（导向→探索→默契→伙伴） |
| 跨域洞察 | cross-domain-mapper 邻接图 + BFS 发现未探索领域 |
| 意外性评分 | serendipity-scorer（相关性×惊喜×新颖度，信任自适应权重） |

KaijiBot 的独特优势在于：**将学术概念实际落地为一个可运行的个人 AI 助手**，而大多数论文仍停留在基准测试阶段。

### 5.3 建议关注的演进方向

1. **多目标 RL 优化**（参考 PPP/BAO）：将"该不该推"从规则引擎升级为学习策略
2. **用户模拟器**（参考 UserVille）：训练时用 LLM 模拟不同用户画像，提升泛化能力
3. **Agent 间协作**（参考 MeliNet）：不同用户的 KaijiBot 实例之间交换上下文
4. **感官上下文扩展**（参考 ContextAgent）：接入更多上下文源（日历、邮件、浏览历史）
5. **预测-校准记忆**（参考 Nemori）：从被动提取升级为主动学习的知识演化

---

## 六、参考资源

### 论文
- ProactiveAgent (ICLR 2025): https://github.com/thunlp/ProactiveAgent
- PROBE (ICLR 2026): https://arxiv.org/abs/2510.19771
- PRISM (ICLR 2026): https://arxiv.org/abs/2602.01532
- ContextAgent (NeurIPS 2025): https://arxiv.org/abs/2505.14668
- PPP Framework: https://arxiv.org/abs/2511.02208
- BAO: https://arxiv.org/abs/2602.11351
- ProAct: https://arxiv.org/abs/2602.05327
- 2025 AI Agent Index (Stanford HAI): https://arxiv.org/abs/2602.17753

### 综述
- Proactive AI Agents Comprehensive Review (atoms.dev): https://atoms.dev/insights/proactive-ai-agents-a-comprehensive-review-of-foundational-concepts-technologies-applications-challenges-and-future-trends/fa7107281a0347338debff50448f3943
- What Is Proactive AI? (Autonomous.ai): https://www.autonomous.ai/ourblog/proactive-ai
- Proactive AI Assistant Went Mainstream (Ron Forbes): https://www.ronforbes.com/blog/the-week-the-proactive-ai-assistant-went-mainstream
- Memory Management for AI Agents (Medium): https://medium.com/@fred-zhang/memory-management-for-ai-agents-from-cognitive-architectures-to-context-engineering-to-293ef6a4ccab

### 产品
- Elani: https://elani.ai/
- Demi AI: https://www.demi.md/features
- Mio: https://mio.fyi/
- Meli: https://meli.im/
- Mira: https://www.mymira.io/
- Aria: https://www.ariavanta.com/
- Revo: https://www.getrevo.app/
- Donna: https://heydonna.co/
- Arahi AI: https://www.arahi.ai/personal-assistant
- Retinue: https://getretinue.com/
- Autonomous Intern: https://www.autonomous.ai/

### 开源
- THUNLP ProactiveAgent: https://github.com/thunlp/ProactiveAgent
- OpenBMB XAgent: https://github.com/OpenBMB/XAgent
- OpenBMB ProAgent: https://github.com/openbmb/proagent
- SuperAgentX: https://github.com/superagentxai/superagentx
- leomariga ProactiveAgent: https://github.com/leomariga/ProactiveAgent
- ProAct: https://github.com/GreatX3/ProAct
- Autonomous Agents Paper List: https://github.com/tmgthb/Autonomous-Agents
