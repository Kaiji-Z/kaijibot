#!/bin/bash
set -euo pipefail

# KaijiBot Release Script
# Usage: bash scripts/release.sh 2026.6.28

VERSION="${1:?Usage: bash scripts/release.sh <version>}"

echo "=== Releasing KaijiBot v${VERSION} ==="

# 1. Bump version
node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json','utf8'));
pkg.version = '${VERSION}';
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
"
echo "[1/4] Version bumped to ${VERSION}"

# 2. Build
rm -rf dist
pnpm build
echo "[2/4] Build complete"

# 3. Publish to npm
npm publish --access public --ignore-scripts
echo "[3/4] Published to npm"

# 4. Commit + tag + push
git add package.json
git commit -m "chore(release): v${VERSION}"
git tag "v${VERSION}"
git push origin main "v${VERSION}"
git push github main "v${VERSION}"
echo "[4/4] Pushed. CI will auto-build tarball and upload to GitHub Release."

echo ""
echo "=== Done! ==="
echo "npm:      npm install -g kaijibot@${VERSION}"
echo "tarball:  https://github.com/Kaiji-Z/kaijibot/releases/download/v${VERSION}/kaijibot-${VERSION}.tgz"
echo ""
echo "Note: Wait for CI to finish before the tarball URL works."
echo "      Check: https://github.com/Kaiji-Z/kaijibot/actions"
