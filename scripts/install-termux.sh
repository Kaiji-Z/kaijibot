#!/bin/bash
set -euo pipefail

# KaijiBot Installer for Android/Termux
# Usage: curl -fsSL https://gitee.com/kaiji1126/kaijibot/raw/main/scripts/install-termux.sh | bash

BOLD='\033[1m'
SUCCESS='\033[38;2;0;229;204m'
WARN='\033[38;2;255;176;32m'
NC='\033[0m'

info()  { printf "${BOLD}[*]${NC} %s\n" "$*"; }
ok()    { printf "${SUCCESS}[✓]${NC} %s\n" "$*"; }
warn()  { printf "${WARN}[!]${NC} %s\n" "$*"; }

if [ ! -d "/data/data/com.termux" ]; then
  echo "此脚本必须在 Termux 中运行。"
  echo "下载 Termux: https://github.com/Kaiji-Z/kaijibot/releases"
  exit 1
fi

info "检测到 Termux，开始安装 KaijiBot..."

export DEBIAN_FRONTEND=noninteractive
export DPKG_FORCE_CONFFILE_UPDATE=1

# ── 切换 Termux 国内镜像（在 pkg 之前）─────────────────────

SOURCES="$PREFIX/etc/apt/sources.list"
echo "deb https://mirrors.tuna.tsinghua.edu.cn/termux/apt/termux-main/ stable main" > "$SOURCES"
info "镜像源已固定为清华 TUNA"

# ── 升级 Termux 核心库 ──────────────────────────────────────

info "升级 Termux 核心库（可能需要几分钟）..."
pkg update -y -o Dpkg::Options::="--force-confold" || true
pkg upgrade -y -o Dpkg::Options::="--force-confold" || true

# ── 安装 Node.js 和系统工具 ─────────────────────────────────

info "安装 Node.js 和系统工具..."
pkg install -y nodejs-lts imagemagick ffmpeg git lsof -o Dpkg::Options::="--force-confold"

info "设置 npm 超时重试..."
npm config set fetch-retries 5
npm config set fetch-retry-mintimeout 20000
npm config set fetch-timeout 600000
npm config set registry https://registry.npmmirror.com

# ── 安装 KaijiBot ────────────────────────────────────────────

info "获取最新版本号..."
KB_VER=$(curl -fsSL https://registry.npmjs.org/kaijibot/latest 2>/dev/null | node -pe "JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).version" 2>/dev/null)
if [ -z "$KB_VER" ]; then
  info "无法获取版本号，使用 npm 直接安装..."
  npm install -g kaijibot --force --registry=https://registry.npmjs.org
else
  info "安装 KaijiBot v${KB_VER}（可能需要几分钟）..."
  npm install -g "https://github.com/Kaiji-Z/kaijibot/releases/download/v${KB_VER}/kaijibot-${KB_VER}.tgz" --force || {
    info "tarball 下载失败，回退到 npm registry..."
    npm install -g kaijibot@latest --force --registry=https://registry.npmjs.org
  }
fi
ok "KaijiBot $(kaijibot --version)"

info "安装图片处理组件..."
npm install -g @img/sharp-wasm32 --force --registry=https://registry.npmmirror.com || warn "sharp-wasm32 安装失败，图片处理功能将受限"

# ── 配置 Android 环境 ────────────────────────────────────────

info "配置 Android 环境（开机自启 + 后台保活）..."
kaijibot android-install --non-interactive

# ── 运行配置向导 ──────────────────────────────────────────────

info "启动配置向导（配置 API Key 和飞书机器人）..."
kaijibot onboard < /dev/tty || warn "配置未完成，之后运行: kaijibot onboard"

# ── 完成 ────────────────────────────────────────────────────

echo ""
printf "${SUCCESS}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"
printf "${SUCCESS}  ✓ KaijiBot 安装完成${NC}\n"
printf "${SUCCESS}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"
echo ""
printf "  Gateway 已在运行。在飞书里给你的机器人发消息试试！\n"
echo ""
printf "${BOLD}日常使用：${NC}\n"
printf "  • 打开 Termux = 自动启动 Gateway\n"
printf "  • kaijibot gateway restart  — 重启\n"
printf "  • kaijibot update           — 更新\n"
echo ""
printf "${WARN}重要：如果 Gateway 频繁被杀，请在手机设置中${NC}\n"
printf "${WARN}关闭 Termux 的电池优化（设置→应用→Termux→电池→不限制）${NC}\n"
