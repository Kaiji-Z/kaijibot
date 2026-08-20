#!/bin/bash
set -euo pipefail

# Install the sherpa-onnx runtime (local ASR/TTS engine) for KaijiBot on Termux.
#
# Strategy:
#   1. Preferred: download the official static linux-aarch64 build (fully
#      static, runs under Termux's bionic libc without any compilation).
#   2. Fallback: compile from source (needs: pkg install git cmake clang
#      ninja-bin) — see the bottom of this script and docs/platforms/termux.md.
#
# Installs into ~/.kaijibot/sherpa-speech/runtime — the location the
# sherpa-speech extension resolves automatically.

BOLD='\033[1m'
SUCCESS='\033[38;2;0;229;204m'
NC='\033[0m'
info()  { printf "${BOLD}[*]${NC} %s\n" "$*"; }
ok()    { printf "${SUCCESS}[✓]${NC} %s\n" "$*"; }

SHERPA_VERSION="${SHERPA_ONNX_VERSION:-v1.13.6}"
STATE_DIR="${KAIJIBOT_STATE_DIR:-$HOME/.kaijibot}"
RUNTIME_DIR="$STATE_DIR/sherpa-speech/runtime"
MIRROR="${SHERPA_ONNX_DOWNLOAD_MIRROR:-}"
ARCH="$(uname -m)"
OS="$(uname -o 2>/dev/null || echo Android)"

if [ ! -d "/data/data/com.termux" ]; then
  echo "此脚本必须在 Termux 中运行。"
  exit 1
fi

if [ "$ARCH" != "aarch64" ]; then
  echo "仅支持 aarch64 设备（当前: $ARCH）。"
  exit 1
fi

if [ -x "$RUNTIME_DIR/bin/sherpa-onnx-offline" ]; then
  ok "sherpa-onnx runtime 已安装: $RUNTIME_DIR"
  exit 0
fi

STATIC_ASSET="sherpa-onnx-${SHERPA_VERSION}-linux-aarch64-static.tar.bz2"
URL="https://github.com/k2-fsa/sherpa-onnx/releases/download/${SHERPA_VERSION}/${STATIC_ASSET}"
if [ -n "$MIRROR" ]; then
  URL="${MIRROR%/}/$URL"
fi

info "下载 sherpa-onnx 静态构建 ($SHERPA_VERSION, ~330MB)..."
info "中国大陆网络可先: export SHERPA_ONNX_DOWNLOAD_MIRROR=https://gh-proxy.com"
mkdir -p "$STATE_DIR/sherpa-speech"
ARCHIVE="$STATE_DIR/sherpa-speech/download-$STATIC_ASSET"

if curl -fL --connect-timeout 20 --retry 3 -o "$ARCHIVE" "$URL"; then
  info "解压..."
  mkdir -p "$RUNTIME_DIR"
  if tar -xjf "$ARCHIVE" -C "$RUNTIME_DIR" --strip-components=1; then
    rm -f "$ARCHIVE"
    if "$RUNTIME_DIR/bin/sherpa-onnx-offline" --help >/dev/null 2>&1; then
      ok "静态构建可用: $RUNTIME_DIR"
      info "模型文件会在 KaijiBot 网关启动时自动后台下载（sense-voice 约155MB + kokoro 约347MB）。"
      exit 0
    fi
    info "静态二进制无法运行，回退到源码编译方案..."
  else
    info "解压失败，回退到源码编译方案..."
  fi
  rm -f "$ARCHIVE"
else
  info "下载失败，回退到源码编译方案..."
fi

cat <<FALLBACK
[源码编译方案] 在 Termux 中执行:

  pkg install -y git cmake clang ninja
  git clone --depth 1 --branch ${SHERPA_VERSION} https://github.com/k2-fsa/sherpa-onnx.git
  cd sherpa-onnx
  # Termux(bionic) 需要 CMakeLists.txt 中 sherpa-onnx 核心库的
  # target_link_libraries(...) 里追加 android log 库, 见:
  # https://github.com/k2-fsa/sherpa-onnx/issues/1459
  cmake -B build -DSHERPA_ONNX_ENABLE_BINARY=ON -DSHERPA_ONNX_ENABLE_TTS=ON \\
        -DSHERPA_ONNX_ENABLE_PYTHON=OFF -DSHERPA_ONNX_ENABLE_TESTS=OFF \\
        -DSHERPA_ONNX_ENABLE_CHECK=OFF -DSHERPA_ONNX_ENABLE_PORTAUDIO=OFF \\
        -DBUILD_SHARED_LIBS=OFF
  cmake --build build -j \$(nproc)
  mkdir -p ~/.kaijibot/sherpa-speech/runtime/bin
  cp build/bin/sherpa-onnx-offline build/bin/sherpa-onnx-offline-tts \\
     ~/.kaijibot/sherpa-speech/runtime/bin/

免编译后备: proot-distro login ubuntu 后使用官方 linux-aarch64 静态构建,
详见 docs/platforms/termux.md。
FALLBACK
exit 1
