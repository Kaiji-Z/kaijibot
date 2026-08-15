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

echo "=== Releasing KaijiBot v${VERSION} ==="

# 1. Bump version
node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json','utf8'));
pkg.version = '${VERSION}';
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
"
echo "[1/3] Version bumped to ${VERSION}"

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
echo "      publish manually: pnpm build && npm publish --access public --ignore-scripts"
