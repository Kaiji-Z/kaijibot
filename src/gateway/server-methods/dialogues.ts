import fs from "node:fs/promises";
import path from "node:path";

import { listAgentIds, resolveAgentWorkspaceDir } from "../../agents/agent-scope.js";
import { loadConfig } from "../../config/config.js";

import { ErrorCodes, errorShape } from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";

/**
 * Dialogues RPC handlers — browse archived conversation markdown files
 * stored at `<workspaceDir>/memory/dialogues/*.md` for each agent.
 *
 * Files are written by src/hooks/bundled/session-memory/handler.ts on
 * /new or /reset and follow naming pattern YYYY-MM-DD-HHMM.md.
 */

const FILENAME_RE = /^(\d{4}-\d{2}-\d{2})-(\d{4})\.md$/;

// Defense-in-depth: filename must be a plain basename matching the dated
// pattern. Reject path separators, dots other than the .md ext, etc.
const SAFE_FILENAME_RE = /^[A-Za-z0-9._-]+$/;

type DialogueListItem = {
  filename: string;
  date: string;
  time: string; // "HH:MM"
  size: number;
};

type AgentDialogues = {
  agentId: string;
  workspace: string;
  dialogues: DialogueListItem[];
};

function formatTime(hhmm: string): string {
  return `${hhmm.slice(0, 2)}:${hhmm.slice(2)}`;
}

async function scanAgentDialogues(agentId: string): Promise<AgentDialogues> {
  const cfg = loadConfig();
  const workspace = resolveAgentWorkspaceDir(cfg, agentId);
  const dir = path.join(workspace, "memory", "dialogues");
  const dialogues: DialogueListItem[] = [];

  let files: string[];
  try {
    files = await fs.readdir(dir);
  } catch {
    // Directory missing or unreadable: agent has no archived dialogues yet.
    return { agentId, workspace, dialogues: [] };
  }

  for (const file of files) {
    if (!file.endsWith(".md")) {
      continue;
    }
    const match = FILENAME_RE.exec(file);
    if (!match) {
      continue;
    }
    const [, date, time] = match;
    const fullPath = path.join(dir, file);
    let size = 0;
    try {
      const stat = await fs.stat(fullPath);
      if (!stat.isFile()) {
        continue;
      }
      size = stat.size;
    } catch {
      continue;
    }
    dialogues.push({ filename: file, date, time: formatTime(time), size });
  }

  // Sort newest first by date+time.
  dialogues.sort((a, b) => {
    const keyA = `${a.date}${a.time}`;
    const keyB = `${b.date}${b.time}`;
    return keyB.localeCompare(keyA);
  });

  return { agentId, workspace, dialogues };
}

function resolveDialoguePath(params: {
  workspace: string;
  filename: string;
}): string | null {
  const filename = params.filename?.trim();
  if (!filename || !SAFE_FILENAME_RE.test(filename) || !filename.endsWith(".md")) {
    return null;
  }
  const match = FILENAME_RE.exec(filename);
  if (!match) {
    return null;
  }
  // resolveAgentWorkspaceDir already returns an absolute, ~-expanded path;
  // SAFE_FILENAME_RE above guarantees no separators so the join stays
  // inside the dialogues directory.
  return path.join(params.workspace, "memory", "dialogues", filename);
}

export const dialoguesHandlers: GatewayRequestHandlers = {
  "dialogues.list": async ({ respond, params }) => {
    try {
      const cfg = loadConfig();
      const requestedAgentId =
        typeof params.agentId === "string" && params.agentId.trim()
          ? params.agentId.trim()
          : undefined;

      const agentIds = requestedAgentId
        ? listAgentIds(cfg).includes(requestedAgentId)
          ? [requestedAgentId]
          : []
        : listAgentIds(cfg);

      const agents: AgentDialogues[] = [];
      for (const agentId of agentIds) {
        agents.push(await scanAgentDialogues(agentId));
      }

      respond(true, { agents });
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },

  "dialogues.get": async ({ respond, params }) => {
    try {
      const agentId =
        typeof params.agentId === "string" && params.agentId.trim()
          ? params.agentId.trim()
          : undefined;
      const filename =
        typeof params.filename === "string" && params.filename.trim()
          ? params.filename.trim()
          : undefined;
      if (!agentId || !filename) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "agentId and filename are required"),
        );
        return;
      }

      const cfg = loadConfig();
      if (!listAgentIds(cfg).includes(agentId)) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `unknown agent id: ${agentId}`),
        );
        return;
      }

      const workspace = resolveAgentWorkspaceDir(cfg, agentId);
      const filePath = resolveDialoguePath({ workspace, filename });
      if (!filePath) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `invalid dialogue filename: ${filename}`),
        );
        return;
      }

      let content: string;
      let size: number;
      try {
        content = await fs.readFile(filePath, "utf-8");
        size = Buffer.byteLength(content, "utf-8");
      } catch (err) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, `dialogue not readable: ${String(err)}`),
        );
        return;
      }

      respond(true, {
        agentId,
        filename,
        path: `memory/dialogues/${filename}`,
        size,
        content,
      });
    } catch (err) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(err)));
    }
  },
};
