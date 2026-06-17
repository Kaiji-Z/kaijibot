# 纠错自进化 — Method C 调研分析报告

> 日期: 2026-05-03
> 状态: 调研完成，待用户确认方案后实施

## 1. 用户原始需求

> "我想让我们的项目可以主动发现自己的错误，不论是自己发现错误自己纠正了，还是用户发现错误帮agent纠正了。我的想法是把正确的调用记录为skill"

用户倾向 Method C（批量延迟分析）而非实时检测方案（Layer 1 代码检测 + Layer 2 LLM 判断）。

用户偏好：

- 充分利用 LLM 进行判断，而非硬编码正则
- 把正确的调用记录为 skill，以此作为进化的方式

## 2. Method C 定义

**对话历史分析（批量，延迟执行）**

- 不走实时触发，而是在 session memory 生成时做纠错分析
- 在 `session-memory/handler.ts` 中加纠错分析步骤
- LLM 分析完整对话，提取纠错模式
- 生成 correction skill

优点：

- 不增加 turn-by-turn 延迟
- 有完整对话上下文，判断更准确
- 可以复用 session memory 的 LLM 调用

缺点：

- 不是实时的，要等对话结束/压缩时才分析
- 错过纠错后的第一时间学习机会

## 3. 调研发现

### 3.1 Session .jsonl 文件格式

Session .jsonl 包含完整的工具错误数据，每行一个 JSON 对象。

**Assistant 工具调用：**

```json
{
  "type": "message",
  "id": "a1b2c3d4",
  "parentId": "prev1234",
  "timestamp": "2026-05-03T14:00:02.000Z",
  "message": {
    "role": "assistant",
    "content": [
      {
        "type": "toolCall", // 或 "toolUse" / "functionCall"
        "id": "call_abc123",
        "name": "read",
        "arguments": { "path": "/wrong.ts" }
      }
    ],
    "stopReason": "toolUse",
    "timestamp": 1746273602000
  }
}
```

**工具错误结果：**

```json
{
  "type": "message",
  "message": {
    "role": "toolResult",
    "toolCallId": "call_abc123",
    "toolName": "read",
    "content": [{ "type": "text", "text": "Error: ENOENT: no such file" }],
    "isError": true,
    "timestamp": 1746273603000
  }
}
```

**工具成功结果：**

```json
{
  "type": "message",
  "message": {
    "role": "toolResult",
    "toolCallId": "call_def456",
    "toolName": "read",
    "content": [{ "type": "text", "text": "file contents..." }],
    "isError": false,
    "timestamp": 1746273604000
  }
}
```

**关键字段表：**

| 字段                  | 位置                                   | 用途                                 |
| --------------------- | -------------------------------------- | ------------------------------------ |
| `toolCallId`          | toolResult 和 toolCall block 的 `id`   | 关联工具调用与结果                   |
| `toolName`            | toolResult 和 toolCall block 的 `name` | 识别哪个工具                         |
| `isError`             | toolResult 上的布尔值                  | **错误标记** — `true` 表示工具抛错   |
| `content[].text`      | toolResult                             | 错误消息或成功结果文本               |
| `details.status`      | toolResult                             | 额外错误信号: `"error"`, `"timeout"` |
| `arguments` / `input` | toolCall block                         | **工具参数**（Agent 传了什么）       |

**结论：可以从 .jsonl 检测 "工具 X 失败后用不同参数成功" 的模式。**

### 3.2 Compaction 会摧毁工具错误数据

Compaction 有一个**三级销毁链**：

| 阶段     | 操作                                   | 影响                                                     |
| -------- | -------------------------------------- | -------------------------------------------------------- |
| 预处理   | `erroredAssistantResultPolicy: "drop"` | 删除 stopReason=error 的 assistant 消息及其 tool results |
| LLM 摘要 | `stripToolResultDetails()`             | 删除 toolResult 的 `details` 字段                        |
| 文件截断 | `truncateAfterCompaction`（可选）      | 从 .jsonl 中**物理删除**已摘要的消息                     |

关键代码位置：

- `src/agents/pi-embedded-runner/compact.ts:946-956` — 预处理
- `src/agents/compaction.ts:312` — stripToolResultDetails
- `src/agents/pi-embedded-runner/session-truncation.ts` — 文件截断

**`compaction:after` hook payload 只有聚合指标**（messageCount, tokenCount, compactedCount），没有工具错误数据、没有摘要文本、没有删除了什么的信息。

**结论：`compaction:after` 不可用于 Method C。**

### 3.3 现有 transcript.ts 只提取文本

`src/hooks/bundled/session-memory/transcript.ts` 的 `getRecentSessionContent()` 只提取 `user`/`assistant` 的文本消息：

```typescript
// line 43-48
if ((role === "user" || role === "assistant") && "content" in msg && msg.content) {
  const text = extractTextMessageContent(msg.content); // 只看 type: "text"
  if (text && !text.startsWith("/")) {
    allMessages.push(`${role}: ${text}`);
  }
}
```

工具调用、工具结果、错误标记**全部被过滤掉**。这是 Method C 的核心缺口。

### 3.4 `command:new` / `command:reset` 是最佳触发时机

这两个事件发生时：

- 旧 session 文件**完整保存**，所有工具错误数据都在
- handler 已经拿到了 `sessionFile` 路径
- 可以直接解析 .jsonl 提取纠错模式

即使之前发生了 compaction，只要 `truncateAfterCompaction` 为 false（**默认值**），旧的原始条目仍在 .jsonl 文件中，Method C 仍然可以提取。

### 3.5 技能可以完全程序化创建（不需要经过 Agent）

```typescript
// 现有的程序化路径 — 无需 Agent 参与
import { generateSkillDraftLLM } from "./cognitive/evolution/llm-draft-generator.js";
import { createStandaloneGenerateText } from "./cognitive/evolution/standalone-generate.js";
import { SkillPersistenceWriter } from "./cognitive/evolution/skill-writer.js";
import { SkillLifecycleManager } from "./cognitive/evolution/skill-lifecycle.js";

const generateText = await createStandaloneGenerateText(config);
const draft = await generateSkillDraftLLM(candidate, { generateText });
const writer = new SkillPersistenceWriter(configDir);
const lifecycle = new SkillLifecycleManager(writer);
const { shouldCreate } = await lifecycle.checkDuplicate(draft.name, draft.description);
if (shouldCreate) {
  await writer.writeSkill(draft);
}
```

关键组件：

- `SkillPersistenceWriter` — 写技能到 `~/.kaijibot/skills/{name}/SKILL.md`
- `SkillLifecycleManager` — 去重（Levenshtein+Jaccard）、30天过期清理
- `generateSkillDraftLLM` — LLM 生成丰富技能草稿
- `generateSkillDraft` — 确定性回退（无 LLM）
- `EvolutionStore` — 记录进化历史到 `~/.kaijibot/cognitive/evolution/{userId}.json`

### 3.6 `consumeToolErrorProfile` 是 single-consume

`src/agents/tool-error-summary.ts` 中的 `consumeToolErrorProfile()` 在 `hard-trigger.ts` 中被消费。在 session-memory handler 中不可用。需要直接从 .jsonl 文件提取错误信息。

### 3.7 Compaction 对记忆文件的影响

两种场景（直接 /new vs 先 compaction 再 /new）对记忆文件**几乎没有区别**，因为：

- `getRecentSessionContent()` 读取所有 `type: "message"` 条目（包括 compaction 前的旧条目）
- 它只提取文本，不看 compaction 标记
- 默认不截断 → 旧条目仍在文件中

区别仅在 `truncateAfterCompaction: true` 时：旧条目被删 → 文本摘要可能更短。

## 4. 修正后的 Method C 设计

### 4.1 触发时机

**只用 `command:new` / `command:reset`**，不用 `compaction:after`。

### 4.2 数据流

```
/new 或 /reset 触发
  → session-memory handler 拿到 sessionFile
  → 【现有】generateStructuredSummary() → 写 daily memory + topic routing
  → 【新增】detectCorrectionsFromSession(sessionFile)
       ├─ 解析 .jsonl，按 toolCallId 关联 assistant→toolResult
       ├─ 查找同 toolName 的 isError:true → isError:false 序列
       └─ 提取 { toolName, failedArgs, correctArgs, errorMessage, context }
  → 如果有纠错模式：
       → evaluateCorrectionWithLLM(patterns, transcript, config)
            ├─ LLM 看完整对话上下文 + 纠错数据
            ├─ 判断哪些纠错值得记录为 skill
            └─ 为值得记录的纠错生成 SkillDraft（含 Anti-patterns 段落）
       → SkillLifecycleManager.checkDuplicate()
       → SkillPersistenceWriter.writeSkill()
       → EvolutionStore.save() 记录进化历史
```

### 4.3 关键设计决策

| 决策       | 选择                                 | 理由                              |
| ---------- | ------------------------------------ | --------------------------------- |
| 触发时机   | 仅 `/new` `/reset`                   | compaction 会销毁数据             |
| 检测方式   | 代码解析 .jsonl                      | 基于 `isError` 布尔值，可靠非正则 |
| 判断方式   | LLM                                  | 用户偏好，灵活，有完整上下文      |
| 技能创建   | 程序化                               | 不需要 Agent turn/heartbeat       |
| Skill 格式 | body 中加 Anti-patterns 段落         | 不改 frontmatter                  |
| 去重       | 复用 SkillLifecycleManager           | Levenshtein+Jaccard 已有          |
| 过期       | 复用现有 30 天过期 + usageCount 追踪 | 一致性                            |

### 4.4 需要新建的文件

1. **`src/cognitive/evolution/correction-detector.ts`**
   - `detectCorrectionsFromSession(sessionFilePath: string)` → `CorrectionPattern[]`
   - 解析 .jsonl，关联 assistant toolCall → toolResult
   - 查找同 toolName 的 error→success 序列
   - 提取结构化纠错数据

2. **`src/cognitive/evolution/correction-skill-generator.ts`**
   - `evaluateCorrectionWithLLM(patterns, transcript, config)` → `SkillDraft | null`
   - LLM 判断纠错是否值得保存
   - 生成含 Anti-patterns 段落的技能草稿

3. **测试文件**
   - `src/cognitive/evolution/correction-detector.test.ts`
   - `src/cognitive/evolution/correction-skill-generator.test.ts`

### 4.5 需要修改的文件

1. **`src/hooks/bundled/session-memory/handler.ts`**
   - 在 summary 生成后、写 daily memory 之后
   - 调用 correction-detector → correction-skill-generator
   - 仅在 `command:new` / `command:reset` 时触发（跳过 compaction:after）

2. **`src/cognitive/evolution/types.ts`**
   - 可能需要 `CorrectionPattern` 类型（或放在 correction-detector.ts 内）

### 4.6 可复用的现有基础设施

| 组件                            | 文件                     | 用途                           |
| ------------------------------- | ------------------------ | ------------------------------ |
| `SkillPersistenceWriter`        | `skill-writer.ts`        | 写 SKILL.md 到磁盘             |
| `SkillLifecycleManager`         | `skill-lifecycle.ts`     | 去重检查                       |
| `generateSkillDraftLLM`         | `llm-draft-generator.ts` | LLM 生成技能草稿               |
| `createStandaloneGenerateText`  | `standalone-generate.ts` | 创建独立 LLM 调用              |
| `EvolutionStore`                | `store.ts`               | 记录进化历史                   |
| `extractToolCallsFromAssistant` | `tool-call-id.ts`        | 从 assistant 消息提取 toolCall |
| `extractToolResultId`           | `tool-call-id.ts`        | 从 toolResult 提取 ID          |

### 4.7 CorrectionPattern 数据结构（草案）

```typescript
type CorrectionPattern = {
  toolName: string;
  failedCallId: string;
  successfulCallId: string;
  failedArgs: Record<string, unknown>;
  correctArgs: Record<string, unknown>;
  errorMessage: string;
  /** 纠错前后的 assistant 文本（给 LLM 提供上下文） */
  contextBefore: string;
  contextAfter: string;
  /** 是否是用户纠正（user 消息中有指导性内容） */
  userCorrected: boolean;
};
```

### 4.8 Skill Draft 中的 Anti-patterns 段落（草案）

```markdown
## Anti-patterns

### ❌ 不要这样做

- 使用 `read` 时传入绝对路径（会触发 ENOENT）

### ✅ 正确做法

- 使用相对于 workspace 的路径
- 先用 `glob` 确认文件存在再读取
```

## 5. 与现有进化系统的关系

Method C 的纠错自进化和现有的复杂度触发自进化（3+ 工具调用）是**互补关系**：

| 维度       | 现有进化（hard-trigger）     | 纠错进化（Method C）      |
| ---------- | ---------------------------- | ------------------------- |
| 触发条件   | 3+ 工具调用                  | 工具 error→success 模式   |
| 触发时机   | 实时（turn 结束后）          | 延迟（session 结束时）    |
| 判断者     | Agent（通过 heartbeat turn） | LLM（独立调用，无 Agent） |
| Skill 内容 | 工作流自动化                 | 纠错 + 正确用法           |
| 通知用户   | Agent 决定是否通知           | 可静默创建，后续自然提及  |

## 6. 风险和注意事项

1. **`truncateAfterCompaction: true` 会导致数据丢失** — 需要在文档或代码中提醒
2. **单次 LLM 调用成本** — 每次会话结束额外一次 LLM 调用，约 80-200 token
3. **短会话没有纠错** — 大多数会话没有错误→修正模式，检测函数应快速返回空数组
4. **用户纠错检测** — 需要判断 user 消息中是否包含纠正性指导（"不对"、"应该用 X"、"换个方式"等）
5. **不需要创建的会话** — 如果 `detectCorrectionsFromSession` 返回空数组，不应有任何 LLM 调用

## 7. 关键代码位置索引

### Session .jsonl 相关

- `node_modules/@mariozechner/pi-coding-agent/dist/core/session-manager.js:576` — appendMessage
- `node_modules/@mariozechner/pi-agent-core/dist/agent-loop.js:383` — emitToolCallOutcome
- `src/agents/session-tool-result-guard.ts` — 消息写入拦截
- `src/agents/tool-call-id.ts` — toolCall ID 提取
- `src/hooks/bundled/session-memory/transcript.ts` — 现有文本提取（只读文本）

### Compaction 相关

- `src/agents/pi-embedded-runner/compact.ts` — compaction 编排
- `src/agents/compaction.ts` — 核心摘要逻辑
- `src/agents/session-transcript-repair.ts` — stripToolResultDetails, repairToolUseResultPairing
- `src/agents/pi-embedded-runner/session-truncation.ts` — 文件截断
- `src/agents/pi-embedded-runner/compaction-hooks.ts` — hook dispatch

### 进化系统相关

- `src/cognitive/evolution/engine.ts` — EvolutionEngine
- `src/cognitive/evolution/skill-writer.ts` — SkillPersistenceWriter
- `src/cognitive/evolution/skill-lifecycle.ts` — SkillLifecycleManager（去重+过期）
- `src/cognitive/evolution/llm-draft-generator.ts` — LLM 技能草稿生成
- `src/cognitive/evolution/skill-draft-generator.ts` — 确定性草稿生成
- `src/cognitive/evolution/standalone-generate.ts` — 独立 LLM 调用
- `src/cognitive/evolution/store.ts` — EvolutionStore
- `src/cognitive/evolution/types.ts` — 类型定义（EvolutionCandidate, SkillDraft 等）
- `src/cognitive/evolution/hard-trigger.ts` — 现有 3+ 工具触发器
- `src/agents/tools/evolution-suggest-tool.ts` — evaluate_skill_evolution Agent 工具

### Session Memory 相关

- `src/hooks/bundled/session-memory/handler.ts` — hook handler（集成点）
- `src/hooks/bundled/session-memory/summary.ts` — generateStructuredSummary
- `src/hooks/bundled/session-memory/transcript.ts` — getRecentSessionContent

### 工具错误追踪

- `src/agents/tool-error-summary.ts` — 错误累加器（single-consume）
- `src/agents/pi-embedded-subscribe.handlers.tools.ts:769-801` — lastToolError 设置/清除
- `src/cognitive/evolution/complexity-evaluator.ts` — detectTrialAndError（现有正则检测）
