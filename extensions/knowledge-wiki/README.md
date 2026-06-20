# @kaijibot/knowledge-wiki

LLM-compiled knowledge wiki for **KaijiBot** — based on the [Karpathy LLM Wiki pattern](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f).

The LLM reads your workspace files, extracts knowledge, and compiles a structured, interlinked wiki of markdown pages. You read it; the LLM writes it. The wiki is a persistent, compounding artifact — every source you ingest makes it smarter.

## How It Works

```
Raw Sources (workspace files, memory)  →  LLM Compilation  →  Wiki (structured pages)
docs/architecture.md                      Extract claims        summaries/architecture.md
notes/meeting.md                          Extract entities      entities/rust.md
MEMORY.md                                 Extract concepts      concepts/cap-theorem.md
                                          Build cross-refs      index.md + log.md
```

Three layers:
- **Raw sources** — your workspace files (.md, .txt). Immutable. The LLM reads but never modifies them.
- **Wiki** — LLM-generated markdown pages. Summaries, entity pages, concept pages, cross-references. The LLM owns this layer entirely.
- **Schema** — `AGENTS.md` in the wiki root, governing how the LLM maintains the wiki.

## Config

```json
{
  "plugins": {
    "entries": {
      "knowledge-wiki": {
        "config": {
          "enabled": true,
          "cron": "0 */6 * * *",
          "scan": {
            "extensions": [".md", ".txt", ".rst"],
            "includeMemoryCurated": true,
            "maxFileSize": 1048576
          },
          "extraction": {
            "minConfidence": 0.5,
            "maxClaimsPerPage": 20
          }
        }
      }
    }
  }
}
```

Default: `enabled: false`. Opt-in via config.

## CLI

```bash
kaijibot wiki status          # Wiki vault stats
kaijibot wiki init            # Initialize wiki directory structure
kaijibot wiki ingest          # Ingest all changed workspace files
kaijibot wiki query "rust"    # Search the compiled wiki
kaijibot wiki lint            # Health-check (contradictions, stale claims, orphans)
```

## Agent Tools

- `wiki_ingest` — Ingest a file or all changed files into the wiki
- `wiki_query` — Search the compiled knowledge wiki
- `wiki_lint` — Health-check the wiki
- `wiki_status` — Show wiki vault stats

## Vault Structure

```
workspace/wiki/
├── AGENTS.md              # LLM wiki maintenance instructions
├── index.md               # LLM-maintained page catalog
├── log.md                 # Chronological operation log
├── summaries/             # One page per ingested source
├── entities/              # LLM-extracted entity pages
├── concepts/              # LLM-extracted concept pages
└── .kaijibot-wiki/        # Internal state (file hashes, JSONL log)
```

All pages use YAML frontmatter (`pageType`, `title`, `sourceIds`, `claims`, `updatedAt`) and `[[wikilinks]]` for cross-references.

## Obsidian

The wiki output is native Obsidian format. Open `workspace/wiki/` as an Obsidian vault — graph view, backlinks, and full-text search work automatically. No special integration needed.

## Gateway RPC

- `wiki.status` — Vault stats
- `wiki.query` — Search the wiki
- `wiki.lint` — Health report
- `wiki.ingest` — Trigger ingestion

