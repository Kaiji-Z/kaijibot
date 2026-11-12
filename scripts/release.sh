#!/bin/bash
set -euo pipefail

# KaijiBot Release Script
# Usage: bash scripts/release.sh 2026.6.28
#
# npm publishing happens in GitHub Actions via npm trusted publishing (OIDC)
# when the tag is pushed — see .github/workflows/publish-tarball.yml.
# One-time prerequisite: trusted publisher registered on npmjs.com
# (package settings -> Trusted Publisher, workflow file: publish-tarball.yml,
# requires an interactive 2FA challenge).

VERSION="${1:?Usage: bash scripts/release.sh <version>}"

# Normalize date components to valid semver (leading zeros forbidden): npm
# strips them server-side, which silently desyncs the git tag from the
# published version (v2026.11.02 tag -> npm 2026.11.2, tarball name mismatch).
# Normalize once here so tag, package.json, npm, and the Release tarball all
# agree. Keeps a trailing same-date revision suffix (-1, -2, ...).
normalize_version() {
  local v="$1" suffix=""
  if [[ "$v" == *"-"* ]]; then
    suffix="-${v##*-}"
    v="${v%-*}"
  fi
  IFS=. read -r Y M D <<< "$v"
  printf '%d.%d.%d%s\n' "$((10#$Y))" "$((10#$M))" "$((10#$D))" "$suffix"
}
NORMALIZED="$(normalize_version "$VERSION")"
if [ "$NORMALIZED" != "$VERSION" ]; then
  echo "[release] normalized version ${VERSION} -> ${NORMALIZED} (semver forbids leading zeros)"
  VERSION="$NORMALIZED"
fi

echo "=== Releasing KaijiBot v${VERSION} ==="

# 1. Bump version
node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json','utf8'));
pkg.version = '${VERSION}';
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
"
echo "[1/3] Version bumped to ${VERSION}"

# 1b. Regenerate the config schema — it embeds the package version, so CI's
# config:schema:check goes stale on every bump unless regenerated here.
pnpm config:schema:gen
git add src/config/schema.base.generated.ts

# 2. Build — sanity gate so we never tag a commit that cannot build
rm -rf dist
pnpm build
echo "[2/3] Build complete"

# 3. Commit + tag + push; CI publishes to npm and uploads the Release tarball
git add package.json
git commit -m "chore(release): v${VERSION}"
git tag "v${VERSION}"
git push origin main "v${VERSION}"
git push github main "v${VERSION}"
echo "[3/3] Pushed. CI will publish to npm (trusted publishing) and upload the tarball."

echo ""
echo "=== Done! ==="
echo "Watch CI:  https://github.com/Kaiji-Z/kaijibot/actions"
echo "npm:      npm install -g kaijibot@${VERSION}   (available after CI finishes)"
echo "tarball:  https://github.com/Kaiji-Z/kaijibot/releases/download/v${VERSION}/kaijibot-${VERSION}.tgz"
echo ""
echo "Note: publish-npm job requires the npm trusted publisher registration"
echo "      (workflow filename: publish-tarball.yml). If it is not set up yet,"
echo "      publish manually: npm login && pnpm build && \\"
echo "      npm publish --access public --ignore-scripts --tag latest"
