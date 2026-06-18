import { formatTerminalLink } from "./terminal-link.js";

function resolveDocsRoot(): string {
  return "https://gitee.com/kaiji1126/kaijibot/blob/main/docs";
}

export function formatDocsLink(
  path: string,
  label?: string,
  opts?: { fallback?: string; force?: boolean },
): string {
  const trimmed = path.trim();
  const docsRoot = resolveDocsRoot();
  let url: string;
  if (trimmed.startsWith("http")) {
    url = trimmed;
  } else {
    const slashed = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
    // Git-hosted docs need .md extension (was implicit on the Mintlify docs site)
    const fragmentSplit = slashed.split("#");
    const pathPart = fragmentSplit[0]!;
    const fragment = fragmentSplit.length > 1 ? `#${fragmentSplit.slice(1).join("#")}` : "";
    const withExtension = pathPart.endsWith(".md") ? pathPart : `${pathPart}.md`;
    url = `${docsRoot}${withExtension}${fragment}`;
  }
  return formatTerminalLink(label ?? url, url, {
    fallback: opts?.fallback ?? url,
    force: opts?.force,
  });
}
