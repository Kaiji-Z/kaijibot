#!/bin/bash
set -euo pipefail

# KaijiBot Installer for Android/Termux
# Usage: bash scripts/install-termux.sh

BOLD='\033[1m'
SUCCESS='\033[38;2;0;229;204m'
WARN='\033[38;2;255;176;32m'
ERROR='\033[38;2;230;57;70m'
NC='\033[0m'

info()  { printf "${BOLD}[*]${NC} %s\n" "$*"; }
ok()    { printf "${SUCCESS}[✓]${NC} %s\n" "$*"; }
warn()  { printf "${WARN}[!]${NC} %s\n" "$*"; }
fail()  { printf "${ERROR}[✗]${NC} %s\n" "$*"; exit 1; }

# ── Preflight ──────────────────────────────────────────────

if [ ! -d "/data/data/com.termux" ]; then
  fail "This script must be run inside Termux on Android."
fi

if [ "$(id -u)" = "0" ]; then
  fail "Do not run as root. Termux runs as a normal user."
fi

info "Detected Termux environment."

# ── 1. Update packages ────────────────────────────────────

info "Updating package lists..."
pkg update -y || warn "pkg update had issues, continuing..."

# ── 2. Install Node.js ────────────────────────────────────

if ! command -v node &>/dev/null; then
  info "Installing Node.js (LTS)..."
  pkg install -y nodejs-lts || fail "Failed to install Node.js"
else
  NODE_MAJOR=$(node -e "process.stdout.write(String(process.versions.node.split('.')[0]))")
  if [ "$NODE_MAJOR" -lt 22 ]; then
    warn "Node.js $(node -v) is too old (need >=22). Upgrading..."
    pkg install -y nodejs-lts || fail "Failed to upgrade Node.js"
  else
    ok "Node.js $(node -v)"
  fi
fi

# ── 3. Install media tools ────────────────────────────────

info "Installing media packages (imagemagick, ffmpeg)..."
pkg install -y imagemagick ffmpeg || warn "Some media packages failed — image/video tools may be limited."
command -v convert &>/dev/null && ok "ImageMagick: $(convert --version | head -1)"
command -v ffmpeg &>/dev/null && ok "FFmpeg: $(ffmpeg -version | head -1)"

# ── 4. Install KaijiBot ───────────────────────────────────

info "Installing KaijiBot (npm)..."
# --force: skip @lancedb/lancedb which has no android platform binary
npm install -g kaijibot --force || fail "Failed to install KaijiBot"

ok "KaijiBot $(kaijibot --version)"

# ── 5. Install sharp WASM32 (image processing) ───────────

info "Installing @img/sharp-wasm32 for image processing on Android..."
NPM_GLOBAL_ROOT="$(npm root -g)"
if [ -d "$NPM_GLOBAL_ROOT" ]; then
  npm install -g @img/sharp-wasm32 --force 2>/dev/null || warn "sharp-wasm32 install failed — image processing will be limited."
fi

# ── 6. Optional: Chromium for browser automation ──────────

echo ""
info "Browser automation requires Chromium from Termux X11 repo."
read -r -p "Install Chromium now? (y/N) " INSTALL_CHROMIUM
if [[ "$INSTALL_CHROMIUM" =~ ^[Yy]$ ]]; then
  info "Installing X11 repo and Chromium..."
  pkg install -y x11-repo || warn "x11-repo install failed."
  pkg install -y chromium || warn "Chromium install failed — browser automation unavailable."
  if command -v chromium-browser &>/dev/null; then
    ok "Chromium: $(chromium-browser --version 2>/dev/null | head -1)"
  fi
else
  info "Skipped Chromium. Install later: pkg install x11-repo && pkg install chromium"
fi

# ── 7. Wake lock hint ─────────────────────────────────────

echo ""
info "To prevent Android from killing the gateway:"
echo "  termux-wake-lock"
echo ""
info "To auto-start on boot, install Termux:Boot from F-Droid and add to ~/.termux/boot/start-kaijibot.sh:"
echo "  #!/bin/bash"
echo "  termux-wake-lock"
echo "  kaijibot gateway --port 18789 >> ~/kaijibot.log 2>&1 &"

# ── 8. Onboard ────────────────────────────────────────────

echo ""
info "Running onboard wizard..."
kaijibot onboard || warn "Onboard incomplete. Run 'kaijibot onboard' later."

echo ""
ok "KaijiBot installed successfully!"
ok "Start: kaijibot gateway"
ok "Stop:  kaijibot gateway stop  (or pkill -f 'kaijibot gateway')"
