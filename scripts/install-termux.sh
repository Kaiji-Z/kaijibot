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

SOURCES="$PREFIX/etc/apt/sources.list"
TUNA_MIRROR="deb https://mirrors.tuna.tsinghua.edu.cn/termux/apt/termux-main/ stable main"

TZ_PROP=$(getprop persist.sys.timezone 2>/dev/null || echo "")
case "$TZ_PROP" in
  Asia/Shanghai|Asia/Chongqing|Asia/Harbin|Asia/Urumqi|Asia/Kashgar|PRC|CTT)
    echo "$TUNA_MIRROR" > "$SOURCES"
    info "检测到中国时区，使用 TUNA 镜像"
    ;;
  *)
    info "时区: ${TZ_PROP:-未知}，使用 Termux 默认镜像"
    ;;
esac

export DEBIAN_FRONTEND=noninteractive
APT_OPTS="-y -o Dpkg::Options::=--force-confold"

info "更新软件源..."
apt-get update $APT_OPTS || true
apt-get upgrade $APT_OPTS || true

info "安装 Node.js 和依赖工具..."
apt-get install $APT_OPTS nodejs-lts lsof

npm config set fetch-retries 5
npm config set fetch-retry-mintimeout 20000
npm config set fetch-timeout 600000

case "$TZ_PROP" in
  Asia/Shanghai|Asia/Chongqing|Asia/Harbin|Asia/Urumqi|Asia/Kashgar|PRC|CTT)
    NPM_REGISTRY="--registry=https://registry.npmmirror.com"
    ;;
  *)
    NPM_REGISTRY=""
    ;;
esac

info "获取最新版本号..."
KB_VER=$(curl -fsSL --connect-timeout 15 https://registry.npmjs.org/kaijibot/latest 2>/dev/null | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).version" 2>/dev/null || true)

if [ -z "$KB_VER" ]; then
  info "无法获取版本号，直接从 npm 安装..."
  npm install -g kaijibot@latest --force $NPM_REGISTRY
else
  info "安装 KaijiBot v${KB_VER}..."
  # Priority: npmmirror (China) → npmjs.org (global CDN) → GitHub tarball (last resort)
  npm install -g "kaijibot@${KB_VER}" --force $NPM_REGISTRY || {
    info "镜像源失败，尝试 npmjs.org..."
    npm install -g "kaijibot@${KB_VER}" --force --registry=https://registry.npmjs.org || {
      info "npmjs.org 也失败，尝试 GitHub tarball..."
      npm install -g "https://github.com/Kaiji-Z/kaijibot/releases/download/v${KB_VER}/kaijibot-${KB_VER}.tgz" --force
    }
  }
fi
ok "KaijiBot $(kaijibot --version)"

# Optional: local speech engine (voice input + read-aloud). Non-fatal.
info "安装本地语音引擎 (sherpa-onnx, 可选)..."
SHERPA_INSTALLER="$(dirname "$0")/install-sherpa-onnx-termux.sh"
if [ -f "$SHERPA_INSTALLER" ]; then
  bash "$SHERPA_INSTALLER" || info "语音引擎安装跳过（不影响核心功能）。之后可重试 scripts/install-sherpa-onnx-termux.sh。"
else
  curl -fsSL https://gitee.com/kaiji1126/kaijibot/raw/main/scripts/install-sherpa-onnx-termux.sh | bash \
    || info "语音引擎安装跳过（不影响核心功能）。"
fi

info "启动配置向导，按提示操作..."
exec kaijibot android-install < /dev/tty
