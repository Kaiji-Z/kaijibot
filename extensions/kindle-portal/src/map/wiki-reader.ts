/**
 * Read-only knowledge-wiki markdown graph reader.
 *
 * Walks `<workspaceDir>/wiki/{entities,concepts}/*.md`, extracts YAML
 * frontmatter titles and `[[wikilink]]` edges, and returns a deduplicated
 * `{ nodes, edges }` graph.
 *
 * STRICTLY read-only — never calls writeFile/mkdir/unlink/rename/cp.
 * On any per-file error → logs a warning and skips that file.
 * On missing vault/missing subdir → returns empty (no throw).
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import type { WikiEdge, WikiNode } from "../types.js";

const WIKILINK_RE = /\[\[([^\]]+)\]\]/g;
const TITLE_RE = /^title:\s*(.+?)\s*$/m;
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

/** Parse the `title:` field from frontmatter; fall back to bare filename. */
function parseTitle(content: string, fallback: string): string {
  const fm = content.match(FRONTMATTER_RE);
  if (fm) {
    const m = fm[1].match(TITLE_RE);
    if (m) {
      // Strip surrounding quotes and whitespace.
      return m[1].replace(/^["']|["']$/g, "").trim();
    }
  }
  return fallback;
}

/** Extract all `[[target]]` wikilinks (lowercased) from the body. */
function extractWikilinks(content: string): string[] {
  const out: string[] = [];
  WIKILINK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WIKILINK_RE.exec(content)) !== null) {
    out.push(m[1].trim().toLowerCase());
  }
  return out;
}

async function scanDir(
  dir: string,
  kind: "entity" | "concept",
): Promise<{ nodes: WikiNode[]; edges: WikiEdge[] }> {
  const nodes: WikiNode[] = [];
  const edges: WikiEdge[] = [];

  let entries: readonly string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    // Missing subdir is normal — return empty.
    return { nodes, edges };
  }

  for (const entry of entries) {
    if (!entry.endsWith(".md")) continue;
    const stem = entry.slice(0, -3);
    const id = stem.toLowerCase();
    const file = path.join(dir, entry);

    let content: string;
    try {
      content = await fs.readFile(file, "utf-8");
    } catch (err) {
      console.warn(
        `[kindle-portal/wiki-reader] skipped ${file}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      continue;
    }

    const label = parseTitle(content, stem);
    nodes.push({ id, label, kind });
    for (const target of extractWikilinks(content)) {
      edges.push({ from: id, to: target });
    }
  }

  return { nodes, edges };
}

/**
 * Read the wiki vault rooted at `<workspaceDir>/wiki`.
 *
 * Returns `{ nodes: [], edges: [] }` when the vault or its subdirs are
 * missing. First-occurrence wins on duplicate node ids (entities/ is scanned
 * before concepts/, so entities win on collision). Edges are deduped as
 * unordered pairs and self-edges are dropped.
 */
export async function readWikiGraph(
  workspaceDir: string,
): Promise<{ nodes: WikiNode[]; edges: WikiEdge[] }> {
  const root = path.join(workspaceDir, "wiki");
  try {
    const stat = await fs.stat(root);
    if (!stat.isDirectory()) return { nodes: [], edges: [] };
  } catch {
    return { nodes: [], edges: [] };
  }

  // Deterministic order: entities first (wins on id collision).
  const entities = await scanDir(path.join(root, "entities"), "entity");
  const concepts = await scanDir(path.join(root, "concepts"), "concept");

  const seenNode = new Set<string>();
  const nodes: WikiNode[] = [];
  for (const n of [...entities.nodes, ...concepts.nodes]) {
    if (seenNode.has(n.id)) continue;
    seenNode.add(n.id);
    nodes.push(n);
  }

  const seenEdge = new Set<string>();
  const edges: WikiEdge[] = [];
  for (const e of [...entities.edges, ...concepts.edges]) {
    if (e.from === e.to) continue;
    const key = e.from < e.to ? `${e.from}\u0000${e.to}` : `${e.to}\u0000${e.from}`;
    if (seenEdge.has(key)) continue;
    seenEdge.add(key);
    edges.push(e);
  }

  return { nodes, edges };
}
