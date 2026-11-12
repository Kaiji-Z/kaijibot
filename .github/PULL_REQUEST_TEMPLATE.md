<!--
PR conventions (also see AGENTS.md at the repo root):

- Title: Conventional Commits style — `type: summary`
  types: feat | fix | docs | chore | deps | test | refactor | ci | build | perf | style
  Examples: `fix(cognitive): break insight import cycle`, `deps: bump hono to 4.13.18`
- Keep the PR scoped to one concern; unrelated refactors go in their own PR.
- For dependency bumps: no `^`/`~` version ranges for packages under
  `pnpm.patchedDependencies`, and remember `pnpm.overrides` (root package.json)
  is the real pin surface — bump both the manifest spec and the override.
- Do not modify baseline/snapshot/expected-failure files to silence failing
  checks; regenerate them with the matching `*:gen` script instead
  (`plugin-sdk:api:gen`, `config:schema:gen`, …).
- Never commit real phone numbers, API keys, or live config values.

中文提示：标题请用 `类型: 摘要` 格式（如 `fix(cognitive): 修复洞察去重`）。
不需要面面俱到，把改了什么、为什么改讲清楚就是好 PR。欢迎任何形式的贡献！
-->

## Summary

<!-- What changed and why. 1-3 sentences. -->

## Type of change

<!-- Keep the one that applies -->

- [ ] fix — bug fix
- [ ] feat — new feature
- [ ] docs — documentation only
- [ ] deps — dependency change
- [ ] chore — tooling / refactoring / other

## Related issue

<!-- e.g. "Fixes #27". Delete if none. -->

## How you tested it

<!-- What you ran locally: `pnpm check`, `pnpm test <path>`, manual scenario, …
Live-LLM tests (`*.live.test.ts`) are local-only; CI runs the offline suite. -->

## Checklist

- [ ] `pnpm check` (tsgo + oxlint + boundary) passes locally
- [ ] Tests added or updated for behavior changes
- [ ] Docs / AGENTS.md updated if architecture or defaults changed
- [ ] No secrets, phone numbers, or live config values in the diff
