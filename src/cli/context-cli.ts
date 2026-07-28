import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Command } from "commander";
import { danger, success as successTheme, warn } from "../globals.js";
import { textSimilarity } from "../infra/text-similarity.js";
import { defaultRuntime } from "../runtime.js";
import { normalizeOptionalString } from "../shared/string-coerce.js";
import { theme } from "../terminal/theme.js";

const dim = (s: string) => theme.muted(s);
const DAY = 86_400_000;
const BOOTSTRAP_FILES = [
  "AGENTS.md",
  "SOUL.md",
  "IDENTITY.md",
  "USER.md",
  "TOOLS.md",
  "MEMORY.md",
  "HEARTBEAT.md",
  "BOOTSTRAP.md",
] as const;

/** Files that `trim` is allowed to analyze. MEMORY.md is excluded — it is managed
 *  by the consolidation system (daily cron + memory-organize skill + 8KB auto-rebalance).
 *  LLM trim doesn't understand consolidation routing rules and will over-delete core memory. */
const TRIMMABLE_FILES = BOOTSTRAP_FILES.filter((f) => f !== "MEMORY.md");
const PROTECTED_FROM_TRIM = new Set(["MEMORY.md"]);

async function resolveAgentWorkspace(agentId: string): Promise<string> {
  const { resolveConfigDir } = await import("../utils.js");
  const { resolveAgentWorkspaceDir } = await import("../agents/agent-scope.js");
  const { loadConfig } = await import("../config/config.js");
  return resolveAgentWorkspaceDir(loadConfig(), agentId);
}

async function loadL3(agentId: string, userId: string) {
  const { resolveConfigDir } = await import("../utils.js");
  const { PersonaStore } = await import("../cognitive/persona/store.js");
  const { CorrectionStore } = await import("../cognitive/correction/store.js");
  const configDir = resolveConfigDir();
  const persona = await new PersonaStore(configDir).load(agentId, userId);
  const corrections = await new CorrectionStore(configDir).listActive(agentId, userId);
  return { persona, corrections, configDir };
}

async function listUserIds(agentId: string): Promise<string[]> {
  const { resolveConfigDir } = await import("../utils.js");
  const { PersonaStore } = await import("../cognitive/persona/store.js");
  const { CorrectionStore } = await import("../cognitive/correction/store.js");
  const configDir = resolveConfigDir();
  const a = await new PersonaStore(configDir).listUserIds(agentId);
  const b = await new CorrectionStore(configDir).listUserIds(agentId);
  return [...new Set([...a, ...b])].toSorted();
}

async function readL2Files(
  workspaceDir: string,
): Promise<Array<{ name: string; content: string; chars: number; tokens: number }>> {
  const results: Array<{ name: string; content: string; chars: number; tokens: number }> = [];
  for (const name of BOOTSTRAP_FILES) {
    try {
      const content = await readFile(join(workspaceDir, name), "utf-8");
      const chars = content.length;
      let cjk = 0;
      let other = 0;
      for (const ch of content) {
        const code = ch.codePointAt(0) ?? 0;
        if (
          (code >= 0x4e00 && code <= 0x9fff) ||
          (code >= 0x3400 && code <= 0x4dbf) ||
          (code >= 0xff00 && code <= 0xffef)
        ) {
          cjk++;
        } else {
          other++;
        }
      }
      const tokens = Math.ceil(cjk * 1.5 + other * 0.25);
      results.push({ name, content, chars, tokens });
    } catch {}
  }
  return results;
}

function approxTokens(text: string): number {
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0xff00 && code <= 0xffef)
    ) {
      cjk++;
    } else {
      other++;
    }
  }
  return Math.ceil(cjk * 1.5 + other * 0.25);
}

function checkCrossLayer(
  l2Files: Array<{ name: string; content: string }>,
  persona: unknown,
): Array<{ l2File: string; l2Snippet: string; l3Field: string }> {
  const issues: Array<{ l2File: string; l2Snippet: string; l3Field: string }> = [];
  const p = persona as Record<string, unknown> | undefined;
  const identity = p?.identity as Record<string, unknown> | undefined;
  const domains = (p?.domains as Record<string, Record<string, unknown>>) ?? {};
  const traits = (identity?.coreTraits as Record<string, Record<string, unknown>>) ?? {};
  const commStyle = identity?.communicationStyle as Record<string, unknown> | undefined;

  const l3Keywords: Array<{ field: string; keywords: string[] }> = [];
  for (const [key, trait] of Object.entries(traits)) {
    l3Keywords.push({
      field: `trait "${key}"`,
      keywords: [String(trait?.value ?? "").toLowerCase()],
    });
  }
  if (commStyle?.preferredLanguage) {
    l3Keywords.push({
      field: "preferredLanguage",
      keywords: [String(commStyle.preferredLanguage)],
    });
  }
  for (const [name, d] of Object.entries(domains)) {
    const insights = (d.insights as Array<{ text?: string }>) ?? [];
    for (const ins of insights.slice(0, 2)) {
      if (ins.text) {
        l3Keywords.push({
          field: `domain "${name}" insight`,
          keywords: [ins.text.toLowerCase().slice(0, 40)],
        });
      }
    }
  }

  for (const file of l2Files) {
    const lower = file.content.toLowerCase();
    for (const { field, keywords } of l3Keywords) {
      for (const kw of keywords) {
        if (kw.length >= 3 && lower.includes(kw)) {
          issues.push({ l2File: file.name, l2Snippet: kw.slice(0, 50), l3Field: field });
          break;
        }
      }
    }
  }
  return issues;
}

export function registerContextCli(program: Command) {
  const context = program
    .command("context")
    .description("Context engineering — audit and trim injected context");

  const defaultAgentId = process.env.KAIJIBOT_AGENT_ID ?? "main";
  const defaultUserId = process.env.KAIJIBOT_USER_ID;

  context
    .command("audit [userId]")
    .description("Inspect L1/L2/L3 token distribution, diagnose issues, optionally fix")
    .option("-a, --agent <id>", "Agent ID", defaultAgentId)
    .option("--fix", "Auto-fix L3 issues (remove stale, merge duplicates)")
    .option("--dry-run", "Show what --fix would do without executing")
    .option("--json", "JSON output")
    .action(
      async (
        rawUserId: string | undefined,
        opts: { agent: string; fix: boolean; dryRun: boolean; json: boolean },
      ) => {
        try {
          const agentId = normalizeOptionalString(opts.agent) ?? defaultAgentId;
          const userId = normalizeOptionalString(rawUserId) ?? defaultUserId;

          if (!userId) {
            const ids = await listUserIds(agentId);
            if (ids.length === 0) {
              defaultRuntime.log(dim(`No users with cognitive data for agent "${agentId}".`));
              return;
            }
            defaultRuntime.log(dim("Users with cognitive data:"));
            for (const id of ids) {
              defaultRuntime.log(`  ${id}`);
            }
            defaultRuntime.log(dim("\nUsage: kaijibot context audit <userId> -a <agent>"));
            return;
          }

          const workspaceDir = await resolveAgentWorkspace(agentId);
          const { persona, corrections, configDir } = await loadL3(agentId, userId!);
          const l2Files = await readL2Files(workspaceDir);
          const now = Date.now();

          const l2TotalTokens = l2Files.reduce((s, f) => s + f.tokens, 0);

          const p = persona as Record<string, unknown> | undefined;
          const domains = (p?.domains as Record<string, Record<string, unknown>>) ?? {};
          const rapport = p?.rapport as Record<string, unknown> | undefined;
          const domainCount = Object.keys(domains).length;
          const activeDomains = Object.values(domains).filter(
            (d) => (d.depth as number) >= 3,
          ).length;

          const corrItems = corrections.map((c) => ({
            id: c.id,
            domain: c.domain,
            mistake: c.mistake,
            reinforcedCount: c.reinforcedCount,
            usageCount: c.usageCount ?? 0,
            ageDays: Math.floor((now - c.lastReinforced) / DAY),
          }));

          const stale = corrItems.filter((c) => c.ageDays > 45);
          const unused = corrItems.filter((c) => c.usageCount === 0 && c.reinforcedCount <= 1);
          const duplicates: Array<{
            a: (typeof corrItems)[number];
            b: (typeof corrItems)[number];
            sim: number;
          }> = [];
          for (let i = 0; i < corrItems.length; i++) {
            for (let j = i + 1; j < corrItems.length; j++) {
              if (corrItems[i]!.domain !== corrItems[j]!.domain) continue;
              const sim = textSimilarity(corrItems[i]!.mistake, corrItems[j]!.mistake);
              if (sim > 0.6) {
                duplicates.push({
                  a: corrItems[i]!,
                  b: corrItems[j]!,
                  sim: Math.round(sim * 100) / 100,
                });
              }
            }
          }

          const stalePersonaDomains = Object.entries(domains)
            .map(([name, d]) => ({
              name,
              days: Math.floor((now - (d.lastMentioned as number)) / DAY),
            }))
            .filter((d) => d.days > 60)
            .toSorted((a, b) => b.days - a.days);

          const crossLayer = checkCrossLayer(
            l2Files.map((f) => ({ name: f.name, content: f.content })),
            persona,
          );

          const l3PersonaTokens = persona ? approxTokens(JSON.stringify(persona)) : 0;
          const l3CorrTokens = corrections.reduce(
            (s, c) => s + approxTokens(`${c.domain} ${c.trigger} ${c.mistake} ${c.correction}`),
            0,
          );
          const l3Total = l3PersonaTokens + l3CorrTokens;

          const fixIds: string[] = [];
          for (const c of stale) {
            fixIds.push(c.id);
          }
          const mergeIds: string[] = [];
          for (const d of duplicates) {
            mergeIds.push(d.a.reinforcedCount >= d.b.reinforcedCount ? d.b.id : d.a.id);
          }

          if (opts.json) {
            defaultRuntime.writeJson({
              agentId,
              userId,
              tokenBudget: { l1Estimated: 2700, l2: l2TotalTokens, l3: l3Total },
              l2Files: l2Files.map((f) => ({ name: f.name, chars: f.chars, tokens: f.tokens })),
              l3: {
                persona: {
                  active: Boolean(persona),
                  domainCount,
                  activeDomains,
                  trustScore: (rapport?.trustScore as number) ?? 0,
                },
                corrections: {
                  total: corrections.length,
                  stale: stale.length,
                  unused: unused.length,
                  duplicates: duplicates.length,
                },
              },
              issues: { stale, unused, duplicates, stalePersonaDomains, crossLayer },
              fix: {
                wouldRemove: [...new Set([...fixIds, ...mergeIds])],
                count: new Set([...fixIds, ...mergeIds]).size,
              },
            });
            return;
          }

          defaultRuntime.log(`\n${successTheme("Context Audit")} — ${agentId}/${userId}`);
          defaultRuntime.log(dim("━".repeat(50)));

          defaultRuntime.log(`\n${successTheme("Token Budget")}`);
          defaultRuntime.log(`  L1 hardcoded:  ~2700 (system-prompt.ts)`);
          defaultRuntime.log(`  L2 user files: ~${l2TotalTokens} (${l2Files.length} files)`);
          defaultRuntime.log(
            `  L3 cognitive:  ~${l3Total} (persona ${l3PersonaTokens} + corrections ${l3CorrTokens})`,
          );
          defaultRuntime.log(`  ${dim("Total: ~")}${2700 + l2TotalTokens + l3Total}`);

          defaultRuntime.log(`\n${successTheme("L2 Files")}`);
          for (const f of l2Files) {
            const pct =
              f.name === "MEMORY.md" ? ` (${Math.round((f.chars / 8192) * 100)}% of 8KB)` : "";
            const managed =
              f.name === "MEMORY.md" ? dim(" [consolidation-managed, trim excluded]") : "";
            defaultRuntime.log(`  ${f.name}: ${f.chars} chars / ~${f.tokens} tok${pct}${managed}`);
          }

          defaultRuntime.log(`\n${successTheme("L3 Cognitive")}`);
          defaultRuntime.log(
            `  Persona: ${domainCount} domains (${activeDomains} active), trust=${((rapport?.trustScore as number) ?? 0).toFixed(2)}`,
          );
          defaultRuntime.log(`  Corrections: ${corrections.length} active`);

          const hasIssues =
            stale.length > 0 ||
            unused.length > 0 ||
            duplicates.length > 0 ||
            stalePersonaDomains.length > 0 ||
            crossLayer.length > 0;

          if (hasIssues) {
            defaultRuntime.log(`\n${warn("⚠ Issues")}`);
            if (stale.length > 0) {
              defaultRuntime.log(`  🔴 Stale corrections (${stale.length}):`);
              for (const c of stale.slice(0, 5)) {
                defaultRuntime.log(`     [${c.domain}] ${c.mistake} — ${c.ageDays}d ago`);
              }
            }
            if (unused.length > 0) {
              defaultRuntime.log(`  🟡 Unused corrections (${unused.length}):`);
              for (const c of unused.slice(0, 5)) {
                defaultRuntime.log(
                  `     [${c.domain}] ${c.mistake} — usage=0 reinforced=${c.reinforcedCount}`,
                );
              }
            }
            if (duplicates.length > 0) {
              defaultRuntime.log(`  🟡 Duplicates (${duplicates.length}):`);
              for (const d of duplicates.slice(0, 5)) {
                defaultRuntime.log(
                  `     [${d.a.domain}] sim=${d.sim} "${d.a.mistake}" ↔ "${d.b.mistake}"`,
                );
              }
            }
            if (stalePersonaDomains.length > 0) {
              defaultRuntime.log(
                `  🟢 Stale domains (${stalePersonaDomains.length}, auto-decaying):`,
              );
              for (const d of stalePersonaDomains.slice(0, 3)) {
                defaultRuntime.log(`     ${d.name} — ${d.days}d ago`);
              }
            }
            if (crossLayer.length > 0) {
              defaultRuntime.log(`  ⚠️ Cross-layer redundancy (${crossLayer.length}):`);
              for (const c of crossLayer.slice(0, 5)) {
                defaultRuntime.log(`     ${c.l2File} "${c.l2Snippet}" ↔ L3 ${c.l3Field}`);
              }
            }
          } else {
            defaultRuntime.log(`\n${successTheme("✓ No issues found")}`);
          }

          if (opts.fix || opts.dryRun) {
            const allRemoveIds = [...new Set([...fixIds, ...mergeIds])];
            if (allRemoveIds.length > 0) {
              defaultRuntime.log(`\n${opts.dryRun ? dim("Would fix") : successTheme("Fixing")}:`);
              if (fixIds.length > 0)
                defaultRuntime.log(`  → Remove ${new Set(fixIds).size} stale corrections`);
              if (mergeIds.length > 0)
                defaultRuntime.log(
                  `  → Remove ${new Set(mergeIds).size} duplicate corrections (keeping higher reinforcedCount)`,
                );

              if (!opts.dryRun) {
                const { CorrectionStore } = await import("../cognitive/correction/store.js");
                const { resolveConfigDir } = await import("../utils.js");
                const store = new CorrectionStore(resolveConfigDir());
                const removed = await store.removeByIds(agentId, userId!, allRemoveIds);
                defaultRuntime.log(successTheme(`  ✓ Removed ${removed} corrections`));
              }
            } else {
              defaultRuntime.log(dim("\n  Nothing to fix."));
            }
          } else if (hasIssues) {
            defaultRuntime.log(
              dim("\n  Run with --fix to auto-resolve L3 issues, --dry-run to preview."),
            );
          }

          if (l2TotalTokens > 3000) {
            defaultRuntime.log(
              dim(
                "\n  💡 L2 files are large. Run 'kaijibot context trim <file>' for LLM analysis.",
              ),
            );
          }
        } catch (err) {
          defaultRuntime.error(danger(String(err)));
          defaultRuntime.exit(1);
        }
      },
    );

  context
    .command("trim [file]")
    .description(
      "LLM-driven cross-layer analysis: compare L2 file against L1 system prompt + L3 cognitive data",
    )
    .option("-a, --agent <id>", "Agent ID", defaultAgentId)
    .option("--apply", "Write suggestions to <file>.trimmed.md")
    .action(async (fileArg: string | undefined, opts: { agent: string; apply: boolean }) => {
      try {
        const agentId = normalizeOptionalString(opts.agent) ?? defaultAgentId;
        const workspaceDir = await resolveAgentWorkspace(agentId);

        const targetFile = normalizeOptionalString(fileArg);
        const filesToAnalyze: string[] = [];

        if (targetFile) {
          if (PROTECTED_FROM_TRIM.has(targetFile)) {
            defaultRuntime.log(
              dim(
                `${targetFile} is managed by the consolidation system (daily cron + memory-organize skill). Skipping.\nUse 'kaijibot memory organize' or edit manually if needed.`,
              ),
            );
            return;
          }
          filesToAnalyze.push(targetFile);
        } else {
          for (const name of TRIMMABLE_FILES) {
            try {
              await readFile(join(workspaceDir, name), "utf-8");
              filesToAnalyze.push(name);
            } catch {}
          }
        }

        if (filesToAnalyze.length === 0) {
          defaultRuntime.log(dim(`No bootstrap files found in: ${workspaceDir}`));
          return;
        }

        const { loadConfig } = await import("../config/config.js");
        const { createBackgroundGenerateText } =
          await import("../cognitive/evolution/standalone-generate.js");
        const cfg = loadConfig();
        const generateText = await createBackgroundGenerateText(cfg, { maxTokens: 2500 });

        for (const fileName of filesToAnalyze) {
          const filePath = join(workspaceDir, fileName);
          let content: string;
          try {
            content = await readFile(filePath, "utf-8");
          } catch {
            continue;
          }

          defaultRuntime.log(`\n${successTheme(`Trimming ${fileName}`)} (${content.length} chars)`);

          let l3Context = "No cognitive data available.";
          try {
            const ids = await listUserIds(agentId);
            if (ids.length > 0) {
              const { persona, corrections } = await loadL3(agentId, ids[0]!);
              const p = persona as Record<string, unknown> | undefined;
              const identity = p?.identity as Record<string, unknown> | undefined;
              const traits = identity?.coreTraits as
                | Record<string, Record<string, unknown>>
                | undefined;
              const traitSummary = traits
                ? Object.entries(traits)
                    .map(([k, v]) => `${k}=${v.value}`)
                    .join(", ")
                : "none";
              const corrSummary = corrections
                .slice(0, 10)
                .map((c) => `[${c.domain}] ${c.mistake}`)
                .join("\n");
              l3Context = `Persona traits: ${traitSummary}\nCorrections:\n${corrSummary}`;
            }
          } catch {}

          const prompt = `You are a context engineering auditor. Analyze this workspace file for redundancy with L1 system prompt content and L3 cognitive data.

**File**: ${fileName} (${content.length} chars)
**L3 cognitive context** (persona + corrections already injected each turn):
${l3Context}

**File content**:
---
${content}
---

**L1 system prompt** (hardcoded, already contains):
- Tooling guidance ("use cron for scheduling", "spawn sub-agents for complex tasks")
- Safety rules ("never bypass safeguards", "never send streaming replies")
- Capabilities ("proactive AI assistant, NOT passive Q&A")
- Messaging routing ("reply in current session → auto routes")
- Tool call style ("do not narrate routine calls")

Rules:
- REMOVE: content the LLM already knows from L1 system prompt or tool definitions (generic tool descriptions, common patterns, directory structure it can discover)
- REMOVE: content duplicated in L3 (user preferences already in persona, mistakes already in corrections)
- CONDENSE: verbose descriptions that could be 1-2 lines
- KEEP: project-specific rules, pitfalls, commands, conventions that differ from defaults

Respond in Chinese if the file is in Chinese. Format:

## ${fileName} 分析

### REMOVE (L1 已覆盖 / L3 已有 / 模型已知)
- [段落描述]: 为什么冗余

### CONDENSE (过于冗长)
- [段落]: 当前 → 建议的精简版

### KEEP (必须保留)
- [段落]: 为什么重要

### 总结
- 当前: ${content.length} chars
- 建议精简到: ~X chars (Y% 减少)`;

          const result = await generateText(prompt);

          if (opts.apply) {
            const trimmedPath = join(workspaceDir, `${fileName}.trimmed.md`);
            await writeFile(trimmedPath, result, "utf-8");
            defaultRuntime.log(successTheme(`✓ Suggestions written to ${fileName}.trimmed.md`));
          }

          defaultRuntime.log(`\n${result}`);
        }
      } catch (err) {
        defaultRuntime.error(danger(String(err)));
        defaultRuntime.exit(1);
      }
    });
}
