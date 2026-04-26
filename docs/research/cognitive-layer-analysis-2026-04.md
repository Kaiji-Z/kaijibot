# KaijiBot 认知层与记忆系统：深度分析与进化路线图

> 分析时间：2026 年 4 月
> 基于：43 个认知层文件 + 100+ 记忆系统文件 + 学术前沿论文对比
> 参考：docs/research/proactive-agent-landscape-2026-04.md

---

## 一、现状全景：7 个记忆子系统 + 4 条数据流

### 1.1 记忆子系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                    KaijiBot 记忆架构                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────────┐  ┌──────────────────┐                │
│  │ 1. 语义记忆       │  │ 2. 短期回忆+晋升  │                │
│  │ (memory-core)     │  │ (dreaming)        │                │
│  │ SQLite+FTS5+vec   │  │ 6因子评分         │                │
│  │ 混合检索+MMR      │  │ cron触发晋升      │                │
│  └────────┬─────────┘  └────────┬─────────┘                │
│           │                      │                          │
│  ┌────────┴─────────┐  ┌────────┴─────────┐                │
│  │ 3. 知识库         │  │ 4. 认知人格       │                │
│  │ (memory-wiki)     │  │ (persona store)   │                │
│  │ Obsidian兼容      │  │ JSON持久化        │                │
│  │ 结构化声明+证据   │  │ Thompson Sampling │                │
│  └────────┬─────────┘  └────────┬─────────┘                │
│           │                      │                          │
│  ┌────────┴─────────┐  ┌────────┴─────────┐                │
│  │ 5. 洞察存储       │  │ 6. 会话历史       │                │
│  │ (insight store)   │  │ (session/transcript)│              │
│  │ 意外性评分        │  │ NDJSON + 压缩     │                │
│  │ 跨域映射器        │  │ 磁盘预算管理      │                │
│  └────────┬─────────┘  └────────┬─────────┘                │
│           │                      │                          │
│  ┌────────┴──────────────────────┴─────────┐                │
│  │ 7. 记忆冲刷 (memory flush)               │                │
│  │ 上下文窗口压力释放 → LLM写入记忆文件      │                │
│  └──────────────────────────────────────────┘                │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 1.2 各子系统详情

| # | 子系统 | 存储 | 核心机制 | 关键文件 |
|---|--------|------|----------|----------|
| 1 | **语义记忆** | SQLite + sqlite-vec + FTS5 | 混合检索（0.7向量+0.3文本）→ 时间衰减 → MMR去重 | `memory-core/src/memory/hybrid.ts`, `mmr.ts`, `temporal-decay.ts` |
| 2 | **短期晋升** | JSON (.dreams/short-term-recall.json) | 6因子加权评分 → cron晋升到MEMORY.md | `memory-core/src/short-term-promotion.ts` |
| 3 | **知识库** | Markdown文件（Obsidian兼容） | 声明+证据+置信度+新鲜度多信号排序 | `memory-wiki/src/query.ts`, `vault.ts` |
| 4 | **认知人格** | JSON (persona/{userId}.json) | LLM提取+规则兜底 → 置信度合并 → 修剪 | `cognitive/persona/store.ts`, `llm-extractor.ts`, `curator.ts` |
| 5 | **洞察存储** | JSON (insights/{userId}/{id}.json) | LLM生成+模板兜底 → 意外性评分 → 验证管道 | `cognitive/insight/llm-engine.ts`, `serendipity-scorer.ts` |
| 6 | **会话历史** | NDJSON (sessions/) | LLM驱动压缩 + 磁盘预算 + 历史轮次限制 | `agents/compaction.ts`, `config/sessions/` |
| 7 | **记忆冲刷** | memory/*.md | 上下文窗口压力 → LLM Agent写入 → 压缩释放 | `auto-reply/reply/memory-flush.ts` |

### 1.3 四条核心数据流

#### 流程 A：读路径（每条消息触发）

```
用户消息到达
  → PersonaStore.load(userId)                    [读 persona.json]
  → classifyMode(message, context)                [mode-router.ts]
    → 返回: {mode: task|insight|hybrid|proactive, confidence, signals}
  → buildModePromptSection(mode)                  [模式特定指令]
  → buildPersonaContext(persona)                  [context-builder.ts]
    → 过滤: 置信度≥0.5 的特质, 深度≥3 的领域
    → 返回: "## User Cognitive Profile" 系统提示段
  → getInteractionPhase(trustScore)               [trust-calculator.ts]
    → SARA框架: 导向→探索→默契→伙伴
  → 注入到系统提示                                [system-prompt.ts]
```

#### 流程 B：写路径（每轮对话后，fire-and-forget）

```
Agent回复完成
  → extractFromMessageLLM(userText, assistantText, persona)  [5s超时, temp=0.2]
    → 失败时降级: extractFromMessage()                       [规则引擎, <50ms]
  → mergeExtraction(persona, extraction)                     [置信度加权合并]
  → prunePersona(merged)                                     [修剪: <0.2且5+次观察, 30天未提及且重现<3]
  → extractImplicitSignals(userText)                         [5种隐式信号]
  → processImplicitFeedback(pruned, signals)                 [更新信任分+话题赌博机]
  → PersonaStore.save(userId, feedbackUpdated)               [写 persona.json]
```

#### 流程 C：主动推送路径（定时器触发）

```
定时器触发 (默认4h)
  → checkProactiveGate(persona, config)                      [5道门]
    ① 信任分 ≥ 0.5
    ② 距上次推送 ≥ minIntervalHours
    ③ 未在免打扰窗口
    ④ 在活跃时段内 (时区感知)
    ⑤ 总交互 ≥ 5 次
  → generateInsightCandidatesLLM(persona)                    [8s超时, temp=0.7]
    → 失败时降级: 模板引擎 (3种策略)
  → scoreSerendipity()                                       [意外性评分]
  → verifyInsight()                                          [验证管道]
  → enqueueSystemEvent() → requestHeartbeatNow()             [推送到用户]
  → 更新 persona.feedbackProfile.lastProactiveAt
```

#### 流程 D：显式反馈路径（Agent工具调用）

```
用户对洞察做出反应
  → Agent调用 "cognitive_feedback" 工具
  → updateBanditFromFeedback()   [Thompson Sampling: Beta分布更新]
  → updateTrustFromFeedback()    [信任分: +0.05正面, +0.08参与, -0.08负面]
  → adaptFrequency()             [频率: 正面-0.5h, 负面+2h, 范围[1,48]h]
```

---

## 二、与学术前沿的对比分析

### 2.1 KaijiBot 的优势（达到或超越前沿的部分）

| 优势 | KaijiBot 实现 | 学术对应 | 优势说明 |
|------|---------------|----------|----------|
| **6因子短期记忆晋升** | `short-term-promotion.ts` 6组件加权（频率0.24+相关性0.30+多样性0.15+新近度0.15+巩固0.10+概念0.06）+ 做梦阶段信号 | AgeMem/MemPO 单一二值阈值 | 学术论文用单一阈值做记忆晋升，KaijiBot的6因子+阶段信号boost更精细 |
| **混合检索+MMR+时间衰减** | `hybrid.ts` 0.7/0.3向量/文本 → `temporal-decay.ts` 指数衰减 → `mmr.ts` 多样性重排 | MemPO 的学习式压缩 | 检索层面已经很强，MemPO的优势在压缩而非检索 |
| **Thompson Sampling赌博机** | `preference-learner.ts` Marsaglia-Tsang Gamma采样，完整Beta分布 | PPP框架的多目标RL | 对于这个规模，TS比梯度RL更稳健、更简单 |
| **SARA信任4阶段** | `trust-calculator.ts` 导向→探索→默契→伙伴，50%粘性 | PRISM 的二元说/不说 | 比PRISM更成熟，有具体行为策略而非简单阈值 |
| **信任自适应意外性** | `serendipity-scorer.ts` 低信任偏相关性，高信任偏惊喜 | PRISM 的 p_accept 近似 | 更优雅的安全机制 |
| **双提取路径** | LLM提取（5s超时）+ 规则兜底（<50ms） | 学术系统假设完美LLM | 生产级可靠性 |
| **预压缩记忆冲刷** | `memory-flush.ts` 上下文窗口压力释放 | 学术论文忽略 | 实际系统必需的工程机制 |

### 2.2 关键差距（学术前沿有但KaijiBot缺失的）

#### 差距 A：无正式主动性决策框架（对应 PRISM, ICLR 2026）

**现状**：`gate.ts` 使用5个硬编码二元门（信任、间隔、免打扰、时段、交互次数）
**学术前沿**：PRISM 形式化为 `p_need × p_accept > threshold`，是**分级决策**而非一系列 yes/no 检查
**问题**：无法做细腻权衡。高信任用户8小时未联系但在非活跃时段，会被硬性拦截

**位置**：`src/cognitive/scheduler/gate.ts:8-89`

#### 差距 B：无主动性能力分解（对应 PROBE, ICLR 2026）

**现状**：`ProactiveScheduler.processEvent()` 将搜索、识别、解决耦合在一起
**学术前沿**：PROBE 分解为 搜索→识别→解决 三阶段独立管道
**问题**：无法独立改进"发现机会"和"生成内容"；无法区分时机不好但内容好的洞察

**位置**：`src/cognitive/scheduler/proactive-scheduler.ts:33-69`

#### 差距 C：无记忆自我管理策略（对应 MemPO）

**现状**：Dreaming 系统晋升记忆但从不**重写**或**合并**已有长期记忆。`MEMORY.md` 只通过追加增长
**学术前沿**：MemPO Agent 主动压缩、重组、丢弃记忆，+25.98% F1，token减少67.58%
**问题**：长期记忆质量随时间退化，相似但措辞不同的条目累积

**位置**：`extensions/memory-core/src/short-term-promotion.ts:1431-1542`

#### 差距 D：无多源验证（Phase 4 未落地）

**现状**：`verification/pipeline.ts` 只检查结构性属性，从不实际获取或交叉引用网页来源
**学术前沿**：ContextAgent 使用多传感器交叉验证
**问题**：每个洞察都是"未验证"状态，无法用外部证据支撑建议

**位置**：`src/cognitive/insight/engine.ts:109`, `verification/pipeline.ts:22-28`

#### 差距 E：静态跨域图

**现状**：`cross-domain-mapper.ts` 硬编码8个领域的邻接图，新领域默认连接到"AI/机器学习"
**学术前沿**：动态学习领域关系，从交互中更新
**问题**：生物信息学、法律、游戏设计的用户得到通用"AI/ML"桥接而非有意义的连接

**位置**：`src/cognitive/insight/cross-domain-mapper.ts:10-19`

#### 差距 F：无上下文感知触发（对应 ContextAgent, NeurIPS 2025）

**现状**：主动触发纯粹基于时间（TimerSource），PersonaChangeSource和InfoScanSource已实现但未接入
**学术前沿**：ContextAgent 使用穿戴设备传感器数据驱动主动行为
**问题**：无法感知"用户刚开完关于X的会"并推送相关洞察

**位置**：`src/gateway/server.impl.ts` — 只用了 timer-source

#### 差距 G：无长期规划（对应 ProAct）

**现状**：每次 processEvent 最多生成1个洞察，无跨事件编排
**学术前沿**：ProAct 使用MCTS规划多轮主动策略（"今天种种子→3天后跟进→7天后问意见"）
**问题**：无法执行需要多天的渐进式主动引导

#### 差距 H：无用户负担优化（对应 BAO）

**现状**：频率适应是线性单向的（正面-0.5h，负面+2h）
**学术前沿**：BAO 框架为任务效用 vs 中断成本的帕累托优化
**问题**：无法区分"用户不想要X的洞察"和"用户现在很忙"

---

## 三、进化路线图

### 3.1 快速胜利（每项 < 4h，利用现有基础设施）

#### Q1：接入 InfoScanSource 和 PersonaChangeSource ✅ 基础设施已就绪

两个事件源已实现并有测试覆盖，只需在 gateway 初始化时接入。

**改动范围**：
- `src/gateway/server.impl.ts:1261-1310` — 初始化时注册 PersonaChangeSource 和 InfoScanSource
- `src/cognitive/scheduler/proactive-scheduler.ts` — processEvent 中添加事件类型分支

**预期收益**：信任跨阶段时自动触发主动推送；信息扫描触发周期性洞察

#### Q2：将二元门升级为 PRISM 风格分级决策 ⭐ 最高杠杆

重构 `checkProactiveGate` 返回 `p_act` 评分（0-1）而非 `allowed: boolean`。

**改动范围**：
- `src/cognitive/scheduler/gate.ts` — 返回 `{ p_need, p_accept, p_act, decision }` 替代 `{ allowed }`
- `p_need` = f(距上次, 领域活跃度)
- `p_accept` = f(信任分, 话题赌博机, 近期反馈)
- 新增配置：`cognitive.proactive.actThreshold`（默认0.6）

**预期收益**：主动性从"刚性cron"变为"上下文响应式"

#### Q3：洞察交付闭环反馈

**改动范围**：
- `src/cognitive/insight/store.ts` — 记录交付时间和用户响应
- `src/cognitive/feedback/collector.ts` — 将洞察反馈接回 Thompson Sampling 赌博机

**预期收益**：PROBE 论文识别的关键闭环——区分"时机不对"和"内容不好"

#### Q4：Persona 加载时 schema 校验

**改动范围**：
- `src/cognitive/persona/store.ts` — load 时用 zod 校验

**预期收益**：防止损坏状态级联

### 3.2 中期目标（每项 1-2 天，新子系统或重大重构）

#### M1：长期记忆合并（MemPO 启发）— 解决无限增长问题

新增 `memory-consolidation` 做梦阶段：
1. 读取 MEMORY.md 条目
2. 用向量相似度识别重复/重叠声明
3. LLM 调用合并（复用 llm-extractor 模式）
4. 重写 MEMORY.md

**新增文件**：`extensions/memory-core/src/consolidation.ts`
**修改文件**：`extensions/memory-core/src/dreaming.ts`（添加合并阶段）
**预期收益**：阻止 MEMORY.md 无限增长，保持长期记忆质量

#### M2：动态领域图学习

替换静态 `DEFAULT_DOMAIN_ADJACENCIES`：
1. 从静态图种子启动
2. 两人格域在同一对话中出现时增强边权重
3. 未使用边衰减
4. 跨域洞察随使用量自动改善

**修改文件**：重写 `src/cognitive/insight/cross-domain-mapper.ts`

#### M3：网页搜索验证管道（Phase 4 落地）— 最高信任影响

1. 使用现有 browser 扩展搜索洞察声明
2. 提取片段，计算可信度评分
3. 接入 `verifyInsight()` 已有的 strict/paranoid 级别

**新增文件**：`src/cognitive/insight/verification/web-verifier.ts`
**修改文件**：`src/cognitive/insight/verification/pipeline.ts`

#### M4：搜索/识别/解决分离管道（PROBE 启发）

将 `processEvent` 拆分为三阶段：
- `search()`: 扫描机会（领域活跃度、信息扫描结果）
- `identify()`: 按 `p_need × p_accept` 排序机会
- `resolve()`: 为最佳机会生成洞察内容

**修改文件**：重构 `src/cognitive/scheduler/proactive-scheduler.ts`

### 3.3 长期目标（3+ 天，研究级工作）

#### L1：多目标 RL 主动决策（PPP 启发）

替换线性频率适应为 RL 策略：
- **状态**: (信任, 时段, 距上次天数, 话题赌博机分数, 近期反馈)
- **动作**: (不推, 推话题X, 发送摘要)
- **奖励**: 用户参与度（已有隐式信号）
- 从简单策略梯度开始，不需要完整 PPO

**研究贡献潜力**：KaijiBot 有真实信号数据，比 UserVille 模拟器更有说服力

#### L2：记忆自管理作为工具调用（AgeMem 启发）

给 Agent 显式记忆工具：`memory_store`, `memory_retrieve`, `memory_update`, `memory_discard`, `memory_summarize`

让 Agent 在对话中自主决定何时使用记忆工具：
- 用渐进RL训练：先监督学习（从当前提取），再RL微调
- 记忆管理从系统驱动变为 Agent 驱动

#### L3：多轮主动规划（ProAct 启发）

跟踪主动"活动"——多步参与策略：
- 示例："第1天: 提及X存在 → 第3天: 分享X的具体洞察 → 第7天: 问用户对X的看法"
- 用MCTS规划，用户反馈作为终端奖励
- **论文级贡献**

---

## 四、超越学术前沿的独特机会

### B1：真实反馈信号丰富度

学术论文使用模拟用户（UserVille）或 MTurk 标注。KaijiBot 有真实隐式信号：响应延迟、话题延续/放弃、回复长度、问题深度、自我披露水平、emoji反应。`trust-calculator.ts` 已处理5种信号类型。

**潜在论文方向**：证明真实隐式信号优于显式反馈用于主动时序决策

### B2：记忆回忆作为隐式反馈

`recordShortTermRecalls` 跟踪**什么记忆在何时被回忆**。这是零负担反馈信号——没有任何学术论文建模这个。`ShortTermRecallEntry` 的 `recallCount`、`dailyCount`、`groundedCount`、`queryHashes`、`recallDays` 比任何基准测试的数据都丰富。

### B3：做梦阶段信号作为神经科学启发的记忆

Light/REM 做梦阶段区分（`recordDreamingPhaseSignals`）使用独立的衰减函数，是生物学启发式的。阶段boost计算使用独立的力量+新近度组件。

**潜在论文方向**："睡眠阶段启发的AI Agent记忆巩固"

### B4：多扩展认知架构

插件系统意味着认知能力可以从独立扩展组装。学术原型是单体架构。KaijiBot 可以成为第一个认知组件（记忆、人格、洞察、反馈）独立可升级的平台。

### B5：跨用户迁移

`PersonaTree` 类型及其结构化域、信任和赌博机参数已经是潜在用户表示。有足够用户后，可以学习从人格向量到最优主动策略的映射——本质上是跨用户元学习。

---

## 五、总结

### 当前状态评估

```
认知层成熟度: ████████░░ 80%
记忆系统成熟度: ████████░░ 85%
主动性决策: █████░░░░░ 50%  ← 最大短板
验证管道: ███░░░░░░░ 30%  ← 信任障碍
上下文触发: ██░░░░░░░░ 20%  ← 未接线
跨域能力: █████░░░░░ 50%  ← 静态图
```

### 优先级排序

| 优先级 | 改动 | 预期收益 | 工作量 |
|--------|------|----------|--------|
| 🔴 最高 | Q2: PRISM风格分级门 | 从刚性cron到上下文响应 | 4h |
| 🔴 最高 | Q1: 接线已有事件源 | 多触发机制 | 2h |
| 🟠 高 | M3: 网页搜索验证 | 最高信任影响 | 2天 |
| 🟠 高 | Q3: 洞察反馈闭环 | 区分时机vs内容 | 4h |
| 🟡 中 | M1: 记忆合并 | 阻止无限增长 | 2天 |
| 🟡 中 | M2: 动态领域图 | 个性化跨域洞察 | 1天 |
| 🟡 中 | M4: PROBE分离管道 | 独立改进各阶段 | 1天 |
| 🟢 低 | L1: 多目标RL | 研究级提升 | 3+天 |
| 🟢 低 | L2: 记忆工具调用 | Agent驱动记忆 | 3+天 |
| 🟢 低 | L3: 多轮主动规划 | 论文级贡献 | 3+天 |

### 推荐的第一步

**Q2 + Q1 组合（6小时工作量）** 将主动性从"刚性cron"变为"上下文响应式"，这是最高杠杆的改动，利用了已有基础设施。

**完整路线图预估**：快速胜利 1-2 周 | 中期 1-2 月 | 长期 2-4 月（L1和L2可并行）
