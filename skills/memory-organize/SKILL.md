---
name: memory-organize
description: "整理记忆：将不规范的记忆文件重新分类、去重、归并到结构化的主题文件中。当用户说'整理记忆'、'整理一下记忆'、'记忆太乱了'、'重新组织记忆'时使用。"
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

将零散的、不规范的记忆文件重新整理成结构化的主题分类。

## When to use (trigger phrases)

Use this skill immediately when the user asks any of:

- "整理记忆" / "整理一下记忆"
- "记忆太乱了" / "重新整理记忆"
- "把旧记忆整理一下"
- "organize memories" / "tidy up memories"
- "memory is messy"

## How it works

记忆整理分两步：

### Step 1: 迁移旧记忆（`kaijibot memory migrate`）

扫描 `memory/` 目录下的旧格式文件（`YYYY-MM-DD.md`），将每条记忆分类到主题文件：

```bash
# 预览模式（不写入，只看会怎么整理）
kaijibot memory migrate --dry-run

# 正式整理，旧文件归档到 memory/archive/
kaijibot memory migrate --archive
```

分类规则：
- **user**: 个人信息、偏好、身份、关系
- **feedback**: 用户的纠正和确认
- **project**: 决策、里程碑、已知问题
- **reference**: 外部链接、版本号、服务信息

### Step 2: 整理主题文件（`memory_tidy` 工具）

对已有的主题文件进行去重、再平衡：

```
调用 memory_tidy 工具，action = "full"
```

这会自动：
- 去除重复条目（Jaccard 相似度 ≥ 0.85）
- 合并相似条目
- 将超大文件精简到 25KB 以内
- 归档 90 天以上的低重要性条目

## Recommended workflow

当用户说"整理记忆"时：

1. 先运行 `kaijibot memory migrate --dry-run`，查看会整理多少条目
2. 向用户展示预览结果（文件数、条目数、将创建的主题）
3. 用户确认后，运行 `kaijibot memory migrate --archive`
4. 然后调用 `memory_tidy` 工具做 `full` 整理
5. 最后汇报整理结果

## Notes

- `--dry-run` 绝对不会修改任何文件，放心使用
- `--archive` 会把旧文件移到 `memory/archive/`，不会删除
- LLM 分类失败时会用启发式规则兜底（type=reference，slug=session）
- 可以重复运行，已有主题文件中的内容不会被重复添加
