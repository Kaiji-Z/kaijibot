import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Type } from "typebox";
import type { AnyAgentTool } from "./common.js";
import { textResult } from "./common.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";

const log = createSubsystemLogger("context-show-tool");

const ContextShowSchema = Type.Object({}, { description: "No parameters needed." });

const BOOTSTRAP_FILES = [
  "AGENTS.md",
  "SOUL.md",
  "IDENTITY.md",
  "USER.md",
  "TOOLS.md",
  "HEARTBEAT.md",
] as const;

const PROTECTED_FILES = new Set(["MEMORY.md"]);

function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function createContextShowTool(deps: {
  config?: { cognitive?: { enabled?: boolean } };
  workspaceDir?: string;
  sessionKey?: string;
  agentId?: string;
}): AnyAgentTool | null {
  if (deps.config?.cognitive?.enabled === false) {
    return null;
  }

  return {
    name: "context_show",
    label: "Context Show",
    description:
      "展示当前 agent 的三层注入上下文：L1 系统提示关键段、L2 workspace 文件全文（排除 MEMORY.md）、L3 认知数据（persona + corrections）。用于上下文整理时让 agent 看到全部注入内容以判断冗余。",
    parameters: ContextShowSchema,
    async execute(_toolCallId: string) {
      try {
        const workspaceDir = deps.workspaceDir;
        if (!workspaceDir) {
          return textResult("No workspace directory available.", { status: "no_workspace" });
        }

        const parts: string[] = [];

        // L1: hardcoded system prompt sections (summary)
        parts.push("=== L1 System Prompt (hardcoded) ===");
        parts.push("L1 contains these sections (agent lives inside them every turn):");
        parts.push("- Identity: who the agent is, workspace home concept");
        parts.push("- Capabilities: proactive AI assistant, NOT passive Q&A");
        parts.push("- Safety: never bypass safeguards, never send streaming replies");
        parts.push('- Tooling: use cron for scheduling, spawn sub-agents, "do not narrate routine calls"');
        parts.push("- Messaging: reply in current session, auto-routes to channel");
        parts.push("- Silent Replies: HEARTBEAT_OK for empty heartbeat, skip no-content turns");
        parts.push("- User Commands: /new, /reset, /model etc.");
        parts.push("- Context Layer Priority: L1 > L3 > L2 resolution order");
        parts.push("");

        // L2: workspace bootstrap files (excluding MEMORY.md)
        parts.push("=== L2 Workspace Files ===");
        let l2TotalTokens = 0;
        const l2Files: { name: string; content: string; tokens: number }[] = [];

        for (const name of BOOTSTRAP_FILES) {
          try {
            const content = await readFile(join(workspaceDir, name), "utf-8");
            const tokens = approxTokens(content);
            l2Files.push({ name, content, tokens });
            l2TotalTokens += tokens;
          } catch {}
        }

        // Also check MEMORY.md for stats but don't output content
        // Intentionally not shown — mentioning it invites the agent to modify it.

        parts.push(`Total: ~${l2TotalTokens} tokens (${l2Files.length} files)`);
        parts.push("");

        for (const f of l2Files) {
          parts.push(`--- ${f.name} (${f.content.length} chars / ~${f.tokens} tok) ---`);
          parts.push(f.content);
          parts.push("");
        }

        // L3: cognitive data
        parts.push("=== L3 Cognitive Data (dynamic) ===");
        const agentId = deps.agentId ?? "main";
        const { resolveConfigDir } = await import("../../utils.js");
        const configDir = resolveConfigDir();

        // Persona
        try {
          const { resolveCognitiveUserId } = await import("../../cognitive/identity.js");
          const userId = resolveCognitiveUserId(deps.sessionKey) ?? "operator";
          const { PersonaStore } = await import("../../cognitive/persona/store.js");
          const store = new PersonaStore(configDir);
          const persona = await store.load(agentId, userId);
          if (persona) {
            const { buildPersonaContext } = await import("../../cognitive/persona/context-builder.js");
            const personaCtx = buildPersonaContext(persona);
            const domainCount = Object.keys(persona.domains).length;
            const trust = persona.rapport.trustScore;
            parts.push(`--- Persona (${domainCount} domains, trust=${trust.toFixed(2)}, user=${userId}) ---`);
            parts.push(personaCtx || "(empty)");
          } else {
            parts.push("--- Persona ---");
            parts.push("(no persona data)");
          }
        } catch (err) {
          parts.push(`--- Persona ---`);
          parts.push(`(load error: ${String(err)})`);
        }
        parts.push("");

        // Corrections
        try {
          const { CorrectionStore } = await import("../../cognitive/correction/store.js");
          const store = new CorrectionStore(configDir);
          const { resolveCognitiveUserId } = await import("../../cognitive/identity.js");
          const userId = resolveCognitiveUserId(deps.sessionKey);
          if (userId) {
            const corrections = await store.listActive(agentId, userId);
            parts.push(`--- Corrections (${corrections.length} active for user=${userId}) ---`);
            for (const c of corrections) {
              parts.push(
                `  [${c.domain}] trigger: ${c.trigger} | mistake: ${c.mistake} | fix: ${c.correction} | reinforced: ${c.reinforcedCount}`,
              );
            }
            if (corrections.length === 0) {
              parts.push("  (none)");
            }
          } else {
            parts.push("--- Corrections ---");
            parts.push("  (no user session)");
          }
        } catch (err) {
          parts.push("--- Corrections ---");
          parts.push(`(load error: ${String(err)})`);
        }
        parts.push("");

        // Skill Evolution section
        parts.push("--- Skill Evolution Section ---");
        parts.push('Injected when cognitive.evolution.enabled: "## Skill Evolution — 当看到 [Evolution Signal]..."');
        parts.push("");

        // Mode classification
        parts.push("--- Current Mode ---");
        parts.push("Classified each turn by mode-router (task/insight/hybrid). Changes per message.");

        const output = parts.join("\n");
        log.info("context shown", { agentId, l2Files: l2Files.length, l2Tokens: l2TotalTokens });

        return textResult(output, { status: "ok", l2Tokens: l2TotalTokens });
      } catch (err) {
        return textResult(`Context show failed: ${String(err)}`, { status: "error" });
      }
    },
  };
}
