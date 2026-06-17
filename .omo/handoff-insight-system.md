# 洞察系统优化 Handoff

## 用户原话

> "我的真实问题其实是：如何让洞察更有人味。一个是要符合用户给agent定的说话风格和灵魂，另一个是要多样化。"
> "我觉得生成的进化技能应该要符合skill creator生成的高质量技能"
> "我还觉得好多洞察都是 不是xx而是xx这种格式 或者 你xxx但是xxx"
> "我还觉得不是要禁用web search，而是想办法让web search更有用"
> "我的系统有预设的mbti soul的功能，这个你也要考虑进去"

## 目标

让 KaijiBot 的主动洞察系统从"系统推送格式化内容"变成"Agent 以自己的灵魂和个性忍不住想跟你说的话"。

## 背景：今天做了什么

今天这个 session 做了 3 大块工作：

1. pi-ai 0.65.2→0.79.4 + typebox 1.x 全量迁移（v2026.6.15-1 到 v2026.6.16-3）
2. 自进化系统 6 波改造（删死代码 + 质量门控 + delete_skill + 效果测量 + auto-promote）
3. 3 轮团队审计（项目审查 + 进化系统审查 + 洞察系统审查 + 洞察计划攻击审查）

当前版本 v2026.6.16-3，已发布 npm，git 干净。

---

## 待做：洞察系统全面优化

### Phase 0 — 即时修复（< 20 行代码，10 分钟）

以下 6 项是经过团队攻击后确认 SAFE 的即时修复：

**1. 删除"不是推荐"指令禁令（SMOKING GUN）**

- 文件：src/cognitive/insight/llm-engine.ts:889 和 1573 和 1339
- 当前：prompt 明确说 "Share something genuinely SURPRISING... feel like a genuine discovery, not a recommendation or tutorial"
- 问题：few-shot 示例全是可执行建议，但 prompt 禁止做建议 → LLM 被迫生成抽象哲学思辨
- 修复：删除 "not a recommendation or tutorial" 禁令，改为 "可以是发现、建议、或观察 — 只要能改变用户的某个决策或认知"
- 同样修改 pattern mode prompt 在 line 1339 附近的 Forbidden phrases

**2. 删除 enrichWithWebSources 假 source 附加**

- 文件：src/cognitive/insight/llm-engine.ts:766-779
- 当前：机械地把所有 webResults 作为 sources 附加到每个候选，不管内容是否引用了它们
- 问题：用户收到洞察 + 3 个不相关的 URL，破坏可信度
- 修复：把 enrichWithWebSources 改为返回空 sources 数组（`sources: []`），后续 Phase 1 会实现正确的 source 跟踪
- 具体代码：

```typescript
// 旧 (line 766-779):
function enrichWithWebSources(...) {
  return candidates.map(c => ({ ...c, sources: webResults.map(...) }));
}
// 新:
function enrichWithWebSources(...) {
  return candidates; // Phase 1 会实现 citedSourceIndices
}
```

**3. 默认 activeHours 09:00-22:00**

- 文件：src/config/zod-schema.cognitive.ts:7
- 当前：activeHours 是 optional，没有默认值 → 28% 洞察在凌晨 00:00-06:00 发送
- 修复：给 activeHours 设默认值 `["09:00", "22:00"]`

**4. 修复 activeHours 跨天逻辑**

- 文件：src/cognitive/scheduler/gate.ts:401
- 当前：`return currentMinutes < startMinutes || currentMinutes > endMinutes` 不支持跨天（如 22:00-07:00）
- 修复：检测 startMinutes > endMinutes 时用跨天判断：

```typescript
if (startMinutes > endMinutes) {
  // Overnight: active from start to midnight AND midnight to end
  return currentMinutes >= endMinutes && currentMinutes < startMinutes;
} else {
  return currentMinutes < startMinutes || currentMinutes > endMinutes;
}
```

**5. 统一 C_FN 值**

- 文件：src/cognitive/scheduler/proactive-scheduler.ts:964
- 当前：gate.ts 用 DEFAULT_C_FN=5.0，scheduler 用 DEFAULT_C_FN=4.0 → 不一致
- 修复：统一为 5.0（从 gate.ts 导入）

**6. 修复 regex 字符类 bug**

- 文件：src/cognitive/feedback/collector.ts:156
- 当前：`/[为什么|如何|怎样|what if|why|how come|深层|本质]/` 是字符类 `[...]`，匹配单个字符
- 修复：改为 `/(为什么|如何|怎样|what if|why|how come|深层|本质)/`

### Phase 1 — Web Search 重设计（让搜索结果成为洞察的种子）

用户明确说："不是要禁用 web search，而是想办法让 web search 更有用...能在网上学到最新的知识来洞察"

web-search-expert 给出了完整 4 步方案，按依赖顺序执行：

**B. Source 跟踪（先做，向后兼容）**

- 在 InsightCandidate 类型添加 `citedSourceIndices: number[]` 和 `webGroundedness: number`
- 在 parseLLMInsights 中解析 LLM 输出的 `sourceIndices` 字段
- 用 `resolveCitedSources` 替换 `enrichWithWebSources` — 只附加 LLM 实际引用的 source
- 添加 n-gram 交叉验证（Jaccard < 0.15 标记为 weakMatch 但不自动移除）

**A. Prompt 重写（核心改动）**

- 在 buildSurpriseInsightPrompt 和 buildInsightPrompt 中：
  - web findings 从 "EXTERNAL_FACTS (supporting evidence)" 变为 "RECENT WEB FINDINGS (PRIMARY material)" 放在 prompt 最前面
  - 每个 finding 带索引 `[0]`、标题、URL、snippet
  - 删除 "do NOT say 'saw', 'read', 'reportedly'" 禁令 — 允许自然引用来源
  - 添加 PERSONALIZATION TEST（必须引用用户画像中的具体事实）
  - JSON 输出添加 `sourceIndices` 和 `webGroundedness` 字段
  - TASK 从 "share something surprising" 改为 "pick ONE finding, connect it to THIS user"

**D. 验证升级**

- buildVerificationPrompt 从检查 "sources present" 改为检查 "sources relevant"
- 新增维度：sourceGroundingScore、personalizationScore、sourceRelevanceScore、isNewsSummary
- 如果 isNewsSummary=true → 直接拒绝（防止"搜索→摘要"退化）

**C. 搜索查询优化**

- buildSearchQuery 从单一 `{domain} 最新进展 2026` 改为多角度：
  - 事件驱动：`{core term} 新进展 OR 突破 OR 发布`
  - 对比：`{core term} vs {alternative} benchmark`
  - 案例：`{core term} 实战 案例 production`
- inferSearchStrategy 要求 personaAnchor（用户画像中的具体名词）+ 两个候选 query
- 如果 provider 支持，添加 recencyDays: 90 时间过滤

### Phase 2 — 反馈循环 + 质量修复

**反馈循环（架构修复，不是简单接线）**

- 关键发现：`processInsightFeedback` 在 collector.ts 存在但生产中从不调用
- 需要做的：
  1. 在 agent run 中检测用户是否回复了洞察消息（关联洞察 session ID）
  2. 如果回复 → 调用 processInsightFeedback（更新 topicBandits、trust、calibrationHistory）
  3. 如果无回复 → 调用 processNoResponse（更新 consecutiveNoResponses、modeBandits）
  4. adaptFrequency() 需要 FeedbackEvent 才能调频 — 接通后自动生效

**其他质量修复**

- refine 循环修复：scheduler:65 `MAX_QUALITY_RETRIES - 1` 改为 `MAX_QUALITY_RETRIES`（从 1 次变为 2 次）
- Pattern 权重：mode-selection.ts:6-10 从 0.5/0.4/0.1 改为 0.6/0.3/0.1
- PersonaChangeSource：server.impl.ts:1493 把 `[]` 改为实际 newDomains 数组

### Phase 3 — 洞察系统重设计（核心架构变更）

这是最重要也最大的改动 — 让洞察从"系统推送"变成"Agent 忍不住想跟你说"。

#### 3.1 消息类型轮盘

不再每次都生成"洞察"。Agent 主动发消息时随机选择消息类型：

| 类型 | 比例 | 描述                               | 质量门槛            |
| ---- | ---- | ---------------------------------- | ------------------- |
| 连接 | 30%  | "刚看到这个，和你上次说的XX有关系" | 2 道（新颖+个性化） |
| 发现 | 25%  | web search 驱动的最新进展          | 完整 pipeline       |
| 观察 | 20%  | 行为模式观察                       | self-refine         |
| 碎片 | 15%  | 一句话，很轻                       | 仅去重              |
| 问题 | 10%  | 真诚地问用户一个问题               | 仅频率控制          |

实现：

- 在 proactive-scheduler.ts 的 resolve() 中添加 messageType 选择
- 每种类型有自己的 prompt 模板（短得多、简单得多）
- 质量门控按类型缩放（碎片只查去重，发现走完整 pipeline）
- Thompson Sampling 学习用户偏好哪种类型（message-type bandit）

#### 3.2 SOUL.md 成为声音种子

当前状态：

- 16 种 MBTI 预设在 src/cli/soul-presets/{type}.md
- 每个预设包含：Core Personality、Behavioral Guidelines、Dialogue Style、Iron Rules
- 正常对话中通过 system-prompt.ts 注入："If SOUL.md is present, embody its persona and tone"
- 洞察生成中只通过 buildVoiceSection 读 formality/verbosity — **SOUL.md 内容完全没有进入洞察 prompt**

需要做的：

- 在洞察生成时读取当前 agent 的 SOUL.md（从 ~/.kaijibot/agents/{agentId}/SOUL.md 或 config 中的 soul preset）
- 把 SOUL.md 全文放在 prompt 的第一段（不是最后一个 voice 参数）
- LLM 从一开始就在 agent 的灵魂里说话
- MBTI 预设影响消息类型权重（INTP → 更多观察/发现，ENFP → 更多连接/碎片）

实现路径：

```typescript
// 新函数：读取当前 soul
function loadCurrentSoul(agentId: string): string | null {
  // 1. 尝试读 ~/.kaijibot/agents/{agentId}/SOUL.md
  // 2. 如果不存在，检查 config 中是否有 soul preset
  // 3. 如果有 preset，用 loadSoulPresetContent(preset) 加载
  // 4. 返回 SOUL.md 全文（或 null）
}

// 修改所有 prompt builders：
// 旧: `${buildVoiceSection(persona)}\n${fewShotBlock}...`
// 新: `${soulContent ?? ""}\n${buildVoiceSection(persona)}\n${fewShotBlock}...`
```

#### 3.3 多样性从架构来，不是从 banned patterns 来

当前系统试图通过 banned patterns + contrastive instruction 强制多样性。这永远追不完 — 禁了"不是X而是Y"，LLM 找下一个公式。

真正的多样性来源：

1. 消息类型不同（碎片 vs 发现 vs 问题 — 结构自然不同）
2. SOUL.md 的人格决定说话方式（16 种 MBTI 各自的 Dialogue Style）
3. few-shot 按消息类型拆分（每种类型有自己的简短示例）
4. 质量门槛差异化（碎片不需要"有洞察力"，只需要不重复）

#### 3.4 不做的

- ❌ 不改 PRISM gate 数学模型（审计确认是对的）
- ❌ 不调 minIntervalHours（错误的旋钮，PRISM gate 自己控制频率）
- ❌ 不重写 few-shot examples（审计确认是最强的部分，改指令不改示例）
- ❌ 不加 phaseFactor（推测性的，可能帮倒忙）
- ❌ 不删除 web search（用户明确要它工作）

---

## 关键文件

- src/cognitive/insight/llm-engine.ts (2340 LOC) — 核心引擎，prompt 模板，质量控制
- src/cognitive/scheduler/proactive-scheduler.ts (1173 LOC) — SIRI 循环，事件处理
- src/cognitive/scheduler/gate.ts (405 LOC) — PRISM 门控
- src/cognitive/feedback/preference-learner.ts (284 LOC) — Thompson Sampling
- src/cognitive/feedback/collector.ts (374 LOC) — 反馈收集
- src/cognitive/persona/curator.ts — Persona 管理，兴趣生命周期
- src/cognitive/insight/interest-inference.ts — 搜索策略推断
- src/agents/soul-preset.ts — MBTI 预设加载
- src/cli/soul-presets/{type}.md — 16 种 MBTI 人格预设
- src/config/zod-schema.cognitive.ts — 认知系统配置 schema

## 验证方式

修改 src/cognitive/insight/ 后必须跑 live 测试：

```bash
KAIJIBOT_LIVE_TEST=1 ZAI_API_KEY=$ZAI_API_KEY TAVILY_API_KEY=$TAVILY_API_KEY \
  pnpm test src/cognitive/insight/insight-live-quality.test.ts

# Pipeline eval (5 轮双管线):
KAIJIBOT_LIVE_TEST=1 ZAI_API_KEY=$ZAI_API_KEY TAVILY_API_KEY=$TAVILY_API_KEY \
  pnpm test src/cognitive/insight/insight-pipeline-live-eval.test.ts
```

## 约束

- TypeScript strict，不用 as any / @ts-ignore
- Oxlint + Oxfmt 格式化
- `pnpm check` 必须通过（tsgo + oxlint + boundary）
- `pnpm test` 必须 exit 0
- 改完跑 `pnpm gw:deploy` 部署 gateway
- commit 用 `scripts/committer "<msg>" <files>` 或 FAST_COMMIT=1
- 推送用 `git push origin main`（Gitee）+ `git push github main`（GitHub SSH）
- npm publish 发布新版本
