#!/bin/bash
set -euo pipefail

# KaijiBot Installer for Android/Termux
# Usage: curl -fsSL https://gitee.com/kaiji1126/kaijibot/raw/main/scripts/install-termux.sh | bash

BOLD='\033[1m'
SUCCESS='\033[38;2;0;229;204m'
NC='\033[0m'

info()  { printf "${BOLD}[*]${NC} %s\n" "$*"; }
ok()    { printf "${SUCCESS}[✓]${NC} %s\n" "$*"; }

if [ ! -d "/data/data/com.termux" ]; then
  echo "此脚本必须在 Termux 中运行。"
  echo "下载 Termux: https://github.com/Kaiji-Z/kaijibot/releases"
  exit 1
fi

info "检测到 Termux，开始安装..."

export DEBIAN_FRONTEND=noninteractive

SOURCES="$PREFIX/etc/apt/sources.list"
echo "deb https://mirrors.tuna.tsinghua.edu.cn/termux/apt/termux-main/ stable main" > "$SOURCES"

info "升级 Termux 核心库（可能需要几分钟）..."
pkg update -y -o Dpkg::Options::="--force-confold" || true
pkg upgrade -y -o Dpkg::Options::="--force-confold" || true

info "安装 Node.js..."
pkg install -y nodejs-lts -o Dpkg::Options::="--force-confold"

npm config set fetch-retries 5
npm config set fetch-retry-mintimeout 20000
npm config set fetch-timeout 600000

info "获取最新版本号..."
KB_VER=$(curl -fsSL https://registry.npmjs.org/kaijibot/latest 2>/dev/null | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).version" 2>/dev/null || true)

if [ -z "$KB_VER" ]; then
  info "无法获取版本号，直接从 npm 安装..."
  npm install -g kaijibot@latest --force --registry=https://registry.npmjs.org
else
  info "安装 KaijiBot v${KB_VER}..."
  npm install -g "https://github.com/Kaiji-Z/kaijibot/releases/download/v${KB_VER}/kaijibot-${KB_VER}.tgz" --force --registry=https://registry.npmmirror.com || {
    info "tarball 失败，回退 npm..."
    npm install -g "kaijibot@${KB_VER}" --force --registry=https://registry.npmjs.org
  }
fi
ok "KaijiBot $(kaijibot --version)"

info "启动配置向导，按提示操作..."
exec kaijibot android-install < /dev/tty
