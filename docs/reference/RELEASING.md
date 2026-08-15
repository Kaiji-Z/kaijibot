---
title: "Release Policy"
summary: "Public release channels, version naming, and cadence"
read_when:
  - Looking for public release channel definitions
  - Looking for version naming and cadence
---

# Release Policy

KaijiBot ships on two public release lanes:

- **npm** (`kaijibot`, dist-tag `latest`): the install target for
  `npm install -g kaijibot`
- **GitHub Releases**: the `kaijibot-<version>.tgz` tarball attached to each
  tag — the Android/Termux install script downloads this instead of npmjs.org
  for China network reliability. A separate `launcher` tag carries the Android
  Launcher APK, rebuilt on `android/**` changes.

## Version naming

- Stable release version: `YYYY.M.D`
  - Git tag: `vYYYY.M.D`
- Stable correction release version (same-day re-release): `YYYY.M.D-N`
  - Git tag: `vYYYY.M.D-N`
- Do not zero-pad month or day; do not use future dates
- npm versions are immutable — re-publishing an existing version fails with
  E403, so same-day corrections bump the `-N` suffix
- The `-N` suffix looks like a semver prerelease to npm 11+, so CI publishes
  with an explicit `--tag latest`

## Release flow

One command from the repo root:

```bash
bash scripts/release.sh 2026.8.15   # or 2026.8.15-1 for a same-day correction
```

The script bumps `package.json`, runs `pnpm build` as a sanity gate, then
commits, tags, and pushes to both remotes (Gitee + GitHub). It does **not**
publish to npm itself — the git tag drives everything in CI:

- `.github/workflows/publish-tarball.yml` triggers on `v*` tag push and runs
  two parallel jobs:
  - `publish-npm` — publishes to registry.npmjs.org via npm trusted
    publishing (OIDC); no npm token exists on the machine or in repo secrets.
    Node 24 (npm ≥ 11.5.1 required for OIDC).
  - `upload-tarball` — builds the tarball (`npm pack --ignore-scripts`) and
    attaches it to the GitHub Release for that tag.

npm trusted publishing is registered for this package (repository
`Kaiji-Z/kaijibot`, workflow filename `publish-tarball.yml`) and the package's
publishing access is set to "Require 2FA and disallow tokens" — token-based
publishing is rejected by the registry, so the CI workflow is the only
automated publish path. Provenance attestations are signed automatically
(Sigstore transparency log).

## Release preflight

- `release.sh` refuses to tag a commit that cannot build (`pnpm build` gate)
- `pnpm check` (typecheck + lint + boundary checks) runs in CI on every PR

## Public references

- [`scripts/release.sh`](https://github.com/Kaiji-Z/kaijibot/blob/main/scripts/release.sh)
- [`.github/workflows/publish-tarball.yml`](https://github.com/Kaiji-Z/kaijibot/blob/main/.github/workflows/publish-tarball.yml)
- [`AGENTS.md` — Release Process](https://github.com/Kaiji-Z/kaijibot/blob/main/AGENTS.md)
