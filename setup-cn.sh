#!/usr/bin/env bash
# 🧠 KaijiBot 一键部署脚本（非 Docker）
# 面向中国开发者，从源码运行 KaijiBot 主动型 AI 私人助手
#
# 用法: bash setup-cn.sh [选项]
# 选项:
#   --skip-feishu   跳过飞书配置
#   --skip-build    跳过构建（假设已构建）
#   --help          显示帮助信息

set -euo pipefail

# ── 颜色定义 ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

# ── 参数解析 ──────────────────────────────────────────────────────────────────
SKIP_FEISHU=false
SKIP_BUILD=false

for arg in "$@"; do
  case "$arg" in
    --skip-feishu) SKIP_FEISHU=true ;;
    --skip-build)  SKIP_BUILD=true ;;
    --help|-h)
      echo "🧠 KaijiBot 一键部署脚本"
      echo ""
      echo "用法: bash setup-cn.sh [选项]"
      echo ""
      echo "选项:"
      echo "  --skip-feishu   跳过飞书配置（稍后手动配置）"
      echo "  --skip-build    跳过构建步骤（假设已构建）"
      echo "  --help, -h      显示此帮助信息"
      echo ""
      echo "示例:"
      echo "  bash setup-cn.sh                # 完整流程"
      echo "  bash setup-cn.sh --skip-feishu  # 跳过飞书配置"
      exit 0
      ;;
    *)
      echo -e "${RED}未知参数: $arg${NC}"
      echo "运行 bash setup-cn.sh --help 查看帮助"
      exit 1
      ;;
  esac
done

# ── 工具函数 ──────────────────────────────────────────────────────────────────
info()  { echo -e "${BLUE}ℹ ${NC}$*"; }
ok()    { echo -e "${GREEN}✔${NC} $*"; }
warn()  { echo -e "${YELLOW}⚠${NC} $*"; }
fail()  { echo -e "${RED}✘${NC} $*"; exit 1; }

step() {
  local n="$1" total="$2" msg="$3"
  echo ""
  echo -e "${BOLD}${CYAN}[$n/$total] $msg${NC}"
  echo -e "${DIM}────────────────────────────────────────${NC}"
}

ask_yes_no() {
  local prompt="$1" default="${2:-Y}"
  local choices default_marker
  if [[ "$default" == "Y" ]]; then
    choices="[Y/n]"
    default_marker="Y"
  else
    choices="[y/N]"
    default_marker="N"
  fi
  while true; do
    echo -ne "${YELLOW}${prompt} ${choices} ${NC}"
    read -r answer
    answer="${answer:-$default_marker}"
    case "$answer" in
      [Yy]|[Yy][Ee][Ss]) return 0 ;;
      [Nn]|[Nn][Oo])     return 1 ;;
      *) echo "请输入 y 或 n" ;;
    esac
  done
}

ask_value() {
  local prompt="$1" var_name="$2" required="${3:-true}"
  local value
  while true; do
    echo -ne "${CYAN}${prompt}${NC}"
    read -r value
    if [[ -z "$value" && "$required" == "true" ]]; then
      warn "此项为必填，请输入有效值"
      continue
    fi
    eval "${var_name}='${value}'"
    break
  done
}

# ── Banner ────────────────────────────────────────────────────────────────────
print_banner() {
  echo ""
  echo -e "${BOLD}${CYAN}╔══════════════════════════════════════════╗${NC}"
  echo -e "${BOLD}${CYAN}║  🧠 KaijiBot — 主动型 AI 私人助手      ║${NC}"
  echo -e "${BOLD}${CYAN}║  认知驱动，主动思考。                    ║${NC}"
  echo -e "${BOLD}${CYAN}╚══════════════════════════════════════════╝${NC}"
  echo ""
  echo -e "${DIM}独立项目 · 原始代码 fork 自 OpenClaw | 飞书 + 智谱 GLM${NC}"
  echo -e "${DIM}从源码一键部署，无需 Docker${NC}"
  echo ""
}

# ── 步骤 1: 检查 Node.js ─────────────────────────────────────────────────────
check_node() {
  step 1 6 "检查 Node.js 环境"

  if ! command -v node &>/dev/null; then
    fail "未检测到 Node.js"
    echo ""
    echo -e "${YELLOW}请安装 Node.js 22 或更高版本：${NC}"
    echo "  方式一（推荐）：使用 nvm"
    echo "    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash"
    echo "    source ~/.bashrc"
    echo "    nvm install 22"
    echo ""
    echo "  方式二：使用包管理器"
    echo "    # Ubuntu/Debian"
    echo "    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -"
    echo "    sudo apt-get install -y nodejs"
    echo ""
    echo "  方式三：直接下载"
    echo "    https://nodejs.org/zh-cn/download/"
    exit 1
  fi

  local node_major node_minor
  node_major=$(node -v | sed 's/^v//' | cut -d. -f1)
  node_minor=$(node -v | sed 's/^v//' | cut -d. -f2)

  if [[ "$node_major" -lt 22 ]] || { [[ "$node_major" -eq 22 ]] && [[ "$node_minor" -lt 14 ]]; }; then
    local full_version
    full_version=$(node -v)
    warn "Node.js 版本过低: ${full_version}（需要 ≥ 22.14）"
    echo ""
    echo "升级建议："
    echo "  nvm install 22"
    echo "  nvm use 22"
    echo ""
    echo "或直接下载最新版: https://nodejs.org/zh-cn/download/"
    fail "请升级 Node.js 后重新运行此脚本"
  fi

  ok "Node.js $(node -v)"
}

# ── 步骤 2: 检查 pnpm ────────────────────────────────────────────────────────
check_pnpm() {
  step 2 6 "检查 pnpm"

  if ! command -v pnpm &>/dev/null; then
    warn "未检测到 pnpm，正在尝试安装..."
    if command -v npm &>/dev/null; then
      npm install -g pnpm && ok "pnpm 安装成功" || fail "pnpm 安装失败，请手动运行: npm install -g pnpm"
    elif command -v corepack &>/dev/null; then
      corepack enable && ok "corepack 已启用，pnpm 可用" || fail "corepack 启用失败"
    else
      fail "未检测到 pnpm"
      echo ""
      echo "请安装 pnpm："
      echo "  npm install -g pnpm"
      echo "  # 或"
      echo "  corepack enable"
      exit 1
    fi
  fi

  ok "pnpm $(pnpm --version)"
}

# ── 步骤 3: 设置项目 ─────────────────────────────────────────────────────────
setup_project() {
  step 3 6 "准备项目代码"

  # 检测当前目录是否已经是 KaijiBot 项目
  if [[ -f "package.json" ]] && grep -q '"name": "kaijibot"' package.json 2>/dev/null; then
    ok "已在 KaijiBot 项目目录中"
    return 0
  fi

  warn "当前目录不是 KaijiBot 项目"

  if ask_yes_no "是否从 Gitee 克隆 KaijiBot？"; then
    local repo_url="https://gitee.com/kaiji1126/kaijibot.git"
    info "正在克隆: ${repo_url}"
    git clone "$repo_url" || fail "克隆失败，请检查网络连接"
    cd kaijibot || fail "进入项目目录失败"
    ok "项目克隆完成"
  else
    fail "请手动进入 KaijiBot 项目目录后重新运行此脚本"
  fi
}

# ── 步骤 4: 安装依赖 ─────────────────────────────────────────────────────────
install_deps() {
  step 4 6 "安装依赖"

  if [[ -d "node_modules" ]] && [[ -f "node_modules/.pnpm/lock.yaml" ]]; then
    ok "依赖已安装，跳过（如需重装请删除 node_modules 目录）"
    return 0
  fi

  info "正在安装依赖（pnpm install）..."
  pnpm install || fail "依赖安装失败，请检查网络连接或 pnpm 配置"
  ok "依赖安装完成"
}

# ── 步骤 5: 构建 ──────────────────────────────────────────────────────────────
build_project() {
  step 5 6 "构建项目"

  if [[ "$SKIP_BUILD" == true ]]; then
    warn "已跳过构建（--skip-build）"
    return 0
  fi

  if [[ -d "dist" ]] && [[ -f "kaijibot.mjs" ]]; then
    ok "项目已构建，跳过（如需重新构建请删除 dist 目录）"
    return 0
  fi

  info "正在构建（pnpm build）..."
  pnpm build || fail "构建失败，请检查 TypeScript 编译错误"
  ok "构建完成"
}

# ── 步骤 6: 启动配置向导 ─────────────────────────────────────────────────────
launch_onboard() {
  step 6 6 "启动配置向导"

  echo ""
  echo -e "${YELLOW}💡 提示：请提前准备好 LLM API Key。推荐智谱 GLM：https://open.bigmodel.cn/${NC}"
  echo -e "${YELLOW}💡 提示：向导中可选择「扫码自动创建飞书机器人」，10 秒搞定，无需手动在开放平台创建应用。${NC}"
  echo ""

  pnpm kaijibot onboard || warn "配置向导退出（可能未完成配置）"
}

# ── 完成提示 ───────────────────────────────────────────────────────────────────
show_completion() {
  echo ""
  echo -e "${BOLD}${CYAN}════════════════════════════════════════════════════════${NC}"
  echo -e "${BOLD}${GREEN}  🧠 KaijiBot 部署完成！${NC}"
  echo -e "${BOLD}${CYAN}════════════════════════════════════════════════════════${NC}"
  echo ""
  echo -e "${DIM}配置向导已完成。如向导中未启动网关，请手动启动：${NC}"
  echo ""
  echo -e "  ${BOLD}前台运行：${NC}"
  echo "    pnpm kaijibot gateway --port 18789 --verbose"
  echo ""
  echo -e "  ${BOLD}后台运行：${NC}"
  echo "    nohup pnpm kaijibot gateway --port 18789 > kaijibot.log 2>&1 &"
  echo "    # 查看日志: tail -f kaijibot.log"
}

# ── 后续步骤 ──────────────────────────────────────────────────────────────────
show_next_steps() {
  echo ""
  echo -e "${BOLD}${CYAN}📋 后续步骤${NC}"
  echo -e "${DIM}────────────────────────────────────────${NC}"
  echo ""
  echo -e "${BOLD}1. 查看日志${NC}"
  echo "   启动时加 --verbose 查看详细日志"
  echo "   日志目录: ~/.kaijibot/logs/"
  echo ""
  echo -e "${BOLD}2. 配置认知系统${NC}"
  echo "   kaijibot config set cognitive.enabled true"
  echo "   kaijibot config set cognitive.proactive.enabled true"
  echo "   kaijibot config set cognitive.proactive.minIntervalHours 4"
  echo "   kaijibot config set cognitive.proactive.activeHours \"09:00-22:00\""
  echo ""
  echo -e "${BOLD}3. systemd 服务（推荐生产环境）${NC}"
  echo "   模板文件: docs/install/kaijibot.service.template"
  echo "   cp docs/install/kaijibot.service.template /etc/systemd/system/kaijibot.service"
  echo "   # 编辑后: sudo systemctl enable --now kaijibot"
  echo ""
  echo -e "${BOLD}4. 更新版本${NC}"
  echo "   git pull origin main"
  echo "   pnpm install"
  echo "   pnpm build"
  echo ""
  echo -e "${BOLD}5. 更多文档${NC}"
  echo "   README.md — 项目介绍与快速开始"
  echo "   docs/     — 详细文档目录"
  echo ""
  echo -e "${DIM}🧠 祝你使用愉快！如有问题请在 GitHub 提 Issue。${NC}"
}

# ── 主流程 ────────────────────────────────────────────────────────────────────
main() {
  print_banner
  check_node
  check_pnpm
  setup_project
  install_deps
  build_project
  launch_onboard
  show_completion
  show_next_steps
}

main
