#!/bin/bash
set -euo pipefail

# KaijiBot Installer for Android/Termux
# Usage:
#   curl -fsSL https://gitee.com/kaiji1126/kaijibot/raw/main/scripts/install-termux.sh | bash
#   Or run inside Termux: bash scripts/install-termux.sh

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
  fail "此脚本必须在 Android Termux 中运行。请从 F-Droid 安装 Termux：https://f-droid.org/packages/com.termux/"
fi

if [ "$(id -u)" = "0" ]; then
  fail "不要用 root 运行。Termux 以普通用户身份运行。"
fi

TERMUX_VERSION="${TERMUX_VERSION:-unknown}"
info "检测到 Termux 环境（版本: $TERMUX_VERSION）"

# ── 1. Update packages ────────────────────────────────────

info "更新软件包列表..."
pkg update -y || warn "pkg update 遇到问题，继续..."

# ── 2. Install Node.js ────────────────────────────────────

if ! command -v node &>/dev/null; then
  info "安装 Node.js (LTS)..."
  pkg install -y nodejs-lts || fail "安装 Node.js 失败"
else
  NODE_MAJOR=$(node -e "process.stdout.write(String(process.versions.node.split('.')[0]))")
  if [ "$NODE_MAJOR" -lt 22 ]; then
    warn "Node.js $(node -v) 版本过低（需要 >=22）。升级中..."
    pkg install -y nodejs-lts || fail "升级 Node.js 失败"
  else
    ok "Node.js $(node -v)"
  fi
fi

# ── 3. Install media tools ────────────────────────────────

info "安装媒体工具（imagemagick, ffmpeg）..."
pkg install -y imagemagick ffmpeg || warn "部分媒体包安装失败 — 图片/视频功能可能受限。"
command -v convert &>/dev/null && ok "ImageMagick: $(convert --version 2>/dev/null | head -1)"
command -v ffmpeg &>/dev/null && ok "FFmpeg: $(ffmpeg -version 2>&1 | head -1)"

# ── 4. Install KaijiBot ───────────────────────────────────

info "安装 KaijiBot（npm）..."
# --force: skip @lancedb/lancedb which has no android platform binary
npm install -g kaijibot --force || fail "安装 KaijiBot 失败"
ok "KaijiBot $(kaijibot --version)"

# ── 5. Install sharp WASM32 (image processing) ───────────

info "安装 @img/sharp-wasm32（Android 图片处理）..."
npm install -g @img/sharp-wasm32 --force 2>/dev/null || warn "sharp-wasm32 安装失败 — 图片处理功能将受限。"

# ── 6. Optional: Chromium for browser automation ──────────

echo ""
info "浏览器自动化需要 Chromium（来自 Termux X11 源）。"
read -r -p "现在安装 Chromium？(y/N) " INSTALL_CHROMIUM
if [[ "$INSTALL_CHROMIUM" =~ ^[Yy]$ ]]; then
  info "安装 X11 源和 Chromium..."
  pkg install -y x11-repo || warn "x11-repo 安装失败。"
  pkg install -y chromium || warn "Chromium 安装失败 — 浏览器自动化不可用。"
  if command -v chromium-browser &>/dev/null; then
    ok "Chromium: $(chromium-browser --version 2>/dev/null | head -1)"
  fi
else
  info "跳过 Chromium。以后可安装: pkg install x11-repo && pkg install chromium"
fi

# ── 7. Run kaijibot android-install ───────────────────────

echo ""
info "运行 kaijibot android-install（配置开机自启、后台保活等）..."
kaijibot android-install || warn "android-install 未完成。之后可手动运行: kaijibot android-install"

# ── 8. Next steps ─────────────────────────────────────────

echo ""
printf "${SUCCESS}══════════════════════════════════════════════════${NC}\n"
printf "${SUCCESS}  KaijiBot 安装完成！${NC}\n"
printf "${SUCCESS}══════════════════════════════════════════════════${NC}\n"
echo ""
printf "${BOLD}接下来：${NC}\n"
echo ""
printf "  1. ${BOLD}安装 Termux:Boot${NC}（开机自启）\n"
printf "     从 F-Droid 搜索 com.termux.boot 并安装\n"
printf "     安装后打开一次 Termux:Boot（必须！）\n"
echo ""
printf "  2. ${BOLD}电池优化白名单${NC}（防止后台被杀）\n"
printf "     设置 → 应用 → Termux → 电池 → 不限制后台\n"
printf "     各品牌手机设置路径不同，详见：\n"
printf "     https://gitee.com/kaiji1126/kaijibot/blob/main/docs/platforms/termux.md\n"
echo ""
printf "  3. ${BOLD}启动 Gateway${NC}\n"
printf "     kaijibot gateway\n"
echo ""
printf "  4. ${BOLD}日常命令${NC}\n"
printf "     重启: kaijibot gateway restart\n"
printf "     停止: kaijibot gateway stop\n"
printf "     更新: kaijibot update\n"
printf "     日志: tail -f ~/.kaijibot/gateway.log\n"
echo ""
printf "${WARN}重要：Termux 被 Android 系统杀掉是最常见的问题。${NC}\n"
printf "${WARN}务必完成电池优化白名单设置，否则 Gateway 不稳定。${NC}\n"
