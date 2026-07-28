import type { Command } from "commander";
import { danger, success as successTheme, warn } from "../globals.js";
import { defaultRuntime } from "../runtime.js";
import { normalizeOptionalString } from "../shared/string-coerce.js";
import { theme } from "../terminal/theme.js";

const dim = (s: string) => theme.muted(s);

const DAY = 86_400_000;

type ShowResult = {
  agentId: string;
  userId: string;
  persona: {
    active: boolean;
    displayName?: string;
    domainCount: number;
    activeDomains: Array<{ name: string; depth: number; lastMentioned: number; phase?: string }>;
    trustScore: number;
    recentFocus: string[];
  };
  corrections: {
    total: number;
    items: Array<{
      id: string;
      domain: string;
      trigger: string;
      mistake: string;
      reinforcedCount: number;
      usageCount?: number;
      lastReinforced: number;
      ageDays: number;
    }>;
  };
  workspaceFiles: string[];
};

type AuditResult = {
  staleCorrections: Array<{
    id: string;
    domain: string;
    mistake: string;
    ageDays: number;
    reason: string;
  }>;
  unusedCorrections: Array<{
    id: string;
    domain: string;
    mistake: string;
    usageCount: number;
    reason: string;
  }>;
  duplicateCorrections: Array<{ ids: string[]; domain: string; similarity: number }>;
  stalePersonaDomains: Array<{ name: string; lastMentionedDays: number }>;
};

async function loadContextData(
  agentId: string,
  userId: string,
): Promise<{
  persona: unknown;
  corrections: ShowResult["corrections"]["items"];
}> {
  const { resolveConfigDir } = await import("../utils.js");
  const configDir = resolveConfigDir();
  const { PersonaStore } = await import("../cognitive/persona/store.js");
  const { CorrectionStore } = await import("../cognitive/correction/store.js");
  const persona = await new PersonaStore(configDir).load(agentId, userId);
  const rawCorrections = await new CorrectionStore(configDir).listActive(agentId, userId);
  const now = Date.now();
  const corrections = rawCorrections.map((c) => ({
    id: c.id,
    domain: c.domain,
    trigger: c.trigger,
    mistake: c.mistake,
    reinforcedCount: c.reinforcedCount,
    usageCount: c.usageCount,
    lastReinforced: c.lastReinforced,
    ageDays: Math.floor((now - c.lastReinforced) / DAY),
  }));
  return { persona, corrections };
}

async function listUserIds(agentId: string): Promise<string[]> {
  const { resolveConfigDir } = await import("../utils.js");
  const { PersonaStore } = await import("../cognitive/persona/store.js");
  const { CorrectionStore } = await import("../cognitive/correction/store.js");
  const configDir = resolveConfigDir();
  const personaIds = await new PersonaStore(configDir).listUserIds(agentId);
  const correctionIds = await new CorrectionStore(configDir).listUserIds(agentId);
  return [...new Set([...personaIds, ...correctionIds])].toSorted();
}

export function registerContextCli(program: Command) {
  const context = program
    .command("context")
    .description("Context engineering tools — inspect and audit injected context");

  context
    .command("show [userId]")
    .description("Show active context sections (persona + corrections) for a user")
    .option("-a, --agent <id>", "Agent ID", "main")
    .option("--json", "Output as JSON")
    .action(async (rawUserId: string | undefined, opts: { agent: string; json: boolean }) => {
      try {
        const agentId = normalizeOptionalString(opts.agent) ?? "main";
        const userId = normalizeOptionalString(rawUserId);

        if (!userId) {
          const ids = await listUserIds(agentId);
          if (ids.length === 0) {
            defaultRuntime.log(dim("No users found for agent '" + agentId + "'."));
            return;
          }
          defaultRuntime.log(dim("Users with cognitive data:"));
          for (const id of ids) {
            defaultRuntime.log(`  ${id}`);
          }
          defaultRuntime.log(dim("\nUsage: kaijibot context show <userId> -a <agent>"));
          return;
        }

        const { persona, corrections } = await loadContextData(agentId, userId!);
        const p = persona as Record<string, unknown> | undefined;
        const identity = p?.identity as Record<string, unknown> | undefined;
        const rapport = p?.rapport as Record<string, unknown> | undefined;
        const domains = (p?.domains as Record<string, Record<string, unknown>>) ?? {};
        const activeDomains = Object.entries(domains)
          .filter(([, d]) => (d.depth as number) >= 3)
          .toSorted(([, a], [, b]) => (b.lastMentioned as number) - (a.lastMentioned as number))
          .slice(0, 5)
          .map(([name, d]) => ({
            name,
            depth: d.depth as number,
            lastMentioned: d.lastMentioned as number,
            phase: d.phase as string | undefined,
          }));

        const result: ShowResult = {
          agentId,
          userId: userId!,
          persona: {
            active: Boolean(p),
            displayName: identity?.displayName as string | undefined,
            domainCount: Object.keys(domains).length,
            activeDomains,
            trustScore: (rapport?.trustScore as number) ?? 0,
            recentFocus: (p?.recentFocus as string[]) ?? [],
          },
          corrections: {
            total: corrections.length,
            items: corrections,
          },
          workspaceFiles: [],
        };

        if (opts.json) {
          defaultRuntime.writeJson(result);
          return;
        }

        defaultRuntime.log(`\n${successTheme("Context for")} ${agentId}/${userId}`);
        defaultRuntime.log(dim("━".repeat(50)));

        defaultRuntime.log(
          `\n${successTheme("Persona")}: ${result.persona.active ? "✅ active" : "❌ none"}`,
        );
        if (result.persona.displayName) {
          defaultRuntime.log(`  Name: ${result.persona.displayName}`);
        }
        defaultRuntime.log(
          `  Domains: ${result.persona.domainCount} (${result.persona.activeDomains.length} active)`,
        );
        defaultRuntime.log(`  Trust: ${result.persona.trustScore.toFixed(2)}`);
        if (result.persona.recentFocus.length > 0) {
          defaultRuntime.log(`  Focus: ${result.persona.recentFocus.slice(0, 5).join(", ")}`);
        }
        for (const d of result.persona.activeDomains) {
          defaultRuntime.log(`  • ${d.name} (depth=${d.depth}, phase=${d.phase ?? "stable"})`);
        }

        defaultRuntime.log(`\n${successTheme("Corrections")}: ${result.corrections.total}`);
        for (const c of result.corrections.items.slice(0, 15)) {
          const usage = c.usageCount !== undefined ? ` used=${c.usageCount}` : "";
          defaultRuntime.log(
            `  [${c.domain}] ${c.mistake} (${c.ageDays}d ago, reinforced=${c.reinforcedCount}${usage})`,
          );
        }
        if (result.corrections.total > 15) {
          defaultRuntime.log(dim(`  ... and ${result.corrections.total - 15} more`));
        }
      } catch (err) {
        defaultRuntime.error(danger(String(err)));
        defaultRuntime.exit(1);
      }
    });

  context
    .command("audit [userId]")
    .description("Find stale, unused, and duplicate corrections + stale persona domains")
    .option("-a, --agent <id>", "Agent ID", "main")
    .option("--json", "Output as JSON")
    .action(async (rawUserId: string | undefined, opts: { agent: string; json: boolean }) => {
      try {
        const agentId = normalizeOptionalString(opts.agent) ?? "main";
        const userId = normalizeOptionalString(rawUserId);

        if (!userId) {
          defaultRuntime.error(
            danger("userId is required for audit. Run 'kaijibot context show' to list users."),
          );
          defaultRuntime.exit(1);
          return;
        }

        const { persona, corrections } = await loadContextData(agentId, userId!);
        const now = Date.now();

        const staleCorrections = corrections
          .filter((c) => c.ageDays > 45)
          .map((c) => ({
            id: c.id,
            domain: c.domain,
            mistake: c.mistake,
            ageDays: c.ageDays,
            reason: `${c.ageDays}d since last reinforcement`,
          }));

        const unusedCorrections = corrections
          .filter((c) => c.usageCount === 0 && c.reinforcedCount <= 1)
          .map((c) => ({
            id: c.id,
            domain: c.domain,
            mistake: c.mistake,
            usageCount: c.usageCount ?? 0,
            reason: `never referenced (usage=0, reinforced=${c.reinforcedCount})`,
          }));

        const { textSimilarity } = await import("../infra/text-similarity.js");
        const duplicateCorrections: AuditResult["duplicateCorrections"] = [];
        for (let i = 0; i < corrections.length; i++) {
          for (let j = i + 1; j < corrections.length; j++) {
            const a = corrections[i]!;
            const b = corrections[j]!;
            if (a.domain !== b.domain) continue;
            const sim = textSimilarity(a.mistake, b.mistake);
            if (sim > 0.6) {
              duplicateCorrections.push({
                ids: [a.id, b.id],
                domain: a.domain,
                similarity: Math.round(sim * 100) / 100,
              });
            }
          }
        }

        const p = persona as Record<string, unknown> | undefined;
        const domains = (p?.domains as Record<string, Record<string, unknown>>) ?? {};
        const stalePersonaDomains = Object.entries(domains)
          .map(([name, d]) => ({
            name,
            lastMentionedDays: Math.floor((now - (d.lastMentioned as number)) / DAY),
          }))
          .filter((d) => d.lastMentionedDays > 60)
          .toSorted((a, b) => b.lastMentionedDays - a.lastMentionedDays);

        const result: AuditResult = {
          staleCorrections,
          unusedCorrections,
          duplicateCorrections,
          stalePersonaDomains,
        };

        if (opts.json) {
          defaultRuntime.writeJson(result);
          return;
        }

        defaultRuntime.log(`\n${successTheme("Context Audit for")} ${agentId}/${userId}`);
        defaultRuntime.log(dim("━".repeat(50)));

        if (result.staleCorrections.length > 0) {
          defaultRuntime.log(
            `\n${warn("⚠ Stale corrections")} (${result.staleCorrections.length}):`,
          );
          for (const c of result.staleCorrections.slice(0, 10)) {
            defaultRuntime.log(`  [${c.domain}] ${c.mistake} — ${c.reason}`);
          }
        }

        if (result.unusedCorrections.length > 0) {
          defaultRuntime.log(
            `\n${warn("⚠ Unused corrections")} (${result.unusedCorrections.length}):`,
          );
          for (const c of result.unusedCorrections.slice(0, 10)) {
            defaultRuntime.log(`  [${c.domain}] ${c.mistake} — ${c.reason}`);
          }
        }

        if (result.duplicateCorrections.length > 0) {
          defaultRuntime.log(
            `\n${warn("⚠ Possible duplicates")} (${result.duplicateCorrections.length}):`,
          );
          for (const d of result.duplicateCorrections.slice(0, 10)) {
            defaultRuntime.log(`  [${d.domain}] sim=${d.similarity} ids=${d.ids.join(",")}`);
          }
        }

        if (result.stalePersonaDomains.length > 0) {
          defaultRuntime.log(
            `\n${warn("⚠ Stale persona domains")} (${result.stalePersonaDomains.length}):`,
          );
          for (const d of result.stalePersonaDomains.slice(0, 10)) {
            defaultRuntime.log(`  ${d.name} — ${d.lastMentionedDays}d since last mention`);
          }
        }

        const totalIssues =
          result.staleCorrections.length +
          result.unusedCorrections.length +
          result.duplicateCorrections.length +
          result.stalePersonaDomains.length;

        if (totalIssues === 0) {
          defaultRuntime.log(`\n${successTheme("✓ No issues found")} — context is clean.`);
        } else {
          defaultRuntime.log(`\n${dim(`Total issues: ${totalIssues}`)}`);
        }
      } catch (err) {
        defaultRuntime.error(danger(String(err)));
        defaultRuntime.exit(1);
      }
    });

  context
    .command("trim [file]")
    .description(
      "Analyze a workspace file (AGENTS.md, SOUL.md, etc.) for redundant/model-known content",
    )
    .option("-a, --agent <id>", "Agent ID", "main")
    .option("--apply", "Write trimmed version to <file>.trimmed.md (does NOT overwrite original)")
    .action(async (fileArg: string | undefined, opts: { agent: string; apply: boolean }) => {
      try {
        const { resolveConfigDir } = await import("../utils.js");
        const { resolveAgentWorkspaceDir } = await import("../agents/agent-scope.js");
        const { loadConfig } = await import("../config/config.js");
        const { readFile } = await import("node:fs/promises");
        const { join, basename } = await import("node:path");

        const cfg = loadConfig();
        const agentId = normalizeOptionalString(opts.agent) ?? "main";
        const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);

        const BOOTSTRAP_FILES = [
          "AGENTS.md",
          "SOUL.md",
          "IDENTITY.md",
          "USER.md",
          "TOOLS.md",
          "MEMORY.md",
          "HEARTBEAT.md",
          "BOOTSTRAP.md",
        ];

        const targetFile = normalizeOptionalString(fileArg);

        if (targetFile) {
          const filePath = join(workspaceDir, targetFile);
          let content: string;
          try {
            content = await readFile(filePath, "utf-8");
          } catch {
            defaultRuntime.error(danger(`File not found: ${filePath}`));
            defaultRuntime.exit(1);
            return;
          }
          await analyzeAndReport(filePath, targetFile, content, opts.apply, workspaceDir);
        } else {
          let analyzed = 0;
          for (const name of BOOTSTRAP_FILES) {
            const filePath = join(workspaceDir, name);
            try {
              const content = await readFile(filePath, "utf-8");
              await analyzeAndReport(filePath, name, content, opts.apply, workspaceDir);
              analyzed++;
            } catch {}
          }
          if (analyzed === 0) {
            defaultRuntime.log(dim(`No bootstrap files found in workspace: ${workspaceDir}`));
            defaultRuntime.log(dim("Usage: kaijibot context trim AGENTS.md -a <agent>"));
          }
        }

        async function analyzeAndReport(
          filePath: string,
          fileName: string,
          content: string,
          apply: boolean,
          workspaceDir: string,
        ): Promise<void> {
          const { createBackgroundGenerateText } =
            await import("../cognitive/evolution/standalone-generate.js");
          const { writeFile } = await import("node:fs/promises");

          defaultRuntime.log(
            `\n${successTheme(`Analyzing ${fileName}`)} (${content.length} chars)`,
          );
          defaultRuntime.log(dim("━".repeat(50)));

          const generateText = await createBackgroundGenerateText(cfg, { maxTokens: 2000 });

          const prompt = `You are a context engineering auditor for an AI assistant (KaijiBot). Analyze the following workspace file and identify content that is redundant, model-known, or overly verbose.

Rules (inspired by Claude Code /doctor):
- KEEP: project-specific rules, pitfalls, rationale, conventions that differ from defaults, user preferences
- CONDENSE: verbose descriptions that could be shorter (suggest a 1-2 line replacement)
- REMOVE: generic info the LLM already knows (tool descriptions, language capabilities, common coding patterns, directory structure it can discover)

File: ${fileName}
Content (${content.length} chars):
---
${content}
---

Respond in this exact format (use Chinese if the file is in Chinese):

## Analysis for ${fileName}

### REMOVE (model already knows / can discover)
- [line range or section]: what it says → why it's redundant

### CONDENSE (too verbose)
- [section]: current text → suggested shorter version

### KEEP (must stay)
- [section]: why it's essential

### Summary
- Current: ${content.length} chars
- Estimated optimal: ~X chars (Y% reduction)
- Top 3 actions: ...`;

          const result = await generateText(prompt);

          if (apply) {
            const trimmedPath = join(workspaceDir, `${fileName}.trimmed.md`);
            await writeFile(trimmedPath, result, "utf-8");
            defaultRuntime.log(successTheme(`✓ Suggestions written to ${trimmedPath}`));
            defaultRuntime.log(dim("  Review and merge manually — original file is untouched."));
          }

          defaultRuntime.log(`\n${result}`);
        }
      } catch (err) {
        defaultRuntime.error(danger(String(err)));
        defaultRuntime.exit(1);
      }
    });
}
