#!/usr/bin/env node
// CI check: verify file/directory paths referenced in AGENTS.md exist.
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "..");
const PATH_RE = /(?:^|[\s`(])((?:src|extensions|packages|skills|test|scripts)\/[^\s)`\]"',:|>]+)/gm;

function extractPaths(content) {
  const paths = new Set();
  let m;
  while ((m = PATH_RE.exec(content)) !== null) {
    let p = m[1].replace(/[.,;:>]+$/, "");
    if (p.includes("*") || p.includes("{")) {
      continue;
    }
    paths.add(p);
  }
  return paths;
}

const targets = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ["AGENTS.md"];
const allPaths = new Map();

for (const target of targets) {
  let content;
  try {
    content = readFileSync(join(REPO_ROOT, target), "utf-8");
  } catch {
    continue;
  }
  for (const p of extractPaths(content)) {
    if (!allPaths.has(p)) {
      allPaths.set(p, []);
    }
    allPaths.get(p).push(target);
  }
}

const missing = [];
let okCount = 0;
for (const [repoPath, sources] of allPaths) {
  if (existsSync(join(REPO_ROOT, repoPath))) {
    okCount++;
  } else {
    missing.push({ path: repoPath, sources });
  }
}

if (missing.length === 0) {
  console.log(`[doc-paths] OK: all ${okCount} referenced paths exist.`);
  process.exit(0);
}
console.error(`[doc-paths] FAIL: ${missing.length} path(s) missing:`);
for (const { path: p, sources } of missing.toSorted((a, b) => a.path.localeCompare(b.path))) {
  console.error(`  MISSING: ${p}  (in ${sources.join(", ")})`);
}
process.exit(1);
