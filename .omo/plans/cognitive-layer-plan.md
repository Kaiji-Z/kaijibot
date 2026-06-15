# KaijiBot → 汽车人：认知层架构设计与实施计划

## 0. 项目愿景

将 KaijiBot 从被动式 AI 助手改造为拥有意图感知能力的长期记忆主动式智能体（启发性思考伙伴）。

核心特点：
- **启发性**：主动了解用户，基于用户认知模型提供跨领域灵感
- **意图感知**：从对话中提取深层认知意图（不是任务意图，是理解用户"是什么样的人"）
- **长期记忆**：构建用户认知模型（PersonaTree），跨会话持续积累
- **双模式**：保留全部助手功能 + 增加主动式思考伙伴能力
- **平台无关**：认知层与通道解耦，飞书/微信/Web 都是即插即用的适配器

## 1. 架构总览

```
┌─────────────────────────────────────────────────────────────────────┐
│                        COGNITIVE LAYER (新增)                       │
│                                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │
│  │ 模式路由器    │  │ 用户认知模型  │  │ 启发引擎                  │  │
│  │ ModeRouter   │  │ PersonaTree  │  │ InsightEngine            │  │
│  │              │  │              │  │                          │  │
│  │ task ────────┤  │ L1 身份记忆   │  │ 跨领域映射器              │  │
│  │ insight ─────┤  │ L2 领域记忆   │  │ 意外度评分                │  │
│  │ hybrid ──────┤  │ L3 会话记忆   │  │ 信息验证流水线            │  │
│  │ proactive ───┤  │              │  │                          │  │
│  └──────────────┘  └──────┬───────┘  └────────────┬─────────────┘  │
│                           │                        │                │
│  ┌────────────────────────┴────────────────────────┴─────────────┐  │
│  │              反馈与偏好学习层                                    │  │
│  │  FeedbackCollector → ThompsonSampling → 话题/频率自适应         │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                           │                                        │
│  ┌────────────────────────┴──────────────────────────────────────┐  │
│  │              主动调度器 (ProactiveScheduler)                    │  │
│  │  替代 heartbeat 的通用认知调度器                                 │  │
│  │  事件源: 时间 / 信息更新 / 用户画像变化 / 外部 webhook           │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
         │                    │                    │
    ┌────┴────┐         ┌────┴────┐          ┌────┴────┐
    │ Feishu  │         │ WebChat │          │ Future  │
    │ (现有)  │         │ (现有)  │          │ 通道    │
    └─────────┘         └─────────┘          └─────────┘
```

## 2. 核心数据模型

### 2.1 用户认知模型 (PersonaTree)

存储位置: `~/.kaijibot/cognitive/persona/<userId>.json`

```typescript
interface PersonaTree {
  // L1: 身份记忆 — 极少变化，始终在上下文中
  identity: {
    coreTraits: Map<string, ConfidenceValue>;   // "技术决策者": 0.9
    communicationStyle: CommunicationStyle;      // 语言风格
    timezone: string;
    primaryLanguage: string;
    expertDomains: string[];                     // 精通领域
    interestDomains: string[];                   // 感兴趣领域
    curiosityDomains: string[];                  // 好奇但还不了解的领域
  };

  // L2: 领域记忆 — 演化更新，按领域组织
  domains: Map<string, DomainNode>;              // "AI架构" → {insights, projects, questions}

  // L3: 会话记忆 — 短期衰减
  recentFocus: string[];                         // 最近关注的话题
  activeProjects: string[];                      // 活跃项目
  pendingQuestions: string[];                    // 悬而未决的问题

  // 反馈模型
  feedbackProfile: {
    topicBandits: Map<string, { alpha: number; beta: number }>;  // Thompson Sampling
    preferredStyle: "question" | "observation" | "connection";
    optimalFrequency: number;                     // 最优推送频率（小时）
    lastProactiveAt: number;                      // 上次主动推送时间戳
    suppressUntil?: number;                       // 抑制到某个时间
  };

  // 关系指标
  rapport: {
    trustScore: number;         // 0-1，基于互动深度和反馈
    totalExchanges: number;
    avgResponseLength: number;  // 用户平均回复长度（参与度指标）
    selfDisclosureLevel: number; // 用户自我暴露程度
  };
}

interface ConfidenceValue {
  value: string;
  confidence: number;      // 0-1
  evidenceCount: number;   // 支撑证据数
  lastUpdated: number;     // 时间戳
  source: "explicit" | "inferred" | "observed";
}

interface DomainNode {
  depth: number;            // 参与深度 (0-10)
  recurrence: number;       // 话题复现次数
  lastMentioned: number;    // 时间戳
  keyInsights: string[];    // 用户在此领域的关键洞见
  activeQuestions: string[]; // 用户在此领域的开放问题
  connections: string[];     // 与其他领域的关联
}

interface CommunicationStyle {
  formality: "formal" | "casual" | "mixed";
  verbosity: "concise" | "moderate" | "detailed";
  technicalLevel: "beginner" | "intermediate" | "expert";
  preferredLanguage: "zh" | "en" | "mixed";
}
```

### 2.2 启发记录

存储位置: `~/.kaijibot/cognitive/insights/<userId>/`

```typescript
interface InsightRecord {
  id: string;
  generatedAt: number;
  triggerSource: "scheduled" | "event" | "conversational";
  targetDomains: string[];        // 涉及的用户领域
  sourceDomains: string[];        // 信息来源领域（跨领域）
  content: string;                // 启发内容
  rationale: string;              // 为什么认为用户会感兴趣
  sources: VerifiedSource[];      // 信息来源（带验证）
  feedback?: "positive" | "negative" | "neutral" | "engaged";
  deliveredAt?: number;
  userResponse?: string;          // 用户反应（展开了讨论？无视了？）
}
```

### 2.3 配置结构

```typescript
// 新增配置节: cognitive
interface CognitiveConfig {
  /** 启用认知层（默认 true） */
  enabled?: boolean;

  /** 主动行为配置 */
  proactive?: {
    /** 是否允许主动推送（默认 true） */
    enabled?: boolean;
    /** 主动推送最小间隔（小时，默认 4） */
    minIntervalHours?: number;
    /** 活跃时段 */
    activeHours?: {
      start?: string;
      end?: string;
      timezone?: string;
    };
    /** 启发推送模式 */
    digestMode?: "realtime" | "daily" | "weekly";
  };

  /** 用户认知模型配置 */
  persona?: {
    /** 是否自动提取用户画像（默认 true） */
    autoExtract?: boolean;
    /** 提取用的轻量模型（默认使用主模型） */
    extractionModel?: string;
    /** L1 身份记忆刷新间隔（小时，默认 24） */
    identityRefreshHours?: number;
  };

  /** 启发引擎配置 */
  insight?: {
    /** 信息源配置 */
    sources?: {
      /** Web 搜索提供商 */
      webSearchProvider?: string;
      /** 搜索频率（小时，默认 6） */
      scanIntervalHours?: number;
      /** 关注的关键词/话题（也自动从用户画像推断） */
      explicitTopics?: string[];
    };
    /** 信息验证严格度 */
    verificationLevel?: "basic" | "strict" | "paranoid";
  };

  /** 反馈配置 */
  feedback?: {
    /** 反馈方式 */
    mechanism?: "emoji" | "buttons" | "text";
    /** 是否收集隐式反馈（默认 true） */
    implicitFeedback?: boolean;
  };
}
```

## 3. 插入点设计

基于对 dispatch pipeline 的完整追踪，以下是认知层的精确插入点：

### 3.1 模式路由器 (ModeRouter)

**插入位置**: `src/auto-reply/reply/get-reply.ts` 第 540-566 行之间

在 `before_agent_reply` hook 之后、`runPreparedReply` 之前，插入模式分类逻辑：

```
getReplyFromConfig() 流程:
  1. 解析指令（directives）     ← 已有
  2. before_agent_reply hook   ← 已有
  3. 【模式分类】               ← 新增：调用轻量 LLM 分类意图
  4. 【认知上下文注入】          ← 新增：注入用户认知模型片段
  5. runPreparedReply()         ← 已有（可能带认知增强的 prompt）
```

**实现方式**:
- 在 `get-reply.ts` 的 `getReplyFromConfig()` 中增加认知层调用
- 不用 hook，直接在代码中插入，因为需要确定性控制
- 调用轻量模型（或规则引擎）做快速分类（<200ms）

### 3.2 用户认知模型提取器 (PersonaExtractor)

**插入位置**: 两个触发点

1. **对话中提取**: `src/agents/pi-embedded-subscribe.handlers.messages.ts`
   - `handleMessageEnd()` 之后触发异步提取
   - 不阻塞主流程，后台运行

2. **定时批量提取**: `src/agents/pi-embedded-runner/run/attempt.ts`
   - 在 `buildEmbeddedSystemPrompt()` 调用前
   - 注入用户认知模型片段到 context files

**存储**: `~/.kaijibot/cognitive/persona/<userId>.json`
- 独立于 session JSONL，有自己的生命周期
- 压缩（compaction）不会影响它

### 3.3 认知上下文注入 (CognitiveContextInjector)

**插入位置**: `src/agents/system-prompt.ts` 的 `buildAgentSystemPrompt()`

在 context files 加载阶段（第 36-44 行的 `CONTEXT_FILE_ORDER`），增加认知层上下文文件：
- `cognitive-persona.md` — 用户认知模型摘要（从 PersonaTree 动态生成）
- `cognitive-mode.md` — 当前模式指令（task/insight/hybrid 的行为规则）

这些文件由认知层在每次 agent turn 前动态生成到 agent dir 中。

### 3.4 主动调度器 (ProactiveScheduler)

**插入位置**: 替代现有 heartbeat 机制的增强版

基于 `src/infra/heartbeat-runner.ts` 改造：
- 保留 heartbeat 的框架（定时触发、session lane、delivery）
- 增加新的事件源：
  - 信息扫描定时器（web search for user topics）
  - 用户画像变化触发（当 persona 更新达到阈值时）
  - 外部 webhook 事件
- 增加门控逻辑：
  - 检查 `rapport.trustScore` 是否足够高（新用户不主动）
  - 检查 `feedbackProfile.suppressUntil` 是否过期
  - 检查 Thompson Sampling 是否推荐当前时机

### 3.5 反馈收集器 (FeedbackCollector)

**插入位置**: 注册为 plugin tool

通过 `api.registerTool()` 注册 `cognitive_feedback` 工具：
- Agent 可以在启发推送后主动询问反馈
- 反馈结果写入 `feedbackProfile.topicBandits`
- 同时注册 `before_agent_reply` hook 检测隐式反馈信号

### 3.6 Compaction 保护

**插入位置**: `src/agents/compaction.ts`

在 compaction 的 `MERGE_SUMMARIES_INSTRUCTIONS`（第 24-37 行）中增加：
```
"- User's core interests and ongoing concerns (from cognitive persona)"
"- Active exploration topics and cross-domain connections"
"- Pending questions the user is thinking about"
```

同时在 `buildEmbeddedSystemPrompt()` 中，将认知上下文文件标记为不可压缩（类似 `heartbeat.md` 的 `DYNAMIC_CONTEXT_FILE_BASENAMES` 处理方式）。

## 4. 配置集成

需要修改的配置文件（按顺序）：

1. **新增 `src/config/types.cognitive.ts`** — 定义 `CognitiveConfig` 类型
2. **修改 `src/config/types.ts`** — 添加 re-export
3. **修改 `src/config/types.kaijibot.ts`** — 在 `KaijiBotConfig` 中添加 `cognitive?: CognitiveConfig`
4. **新增 `src/config/zod-schema.cognitive.ts`** — 定义 Zod schema
5. **修改 `src/config/zod-schema.ts`** — 在 `KaijiBotSchema` 中添加 `cognitive` 节
6. **修改 `src/config/defaults.ts`** — 添加 `applyCognitiveDefaults()`
7. **修改 `src/config/materialize.ts`** — 应用认知层运行时默认值

## 5. 新增文件清单

### 核心模块 (`src/cognitive/`)

```
src/cognitive/
├── index.ts                           # 公共导出
├── types.ts                           # 所有认知层类型定义
├── mode-router.ts                     # 模式分类器
├── mode-router-rules.ts               # 分类规则（确定性部分）
├── persona/
│   ├── types.ts                       # PersonaTree 类型
│   ├── store.ts                       # 读写 persona JSON
│   ├── extractor.ts                   # 从对话提取属性（调 LLM）
│   ├── extractor-prompts.ts           # 提取用的 prompt 模板
│   ├── curator.ts                     # 合并、提升、修剪 persona
│   └── context-builder.ts             # 生成 cognitive-persona.md
├── insight/
│   ├── types.ts                       # InsightRecord 类型
│   ├── engine.ts                      # 启发引擎主逻辑
│   ├── cross-domain-mapper.ts         # 跨领域映射
│   ├── serendipity-scorer.ts          # 意外度/相关性评分
│   ├── verification/
│   │   ├── pipeline.ts                # 五阶段验证流水线
│   │   ├── source-credibility.ts      # 来源可信度评分
│   │   └── contradiction-detector.ts  # 矛盾检测
│   └── store.ts                       # 启发记录存储
├── feedback/
│   ├── types.ts                       # 反馈类型
│   ├── collector.ts                   # 显式+隐式反馈收集
│   ├── preference-learner.ts          # Thompson Sampling
│   └── trust-calculator.ts            # 信任分数计算
├── scheduler/
│   ├── types.ts                       # 调度器类型
│   ├── proactive-scheduler.ts         # 主动调度器
│   ├── event-sources/
│   │   ├── timer-source.ts            # 定时触发
│   │   ├── info-scan-source.ts        # 信息扫描触发
│   │   └── persona-change-source.ts   # 画像变化触发
│   └── gate.ts                        # 门控逻辑
├── config/
│   ├── types.ts                       # CognitiveConfig
│   ├── zod-schema.ts                  # CognitiveSchema
│   └── defaults.ts                    # 默认值
└── tools/
    ├── cognitive-feedback-tool.ts      # 👍👎 反馈工具
    └── cognitive-insight-tool.ts       # 启发推送工具
```

### 配置集成文件（修改）

```
src/config/types.cognitive.ts          # 新增
src/config/types.ts                    # 修改：添加 re-export
src/config/types.kaijibot.ts           # 修改：添加 cognitive 字段
src/config/zod-schema.cognitive.ts     # 新增
src/config/zod-schema.ts               # 修改：添加 cognitive schema
src/config/defaults.ts                 # 修改：添加 applyCognitiveDefaults
src/config/materialize.ts              # 修改：认知层运行时默认值
```

### 管道集成文件（修改）

```
src/auto-reply/reply/get-reply.ts                  # 修改：模式路由 + 认知注入
src/agents/system-prompt.ts                         # 修改：CONTEXT_FILE_ORDER + 认知上下文
src/agents/compaction.ts                            # 修改：认知信息保护
src/agents/pi-embedded-subscribe.handlers.messages.ts # 修改：对话后异步提取
src/infra/heartbeat-runner.ts                       # 修改：增强为主动调度器
```

### 测试文件

```
src/cognitive/mode-router.test.ts
src/cognitive/persona/extractor.test.ts
src/cognitive/persona/curator.test.ts
src/cognitive/insight/engine.test.ts
src/cognitive/feedback/preference-learner.test.ts
src/cognitive/scheduler/proactive-scheduler.test.ts
src/cognitive/config/zod-schema.test.ts
```

## 6. 分阶段实施计划

### Phase 1: 地基 — 配置 + 类型 + 模式路由器（1 周）

**目标**: 最小可运行的认知层，能区分 task/insight 模式

**步骤**:
1. 创建 `src/cognitive/types.ts` — 所有核心类型
2. 创建 `src/config/types.cognitive.ts` + zod schema — 配置
3. 修改 `get-reply.ts` — 在 `before_agent_reply` 之后插入 ModeRouter
4. 实现 `src/cognitive/mode-router.ts`:
   - 先用纯规则（正则 + 关键词）做分类
   - 祈使动词 + 明确对象 → task
   - 疑问词 + 开放式 → insight
   - 其他 → hybrid
5. 修改 `src/agents/system-prompt.ts` — 增加模式指令注入
6. 写测试

**验证**: 用户说"帮我发个消息"走 task 路径（正常执行），"你觉得微服务架构还有未来吗"走 insight 路径（带启发式 prompt）。

### Phase 2: 用户认知模型（1.5 周）

**目标**: 能从对话中自动提取并积累用户画像

**步骤**:
1. 实现 `src/cognitive/persona/store.ts` — JSON 读写
2. 实现 `src/cognitive/persona/extractor.ts`:
   - 对话结束后，异步调用轻量 LLM 提取结构化属性
   - 输出: `(attribute, value, confidence, source)` 元组
3. 实现 `src/cognitive/persona/curator.ts`:
   - 合并新提取到现有 PersonaTree
   - 置信度更新规则：evidenceCount 越高越稳定
   - L1 字段要求多条证据才能写入
4. 实现 `src/cognitive/persona/context-builder.ts`:
   - 将 PersonaTree 转为 `cognitive-persona.md` 供 system prompt 注入
5. 在 `pi-embedded-subscribe.handlers.messages.ts` 的 `handleMessageEnd` 后触发提取
6. 修改 compaction 保护认知上下文
7. 写测试

**验证**: 和 agent 聊 10 轮后，检查 `~/.kaijibot/cognitive/persona/` 生成的画像文件是否合理。

### Phase 3: 主动调度器 + 启发引擎原型（2 周）

**目标**: 能定时主动推送个性化启发

**步骤**:
1. 实现 `src/cognitive/scheduler/proactive-scheduler.ts`:
   - 基于 heartbeat-runner 改造
   - 增加门控：trustScore 阈值、频率限制、suppressUntil
2. 实现 `src/cognitive/insight/engine.ts`:
   - 输入: 用户 PersonaTree + 当前信息
   - 输出: InsightRecord 候选列表
   - 第一版: 用主 LLM 生成启发，基于用户领域 + 最近关注
3. 实现 `src/cognitive/feedback/collector.ts`:
   - 注册 `cognitive_feedback` 工具
   - 在启发推送卡片中包含 👍👎 按钮
4. 实现 `src/cognitive/feedback/preference-learner.ts`:
   - Thompson Sampling: 每个话题一个 Beta 分布
   - 冷启动: 乐观初始化
5. 实现 `src/cognitive/insight/verification/pipeline.ts`:
   - 多源检索 + 基本可信度评分
   - 第一版: 2 个来源交叉验证即可
6. 写测试

**验证**: 配置一个定时任务，agent 能根据用户画像主动推送一条启发，用户能给反馈。

### Phase 4: 深化 — 跨领域映射 + 信任建立（1.5 周）

**目标**: 启发质量显著提升，能发现跨领域关联

**步骤**:
1. 实现 `src/cognitive/insight/cross-domain-mapper.ts`:
   - 语义距离计算
   - 结构映射（Structure-Mapping Theory 简化版）
2. 实现 `src/cognitive/insight/serendipity-scorer.ts`:
   - 相关性 × 意外度 × 新颖度
3. 实现 `src/cognitive/feedback/trust-calculator.ts`:
   - 基于 TACT 框架的 Switch/Recovery 指标
   - 信任建立策略选择（SARA 框架 7 种策略）
4. 增强 PersonaExtractor:
   - 加入隐式信号分析（回复长度、响应时间、话题深入程度）
   - 加入自然对话策略（2:1 陈述提问比、back-channel）
5. 增强信息验证:
   - 矛盾检测
   - 来源可信度评分（CRED-1 风格）
6. 写测试

**验证**: 用户聊了几天后，agent 能推送一条用户没想到但觉得有价值的跨领域洞见。

### Phase 5: 完善 + 集成测试（1 周）

**步骤**:
1. 端到端集成测试
2. 性能优化（轻量分类 <200ms，提取不阻塞主流程）
3. 配置 CLI 支持（`kaijibot config set cognitive.proactive.enabled true`）
4. 错误处理 + 优雅降级（认知层出错不影响助手功能）
5. 更新 AGENTS.md

## 7. 设计原则

### 7.1 不破坏助手功能

认知层是叠加在现有功能之上的：
- 模式路由器的默认返回是 `task`（现有行为不变）
- 认知层出错时降级为纯助手模式
- 用户可以通过配置完全关闭认知层
- "直接做"等短语可以临时抑制启发模式

### 7.2 渐进式信任建立

遵循 SARA 框架（IJCAI 2017）:
```
Turn 1-3:   展示能力 + 积极倾听（ASN + ACK）
Turn 4-8:   Agent 自我分享 + 引用用户之前发言（SD + RSE）
Turn 8+:    适当好奇心提问（QESD）
信任足够后:  开始主动推送启发
```

### 7.3 反馈驱动自适应

- 每个话题维护 Thompson Sampling Beta 分布
- 👍 → alpha + 1，👎 → beta + 1
- 用户展开了讨论 → 隐式正面反馈
- 用户无视了 → 隐式负面反馈（轻微）
- 频率根据反馈动态调整

### 7.4 信息可信度

- 启发内容必须经过至少 2 个独立来源验证
- 始终附带来源引用
- 当来源矛盾时，明确告知用户"有不同观点"
- 从不编造事实

### 7.5 存储与隐私

- 用户认知模型存储在本地 (`~/.kaijibot/cognitive/`)
- 不会上传到任何外部服务
- 用户可以查看、编辑、删除自己的画像
- 画像数据不进入训练数据

## 8. 与现有系统的关系

```
pi-coding-agent (外部库)     → 不修改（LLM 推理 + 工具循环）
KaijiBot 核心                → 最小修改（5 个文件，精确插入）
认知层 (src/cognitive/)      → 全新模块，独立目录
现有记忆插件                  → 桥接使用（读取 memory-core 的数据）
现有 heartbeat               → 增强为 ProactiveScheduler
现有 cron                    → 继续使用（定时任务调度）
现有 plugin SDK              → 继续使用（注册工具、hook）
```

## 9. 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| 模式分类错误 | 用户在 task 模式收到不需要的启发 | 默认 task，只在明确信号时切 insight；"直接做"逃生机制 |
| 用户画像提取不准确 | 推送不相关的启发 | 低置信度不写入 L1；多条证据才确认；用户可修正 |
| 主动推送太频繁 | 用户反感 | 门控逻辑 + Thompson Sampling 频率自适应 + suppressUntil |
| LLM 幻觉启发内容 | 推送错误信息 | 多源验证 + 来源引用 + 三态输出（确信/带保留/拒绝） |
| 认知层性能开销 | 回复变慢 | 提取异步执行不阻塞主流程；模式分类用规则优先 |
| 认知层崩溃 | 全系统不可用 | 完全隔离的错误边界；catch 所有异常降级为纯助手 |

## 10. 成功指标

Phase 1 完成标准:
- [ ] 模式分类器对 20 个测试用例准确率 > 85%
- [ ] 分类延迟 < 200ms
- [ ] 不影响现有 task 执行

Phase 2 完成标准:
- [ ] 10 轮对话后提取出 > 5 个用户属性
- [ ] 提取过程不增加回复延迟
- [ ] PersonaTree 持久化并可恢复

Phase 3 完成标准:
- [ ] 能按时推送个性化启发
- [ ] 👍👎 反馈正确记录并影响后续推送
- [ ] 启发内容通过 2 源验证

Phase 4 完成标准:
- [ ] 跨领域启发占推送的 > 30%
- [ ] 用户正面反馈率 > 60%
- [ ] 信任分数随互动增加单调上升

Phase 5 完成标准:
- [ ] 全量测试通过
- [ ] `pnpm build` 成功
- [ ] `pnpm check` 无新增错误
- [ ] AGENTS.md 更新
