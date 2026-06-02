---
name: memory-organize
description: "整理记忆：历遍所有会话记录，提取并整理记忆到结构化的主题文件中。当用户说'整理记忆'、'整理一下记忆'、'记忆太乱了'、'重新组织记忆'时使用。也用于系统触发时自动整理 MEMORY.md。"
metadata: { "kaijibot": { "emoji": "🗃️", "requires": { "bins": [] }, "install": [] } }
---

# Memory Organize

历遍所有会话记录，提取关键记忆，按主题整理到结构化的主题文件中。同时作为 MEMORY.md 的通用垃圾回收器，修复任何结构问题。

## 三层记忆架构

记忆系统由三层自动/手动维护：

| 层级 | 触发方式 | 做什么 | 涉及的 LLM 调用 |
|------|---------|--------|----------------|
| **Layer 1: 生成+存储** | 会话结束（`/new` `/reset`） | LLM 结构化摘要 → 路由到已有 topic（优先）或创建新 topic → 写摘要（非原始对话）→ 更新 registry.json → 更新 MEMORY.md topic pointer | 1 次（摘要生成，含 topic 路由） |
| **Layer 2: 自动整合** | 每日凌晨 3 点（consolidation cron） | 扫描会话 → LLM 提取结构化知识 → Jaccard 去重 → 路由到认知存储 → 写 MEMORY.md inline sections → rebalance 8KB 预算 | 批量（按用户分组） |
| **Layer 3: 手动整理** | 用户说"整理记忆"时（本 skill） | MEMORY.md 垃圾回收 → 深度扫描全量会话 → `memory_tidy`（LLM 全权驱动：自动决定去重/合并/重命名/归档/inline 清理）→ 维护 registry.json | 深度扫描 + LLM 驱动的全量整理 |

**本 skill 覆盖 Layer 3**。Layer 1 和 Layer 2 是自动运行的，不需要手动触发。

## When to use (trigger phrases)

Use this skill immediately when the user asks any of:

- "整理记忆" / "整理一下记忆"
- "记忆太乱了" / "重新整理记忆"
- "把旧记忆整理一下"
- "organize memories" / "tidy up memories"
- "memory is messy"
- 系统触发："记忆整合完成"（自动运行）

## 记忆数据源

记忆来自以下层级，按优先级读取。所有路径均为 workspace 根目录下的相对路径（由系统自动解析）：

| 优先级 | 数据源       | 路径/获取方式                               | 格式     | 说明                                                            |
| ------ | ------------ | ------------------------------------------- | -------- | --------------------------------------------------------------- |
| ⭐ 1   | MEMORY.md    | `MEMORY.md`                                 | Markdown | **先修复结构**，处理晋升条目、重复、预算超支                    |
| 2      | 会话原始文件 | `sessions_list` 工具 → `transcriptPath`     | JSONL    | 始终存在，最完整，包含所有 User/Assistant 对话                  |
| 3      | QMD 会话     | 由 `memory.qmd.sessions.exportDir` 配置决定 | Markdown | 可选，比 JSONL 更可读（需 `memory.qmd.sessions.enabled: true`） |
| 4      | 每日笔记     | `memory/YYYY-MM-DD.md`                      | Markdown | 自动生成的结构化摘要（含会话文件指针，不含原始对话）            |
| 5      | 会话语料     | `memory/.dreams/session-corpus/*.txt`       | Text     | 与上述有重叠，仅补充用                                          |
| 6      | 已有主题     | `memory/topics/*.md`                        | Markdown | 已分类的记忆条目（用于去重判断）                                |

**会话原始文件读取方式**（JSONL）：

使用 `read_file` 工具读取 `transcriptPath` 指向的 JSONL 文件后，**必须按以下规则过滤**，只保留有价值的对话内容：

1. **只处理 `"type": "message"` 的行**，忽略其他类型（session、model_change 等）
2. **只保留 `message.role` 为 `"user"` 或 `"assistant"` 的消息**，忽略 toolResult、system 等
3. **提取文本**：从 `message.content` 提取。content 可能是字符串或数组（数组中取 `type: "text"` 的条目的 `text` 字段）
4. **跳过用户消息中的元数据**：以 `ou_` 开头的前缀（如 `ou_xxx:`）和 `Conversation info` 块都是系统注入的元数据，不是用户真实输入
5. **跳过斜杠命令**：以 `/` 开头的用户消息（如 `/new`、`/reset`）不需要提取
6. **工具调用保留名称**：如果 assistant 消息包含工具调用（`type: "toolCall"`），记下工具名称（如 `[tool: web_search, read_file]`）作为上下文信号，但不保留工具的参数和返回值
7. **忽略 thinking 块**：`type: "thinking"` 的内容不需要提取

**过滤后的示例**（你实际要处理的内容）：

```
user: 帮我查一下天气
assistant: 今天北京晴天，25°C
user: 分析一下这个项目的架构
assistant: [tool: read_file, glob] 这个项目的架构是...
```

**为什么必须过滤**：原始 JSONL 中 97.5% 是系统元数据（会话信息、工具调用细节、thinking 块等）。不过滤会浪费大量上下文窗口，导致能处理的会话数量大幅减少。

**跳过的文件**（系统元数据，不是真实对话）：

- `sessions.json` — 会话注册表
- `session-ranking.*` / `session-bootstrap.*` — 系统元数据
- `*.deleted.*` — 已删除的文件

**注意**：`.reset.` 和 `.deleted.` 归档会话文件**含有真实对话历史**。当使用 `sessions_list` 工具并设置 `includeArchived: true` 时，这些归档会话会被返回并参与深度扫描。

## 主题分类体系

记忆按**主题（subject）**分类。每条记忆属于一个主题，存入对应的主题文件（`memory/topics/<topic>.md`）。

### 主题由 LLM 自行判断

不使用预设的主题列表或关键词映射。读取每条记忆内容后，根据内容的**语义**判断它属于哪个主题。

系统维护一个 `memory/topics/registry.json` 主题注册表，记录每个主题的名称、描述、条目数和最后更新时间。每次会话结束后自动更新。

**判断原则：**

1. **按内容领域归类**——同一领域的记忆放同一个文件，方便查找。例如所有飞书相关的（配置、wiki 方法、bot 管理）都归 `feishu`
2. **主题粒度适中**——不要太粗（所有东西都放 `misc`），也不要太细（每条记忆一个主题）。目标是每个主题文件 5-20 条记忆
3. **主题名用 kebab-case 英文**——如 `feishu`、`philosophy`、`product`、`football`、`cooking`
4. **已有主题优先**——系统会在会话结束时自动查看 `memory/topics/registry.json` 中的已有主题列表和描述，LLM 优先路由到匹配的已有主题。新主题只在内容确实不属于任何已有主题时才创建
5. **遇到全新领域时创建新主题**——用户开始聊一个完全没见过的话题时，开新文件
6. **主题自动整合**——`memory_tidy` 使用 LLM 全权驱动，自动判断合并/重命名/去重/归档/inline 清理（详见 Step 3）

### 主题命名规范

主题名直接影响记忆检索质量和可读性。遵循以下规则：

1. **使用描述性 kebab-case**：名称应直接反映内容领域。好的例子：`rust-learning`、`career-planning`、`feishu-wiki`、`home-automation`、`ai-agent-arch`
2. **避免模糊名称**：以下名称禁止使用：`general-discussion`、`misc`、`other`、`various`、`untitled`。如果发现已有主题使用了这些名称，在整理时重命名为能反映实际内容的名称
3. **名称要反映实际内容**：如果一个主题叫 `tools` 但里面全是关于飞书 API 的内容，应重命名为 `feishu-api`
4. **长度限制**：最长 30 个字符，超出时缩写（如 `distributed-system-design` → `dist-sys-design`）
5. **自动格式化**：非 kebab-case 的名称会被自动转换为 kebab-case（空格→连字符，大写→小写，特殊字符移除）
6. **整理时重命名**：在 Step 3 `memory_tidy` 之后，检查所有主题名称是否准确反映其内容。如果发现名称与内容不匹配，记录在最终汇报中并建议重命名

## How it works

**必须严格按顺序完成所有 4 个步骤。不要跳过任何步骤。** 每个步骤完成后有明确的检查点，必须输出检查点内容后才能继续下一步。

整理分四步：

### Step 1: MEMORY.md 垃圾回收（必做）

MEMORY.md 是长期记忆的入口，**8KB 预算**。任何不符合结构的内容都需要修复。

**读取 MEMORY.md**：完整读取 workspace 下的 `MEMORY.md` 文件。

**如果 MEMORY.md 不存在或只有标题**：跳过此步骤。

**LLM 分析全篇内容**，识别以下问题并逐一修复：

1. **未归档的 Promoted 条目**：`## Promoted From Short-Term Memory (YYYY-MM-DD)` 下的条目（格式为 `<!-- kaijibot-memory-promotion:key -->` + `- snippet [score=...]`）应该被提取到主题文件中。逐条判断 subject，调用 `memory_save` 写入对应主题文件。

2. **重复内容**：同一信息出现多次（不同格式、不同 section）。保留最完整的版本，删除重复。inline 与 topic 之间的交叉重复由 Step 3 的 `memory_tidy` 自动处理。

3. **结构错误**：缺少应有的 section heading；格式不对的条目；不完整的 HTML 注释标记。

4. **预算超支**：MEMORY.md 超过 8KB 时，把低频内容移到主题文件。MEMORY.md 只保留：
   - 高频内联内容（2 类：⚡ Core Memory、🔥 Active Context）
   - 主题文件指针（`- topic-name → memory/topics/topic-name.md`）

5. **孤立内容**：不在任何主题文件中、也不属于内联区域的零散内容。判断 subject 后归入主题文件。

**修复操作**：

- 对每条需要归档的记忆，调用 `memory_save(content=..., topic=..., importance=...)`
- 不要直接编辑 MEMORY.md 文件——通过 `memory_save` 和 `memory_tidy` 工具操作
- Promoted 条目归档后，该 section 可以被清理（条目已进入 topic 文件）

**MEMORY.md 目标结构**（8KB 以内）：

```
# Long-Term Memory

## ⚡ Core Memory
- [important assertions: user preferences, knowledge, behavioral patterns, key facts]

## 🔥 Active Context
- [time-sensitive work items: current goals, active projects, recent focus areas]

## Topic Pointers
- feishu → memory/topics/feishu.md
- philosophy → memory/topics/philosophy.md
- product → memory/topics/product.md

## Promoted From Short-Term Memory (YYYY-MM-DD)
<!-- kaijibot-memory-promotion:key -->
- snippet [score=0.XXX recalls=N avg=0.XXX source=...]
（这些条目在下次整理时会被归档到主题文件并从此 section 移除）
```

**inline sections 自动填充**：session-memory hook 在每次会话结束时自动将高优先级内容路由到对应的 inline section（基于 LLM 返回的 `memoryType` 字段：用户偏好/知识/行为 → ⚡ Core Memory，当前目标/项目/工作 → 🔥 Active Context）。hook 同时调用 `rebalanceIndex()` 确保 MEMORY.md 不超过 8KB 预算。手动 `memory_save` 也会写入 inline sections。两个来源的内容会合并。

**没有 `## Recent Sessions`**：该 section 已移除——会话信息已存在于 daily 文件和 topic 文件中，属于冗余数据。

**进入 Step 2。** 如果 MEMORY.md 不存在（跳过了 Step 1），直接开始深度扫描。

### Step 2: 深度扫描（必做，历遍所有会话记录）

逐个读取所有会话数据，提取关键信息。

**读取顺序：**

1. 调用 `sessions_list` 工具（参数：`includeArchived: true`）获取所有会话列表（含 `transcriptPath` 字段，含归档的 `.reset.` 会话）。逐个读取 `transcriptPath` 指向的 JSONL 文件，解析出 User/Assistant 对话内容。按文件修改时间从新到旧处理（最近的对话优先）
2. 如果 QMD sessions 已启用（`memory.qmd.sessions.enabled: true`），读取 QMD 导出目录下的 `*.md` 文件作为补充（Markdown 格式更可读，按文件大小从大到小）
3. 读所有每日笔记 `memory/YYYY-MM-DD.md`（按日期从旧到新，补充上述未覆盖的摘要）
4. 按需读会话语料 `memory/.dreams/session-corpus/*.txt`（仅当上述来源仍有信息缺口时）

**提取后立即写入**，每条记忆调用 `memory_save`：

- `content`: 记忆内容（简洁的一句话或一段描述）
- `topic`: 主题名（必填，kebab-case，如 `feishu`、`philosophy`）
- `importance`: 重要性（`high`/`normal`/`low`）
- `type`: 分类（可选，决定是否写入 MEMORY.md inline section：`core` → ⚡ Core Memory，`active` → 🔥 Active Context。省略则只写 topic 文件不写 inline）

示例调用：

```
memory_save(content="飞书 is_cross_tenant 在 search API 的 result_meta 里", topic="feishu", importance="high")
memory_save(content="不要乱猜测，不确定时先调查", topic="feedback", importance="high", type="core")
memory_save(content="好的产品不是能赚多少钱而是能得到用户的认可", topic="product", importance="normal")
memory_save(content="关注宝玉 from xp.ai 的观点，关注 LLM 上下文管理", topic="ai-tools")
memory_save(content="用户喜欢简洁的回复风格", topic="user-preferences", importance="high", type="core")
```

**跳过的内容（不要提取）：**

- 纯技术讨论（代码实现细节、调试过程）
- 已在 USER.md / IDENTITY.md / SOUL.md / TOOLS.md 中存在的信息
- 重复或冗余的会话元数据
- 临时性的操作指令（"帮我查一下..."）
- 代码片段、git 信息、文件路径

**Step 2 完成检查点（不可跳过）：**

扫描完成后，**必须**输出以下格式的摘要。未输出此摘要前，**禁止**进入 Step 3：

```
## Step 2 扫描摘要
- 扫描会话：N 个活跃 + A 个归档 = T 个总计
- 跳过：S 个（心跳/系统元数据）
- 提取记忆：K 条（memory_save 调用次数）
- 覆盖主题：X 个
```

**如果扫描了 0 个会话文件**，报告原因（sessions_list 返回空？目录不存在？），然后继续 Step 3。
**如果提取了 0 条记忆**，仍然执行 Step 3（memory_tidy 可能发现去重机会）。

**进入 Step 3。** 确认已输出 Step 2 扫描摘要。`memory_tidy` 会处理所有已有条目的去重。

### Step 3: 整理主题文件（`memory_tidy` 工具）

`memory_tidy` 是 LLM 全权驱动的记忆整理工具。LLM 读取所有主题文件 + MEMORY.md + registry.json 后，自主决定所有操作：

```
调用 memory_tidy 工具（无需任何 action 参数）
```

LLM 会自动执行以下操作（根据实际数据决定哪些需要做）：

- **merge_topics**：合并语义重叠的主题（如 `feishu-api` + `feishu-bot` → `feishu`）
- **rename_topic**：重命名名称与内容不匹配的主题
- **dedup_entries**：合并主题内的重复条目
- **archive_topic**：归档长期未更新的主题（移到 `archive/`）
- **clean_inline**：清理 MEMORY.md inline sections 中的冗余行

所有操作经过代码验证后才执行。操作完成后自动调用 `rebalanceIndex()`（8KB 预算）和 `registry.syncFromDisk()` 维护一致性。

**可选参数**：
- `dryRun: true` — 预览所有操作但不写入文件
- `focus: "topic-name"` — 只分析指定的主题

**LLM 不可用时**：自动退行到 Jaccard 安全操作（去重 + inline 清理 + 归档 + 再平衡），不调用 LLM。

**示例**：`feishu-api`（10 条）和 `feishu-bot`（3 条）→ LLM 判断两者语义重叠 → 自动合并为 `feishu`，维护 registry.json。

### Step 4: 最终检查

使用 **Step 2 扫描摘要** 中的数据完成最终确认：

1. 确认 MEMORY.md 在 8KB 预算内
2. 确认 `## Promoted From Short-Term Memory` section 中的条目已全部归档（如果之前有的话）
3. 确认主题文件指针与实际文件一致
4. 输出最终汇报（**使用 Step 2 的扫描数据**）：
   - 扫描了 N 个会话文件（含 A 个归档）+ M 个每日笔记
   - 提取了 K 条新记忆
   - 归档了 P 条 promoted 条目
   - 覆盖了 S 个主题
   - MEMORY.md 当前 X bytes

## Recommended workflow

当用户说"整理记忆"时：

1. **MEMORY.md 垃圾回收**：完整读取 MEMORY.md，识别并修复所有问题（晋升条目归档、重复删除、结构修复、预算控制）
2. **会话深度扫描（必做）**：调用 `sessions_list`（`includeArchived: true`）获取所有会话（含归档的 `.reset.` 会话），逐个读取 `transcriptPath`（JSONL 格式），解析 User/Assistant 对话，提取关键记忆并调用 `memory_save(content=..., topic=..., importance=..., type=...)` 写入。如果 QMD 已启用，也读取 QMD 的 Markdown 文件作为更可读的补充。读取 `memory/YYYY-MM-DD.md` 每日笔记补充可能遗漏的摘要信息。**扫描完成后必须输出 Step 2 扫描摘要检查点**
3. 调用 `memory_tidy`（LLM 全权驱动：自动决定去重/合并/重命名/归档/inline 清理 + 维护 registry.json）
4. 最终检查 + 汇报（使用 Step 2 扫描摘要的数据）

## Notes

- `memory_tidy(dryRun: true)` 只预览不写入，放心使用
- `memory_tidy` 的 archive 操作把旧文件移到 `memory/topics/archive/`，不会删除
- 已有主题文件中的内容不会被重复添加（`memory_save` 自动 Jaccard 去重，阈值 0.8）
- 可以重复运行，幂等安全
- 会话原始文件（JSONL）始终存在，是最完整的对话记录
- QMD 会话是可选的 Markdown 导出，更可读但需要额外配置
- QMD 会话文件单文件最大 ~80KB，逐个读取即可
- JSONL 会话文件可能较大，但过滤后有效内容通常只有原始大小的 2.5%。优先处理最近的会话，按需回溯更早的记录。如果过滤后内容仍然很长，重点提取关键决策、用户偏好和重要事实，跳过纯技术讨论
- 主题文件按需创建——没有记忆的主题不会有文件，不需要预创建
- MEMORY.md 垃圾回收适用于所有场景：记忆整合、LLM 写入错误、重复内容、结构损坏等
