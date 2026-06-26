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
  echo "下载 Termux: https://gitee.com/kaiji1126/kaijibot/releases"
  exit 1
fi

info "检测到 Termux，开始安装 KaijiBot..."

# ── 切换国内镜像（加速下载）─────────────────────────────────

SOURCES="$PREFIX/etc/apt/sources.list"
if grep -q "packages.termux.dev" "$SOURCES" 2>/dev/null; then
  info "切换 Termux 镜像源为清华 TUNA..."
  sed -i 's|packages.termux.dev|mirrors.tuna.tsinghua.edu.cn/termux|g' "$SOURCES"
fi

info "切换 npm 镜像源为 npmmirror..."
npm config set registry https://registry.npmmirror.com 2>/dev/null || true

# ── 全自动安装 ─────────────────────────────────────────────

info "升级 Termux 核心库（可能需要几分钟）..."
pkg update -y -q || true
pkg upgrade -y -q || true

info "安装 Node.js 和系统工具..."
pkg install -y nodejs-lts imagemagick ffmpeg git lsof -q

info "安装 KaijiBot..."
npm install -g kaijibot --force 2>/dev/null
ok "KaijiBot $(kaijibot --version)"

info "安装图片处理组件..."
npm install -g @img/sharp-wasm32 --force 2>/dev/null || true

info "配置 Android 环境（开机自启 + 后台保活）..."
kaijibot android-install --non-interactive

info "启动配置向导（配置 API Key 和飞书机器人）..."
kaijibot onboard || warn "配置未完成，之后运行: kaijibot onboard"

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
