#!/usr/bin/env bash
set -euo pipefail

KAIJIBOT_REPO="https://github.com/Kaiji-Z/kaijibot.git"
KAIJIBOT_DIR="kaijibot"
MIN_NODE_MAJOR=22
MIN_NODE_MINOR=14
BOLD='\033[1m'
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { printf "${CYAN}[INFO]${NC}  %s\n" "$*"; }
ok()    { printf "${GREEN}[OK]${NC}    %s\n" "$*"; }
warn()  { printf "${YELLOW}[WARN]${NC}  %s\n" "$*"; }
err()   { printf "${RED}[ERROR]${NC} %s\n" "$*" >&2; }
die()   { err "$@"; exit 1; }

cmd_exists() { command -v "$1" &>/dev/null; }

version_ge() {
  local maj=$1 min=$2 actual=$3
  local actual_maj actual_min
  IFS=. read -r actual_maj actual_min _ <<< "$actual"
  actual_min="${actual_min%%[!0-9]*}"
  [ "$actual_maj" -gt "$maj" ] || { [ "$actual_maj" -eq "$maj" ] && [ "${actual_min:-0}" -ge "$min" ]; }
}

header() {
  printf "\n${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"
  printf "${BOLD}  KaijiBot Installer 👾${NC}\n"
  printf "  ${CYAN}https://github.com/Kaiji-Z/kaijibot${NC}\n"
  printf "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n\n"
}

check_node() {
  if ! cmd_exists node; then
    die "Node.js not found. Install Node.js >= ${MIN_NODE_MAJOR}.${MIN_NODE_MINOR} first: https://nodejs.org"
  fi

  local node_ver
  node_ver=$(node -v | sed 's/^v//')

  if ! version_ge "$MIN_NODE_MAJOR" "$MIN_NODE_MINOR" "$node_ver"; then
    die "Node.js ${node_ver} is too old. Need >= ${MIN_NODE_MAJOR}.${MIN_NODE_MINOR}. Upgrade: https://nodejs.org"
  fi

  ok "Node.js $(node -v)"
}

check_pnpm() {
  if ! cmd_exists pnpm; then
    info "pnpm not found, installing..."
    npm install -g pnpm 2>/dev/null || die "Failed to install pnpm. Run: npm install -g pnpm"
    ok "pnpm installed $(pnpm -v)"
  else
    ok "pnpm $(pnpm -v)"
  fi
}

check_git() {
  if ! cmd_exists git; then
    die "git not found. Install git first."
  fi
  ok "git $(git --version 2>/dev/null | awk '{print $3}')"
}

clone_repo() {
  local target="${1:-$KAIJIBOT_DIR}"
  if [ -d "$target" ] && [ -d "$target/.git" ]; then
    info "Directory '$target' already exists, pulling latest..."
    git -C "$target" pull --ff-only 2>/dev/null || warn "Pull failed, using existing checkout"
  else
    info "Cloning KaijiBot into '$target'..."
    git clone "$KAIJIBOT_REPO" "$target"
  fi
  ok "Source code ready"
}

install_deps() {
  local target="$1"
  info "Installing dependencies..."
  if cmd_exists npm && npm config get registry 2>/dev/null | grep -q "npmmirror"; then
    pnpm install --dir "$target" 2>&1 | tail -1
  else
    pnpm install --dir "$target" --registry https://registry.npmmirror.com 2>&1 | tail -1 || \
    pnpm install --dir "$target" 2>&1 | tail -1
  fi
  ok "Dependencies installed"
}

build_project() {
  local target="$1"
  info "Building KaijiBot..."
  pnpm --dir "$target" build 2>&1 | tail -3
  ok "Build complete"
}

show_next_steps() {
  local target="$1"
  printf "\n${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"
  printf "${GREEN}${BOLD}  ✅ KaijiBot installed successfully!${NC}\n"
  printf "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n\n"
  printf "  ${CYAN}Next steps:${NC}\n\n"
  printf "  ${BOLD}1.${NC} Configure (interactive wizard):\n"
  printf "     cd %s && npx kaijibot onboard\n\n" "$target"
  printf "  ${BOLD}2.${NC} Start the gateway:\n"
  printf "     npx kaijibot gateway --port 18789 --verbose\n\n"
  printf "  ${BOLD}3.${NC} Or use Docker instead:\n"
  printf "     cp .env.example .env  # edit with your keys\n"
  printf "     docker compose up -d\n\n"
  printf "  ${CYAN}Required config:${NC}\n"
  printf "     - At least one LLM API key (ZAI_API_KEY, DEEPSEEK_API_KEY, etc.)\n"
  printf "     - Feishu bot credentials (channels.feishu.appId / appSecret)\n\n"
  printf "  ${CYAN}Docs:${NC} https://github.com/Kaiji-Z/kaijibot\n"
}

main() {
  header

  check_git
  check_node
  check_pnpm

  local target_dir="${1:-$KAIJIBOT_DIR}"

  clone_repo "$target_dir"
  install_deps "$target_dir"
  build_project "$target_dir"

  show_next_steps "$target_dir"
}

main "$@"
