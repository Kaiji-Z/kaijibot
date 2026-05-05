---
name: memory-organize
description: "整理记忆：历遍所有会话记录，提取并整理记忆到结构化的主题文件中。当用户说'整理记忆'、'整理一下记忆'、'记忆太乱了'、'重新组织记忆'时使用。也用于系统触发时自动整理 MEMORY.md。"
metadata:
  {
    "kaijibot":
      {
        "emoji": "🗃️",
        "requires": { "bins": [] },
        "install": [],
      },
  }
---

# Memory Organize

历遍所有会话记录，提取关键记忆，按主题整理到结构化的主题文件中。同时作为 MEMORY.md 的通用垃圾回收器，修复任何结构问题。

## When to use (trigger phrases)

Use this skill immediately when the user asks any of:

- "整理记忆" / "整理一下记忆"
- "记忆太乱了" / "重新整理记忆"
- "把旧记忆整理一下"
- "organize memories" / "tidy up memories"
- "memory is messy"
- 系统触发："梦境晋升完成"（自动运行）

## 记忆数据源

记忆来自以下层级，按优先级读取。所有路径均为 workspace 根目录下的相对路径（由系统自动解析）：

| 优先级 | 数据源 | 路径/获取方式 | 格式 | 说明 |
|--------|--------|---------------|------|------|
| ⭐ 1 | MEMORY.md | `MEMORY.md` | Markdown | **先修复结构**，处理晋升条目、重复、预算超支 |
| 2 | 会话原始文件 | `sessions_list` 工具 → `transcriptPath` | JSONL | 始终存在，最完整，包含所有 User/Assistant 对话 |
| 3 | QMD 会话 | 由 `memory.qmd.sessions.exportDir` 配置决定 | Markdown | 可选，比 JSONL 更可读（需 `memory.qmd.sessions.enabled: true`） |
| 4 | 每日笔记 | `memory/YYYY-MM-DD.md` | Markdown | 自动生成的结构化摘要（含会话文件指针，不含原始对话） |
| 5 | 会话语料 | `memory/.dreams/session-corpus/*.txt` | Text | 与上述有重叠，仅补充用 |
| 6 | 已有主题 | `memory/topics/*.md` | Markdown | 已分类的记忆条目（用于去重判断） |

**会话原始文件格式说明**（JSONL）：

每行是一个 JSON 对象。只关注 `"type": "message"` 的行，提取 `message.role`（`user` 或 `assistant`）和 `message.content`（文本内容）。忽略工具调用、系统消息等非对话内容。

```jsonl
{"type":"message","message":{"role":"user","content":"帮我查一下天气"}}
{"type":"message","message":{"role":"assistant","content":"今天北京晴天，25°C"}}
```

**跳过的文件**（不是真实对话，是系统元数据）：
- `sessions.json` — 会话注册表
- `session-ranking.*` / `session-bootstrap.*` — 系统元数据
- `dreaming-*.*` — dreaming agent 内部文件
- `*.deleted.*` — 已删除的文件
- `*.reset.*` — 会话重置备份

## 主题分类体系

记忆按**主题（subject）**分类。每条记忆属于一个主题，存入对应的主题文件（`memory/topics/<topic>.md`）。

### 主题由 LLM 自行判断

不使用预设的主题列表或关键词映射。读取每条记忆内容后，根据内容的**语义**判断它属于哪个主题。

**判断原则：**
1. **按内容领域归类**——同一领域的记忆放同一个文件，方便查找。例如所有飞书相关的（配置、wiki 方法、bot 管理）都归 `feishu`
2. **主题粒度适中**——不要太粗（所有东西都放 `misc`），也不要太细（每条记忆一个主题）。目标是每个主题文件 5-20 条记忆
3. **主题名用 kebab-case 英文**——如 `feishu`、`philosophy`、`product`、`football`、`cooking`
4. **已有主题优先**——先查看 `memory/topics/` 下已有哪些主题文件，新记忆尽量归入已有主题
5. **遇到全新领域时创建新主题**——用户开始聊一个完全没见过的话题时，开新文件

## How it works

整理分四步：

### Step 1: MEMORY.md 垃圾回收（必做）

MEMORY.md 是长期记忆的入口，**8KB 预算**。任何不符合结构的内容都需要修复。

**读取 MEMORY.md**：完整读取 workspace 下的 `MEMORY.md` 文件。

**如果 MEMORY.md 不存在或只有标题**：跳过此步骤。

**LLM 分析全篇内容**，识别以下问题并逐一修复：

1. **未归档的 Promoted 条目**：`## Promoted From Short-Term Memory (YYYY-MM-DD)` 下的条目（格式为 `<!-- kaijibot-memory-promotion:key -->` + `- snippet [score=...]`）应该被提取到主题文件中。逐条判断 subject，调用 `memory_save` 写入对应主题文件。

2. **重复内容**：同一信息出现多次（不同格式、不同 section）。保留最完整的版本，删除重复。

3. **结构错误**：缺少应有的 section heading；格式不对的条目；不完整的 HTML 注释标记。

4. **预算超支**：MEMORY.md 超过 8KB 时，把低频内容移到主题文件。MEMORY.md 只保留：
   - 高频内联内容（4 类：👤 User、💬 Key Feedback、🎯 Active Focus、🔗 Reference）
   - 主题文件指针（`- topic-name → memory/topics/topic-name.md`）

5. **孤立内容**：不在任何主题文件中、也不属于内联区域的零散内容。判断 subject 后归入主题文件。

**修复操作**：
- 对每条需要归档的记忆，调用 `memory_save(content=..., topic=..., importance=...)`
- 不要直接编辑 MEMORY.md 文件——通过 `memory_save` 和 `memory_tidy` 工具操作
- Promoted 条目归档后，该 section 可以被清理（条目已进入 topic 文件）

**MEMORY.md 目标结构**（8KB 以内）：

```
# Long-Term Memory

## 👤 User
- inline high-frequency user info (preferences, interests, communication style)

## 💬 Key Feedback
- inline high-frequency feedback about assistant behavior

## 🎯 Active Focus
- inline high-frequency project/work info

## 🔗 Reference
- inline high-frequency reference knowledge

## Topic Pointers
- feishu → memory/topics/feishu.md
- philosophy → memory/topics/philosophy.md
- product → memory/topics/product.md

## Promoted From Short-Term Memory (YYYY-MM-DD)
<!-- kaijibot-memory-promotion:key -->
- snippet [score=0.XXX recalls=N avg=0.XXX source=...]
（这些条目在下次整理时会被归档到主题文件并从此 section 移除）
```

### Step 2: 深度扫描（历遍所有会话记录）

逐个读取所有会话数据，提取关键信息。

**读取顺序：**

1. 调用 `sessions_list` 工具获取所有会话列表（含 `transcriptPath` 字段）。逐个读取 `transcriptPath` 指向的 JSONL 文件，解析出 User/Assistant 对话内容。按文件修改时间从新到旧处理（最近的对话优先）
2. 如果 QMD sessions 已启用（`memory.qmd.sessions.enabled: true`），读取 QMD 导出目录下的 `*.md` 文件作为补充（Markdown 格式更可读，按文件大小从大到小）
3. 读所有每日笔记 `memory/YYYY-MM-DD.md`（按日期从旧到新，补充上述未覆盖的摘要）
4. 按需读会话语料 `memory/.dreams/session-corpus/*.txt`（仅当上述来源仍有信息缺口时）

**提取后立即写入**，每条记忆调用 `memory_save`：
- `content`: 记忆内容（简洁的一句话或一段描述）
- `topic`: 主题名（必填，kebab-case，如 `feishu`、`philosophy`）
- `importance`: 重要性（`high`/`normal`/`low`）
- `type`: 分类（可选，`user`/`feedback`/`project`/`reference`）

示例调用：
```
memory_save(content="飞书 is_cross_tenant 在 search API 的 result_meta 里", topic="feishu", importance="high", type="project")
memory_save(content="不要乱猜测，不确定时先调查", topic="feedback", importance="high", type="feedback")
memory_save(content="好的产品不是能赚多少钱而是能得到用户的认可", topic="product", importance="normal", type="project")
memory_save(content="关注宝玉 from xp.ai 的观点，关注 LLM 上下文管理", topic="ai-tools", type="reference")
memory_save(content="用户喜欢简洁的回复风格", topic="user-preferences", importance="high", type="user")
```

**跳过的内容（不要提取）：**

- 纯技术讨论（代码实现细节、调试过程）
- 已在 USER.md / IDENTITY.md / SOUL.md / TOOLS.md 中存在的信息
- 重复或冗余的会话元数据
- 临时性的操作指令（"帮我查一下..."）
- 代码片段、git 信息、文件路径

### Step 3: 整理主题文件（`memory_tidy` 工具）

对已有的主题文件进行去重、再平衡：

```
调用 memory_tidy 工具，action = "full"
```

这会自动：
- 去除重复条目（Jaccard 相似度 ≥ 0.85）
- 合并相似条目
- 归档 90 天以上的低重要性条目

### Step 4: 最终检查

1. 确认 MEMORY.md 在 8KB 预算内
2. 确认 `## Promoted From Short-Term Memory` section 中的条目已全部归档（如果之前有的话）
3. 确认主题文件指针与实际文件一致
4. 汇报：扫描了 N 个会话文件 + M 个每日笔记，提取了 K 条新记忆，归档了 P 条 promoted 条目，覆盖了 S 个主题，MEMORY.md 当前 X bytes

## Recommended workflow

当用户说"整理记忆"时：

1. **MEMORY.md 垃圾回收**：完整读取 MEMORY.md，识别并修复所有问题（晋升条目归档、重复删除、结构修复、预算控制）
2. **会话深度扫描**：调用 `sessions_list` 获取所有会话，逐个读取 `transcriptPath`（JSONL 格式），解析 User/Assistant 对话，提取关键记忆并调用 `memory_save(content=..., topic=..., importance=..., type=...)` 写入。如果 QMD 已启用，也读取 QMD 的 Markdown 文件作为更可读的补充
3. **每日笔记补充**：读取 `memory/YYYY-MM-DD.md`，提取会话中可能遗漏的摘要信息
4. 调用 `memory_tidy` 做 `full` 整理（去重、合并、再平衡）
5. 最终检查 + 汇报

## Notes

- `--dry-run` 绝对不会修改任何文件，放心使用
- `--archive` 会把旧文件移到 `memory/archive/`，不会删除
- 已有主题文件中的内容不会被重复添加（`memory_save` 自动 Jaccard 去重，阈值 0.8）
- 可以重复运行，幂等安全
- 会话原始文件（JSONL）始终存在，是最完整的对话记录
- QMD 会话是可选的 Markdown 导出，更可读但需要额外配置
- QMD 会话文件单文件最大 ~80KB，逐个读取即可
- JSONL 会话文件可能较大，优先处理最近的会话，按需回溯更早的记录
- 主题文件按需创建——没有记忆的主题不会有文件，不需要预创建
- 可以重复运行，幂等安全
- MEMORY.md 垃圾回收适用于所有场景：梦境晋升、LLM 写入错误、重复内容、结构损坏等
