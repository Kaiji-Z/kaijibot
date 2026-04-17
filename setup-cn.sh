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
  echo -e "${DIM}基于 OpenClaw 精简改造 | 飞书 + 智谱 GLM${NC}"
  echo -e "${DIM}从源码一键部署，无需 Docker${NC}"
  echo ""
}

# ── 步骤 1: 检查 Node.js ─────────────────────────────────────────────────────
check_node() {
  step 1 7 "检查 Node.js 环境"

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

  local node_version
  node_version=$(node -v | sed 's/^v//' | cut -d. -f1)

  if [[ "$node_version" -lt 22 ]]; then
    local full_version
    full_version=$(node -v)
    warn "Node.js 版本过低: ${full_version}（需要 ≥ 22）"
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
  step 2 7 "检查 pnpm"

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
  step 3 7 "准备项目代码"

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
  step 4 7 "安装依赖"

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
  step 5 7 "构建项目"

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

# ── 步骤 6: 配置环境变量 ─────────────────────────────────────────────────────
configure_env() {
  step 6 7 "配置环境变量"

  local env_file=".env"

  # 如果 .env 已存在且包含 ZAI_API_KEY，跳过
  if [[ -f "$env_file" ]] && grep -q "^ZAI_API_KEY=." "$env_file" 2>/dev/null; then
    ok ".env 已配置，跳过（如需修改请编辑 ${env_file}）"
    return 0
  fi

  # 从 .env.example 复制模板
  if [[ -f ".env.example" ]]; then
    cp .env.example "$env_file"
    info "已从 .env.example 创建 .env"
  else
    # 手动创建最小化 .env
    cat > "$env_file" <<'ENVEOF'
# KaijiBot 环境变量配置
# 由 setup-cn.sh 自动生成

# 网关认证 Token
KAIJIBOT_GATEWAY_TOKEN=

# Z.AI API Key（必填）
ZAI_API_KEY=

# 网络搜索（可选）
# EXA_API_KEY=
# TAVILY_API_KEY=
ENVEOF
    info "已创建 .env 模板"
  fi

  echo ""
  # ── Z.AI API Key ──
  echo -e "${BOLD}🔑 Z.AI（智谱 GLM）API Key${NC}"
  echo -e "${DIM}   获取地址: https://open.bigmodel.cn/${NC}"
  echo -e "${DIM}   注册后进入「API Keys」页面创建密钥${NC}"
  local zai_key=""
  ask_value "请输入 Z.AI API Key: " "zai_key" true
  sed -i "s|^ZAI_API_KEY=.*|ZAI_API_KEY=${zai_key}|" "$env_file"
  ok "Z.AI API Key 已写入"

  # ── Gateway Token ──
  local gateway_token
  if command -v openssl &>/dev/null; then
    gateway_token=$(openssl rand -hex 32)
  else
    gateway_token="kaijibot-$(date +%s)-$RANDOM$RANDOM$RANDOM"
    warn "openssl 不可用，已生成简单 Token（建议安装 openssl 后重新生成）"
  fi
  sed -i "s|^KAIJIBOT_GATEWAY_TOKEN=.*|KAIJIBOT_GATEWAY_TOKEN=${gateway_token}|" "$env_file"
  ok "Gateway Token 已自动生成"

  # ── 网络搜索（可选）──
  echo ""
  echo -e "${BOLD}🔍 网络搜索 API（可选，用于增强洞察时效性）${NC}"
  echo -e "${DIM}   不配置也能正常使用，但洞察内容不会包含实时信息${NC}"

  if ask_yes_no "是否配置网络搜索 API？"; then
    local exa_key=""
    echo ""
    echo -e "${DIM}   Exa: 高质量语义搜索 (https://exa.ai/)${NC}"
    if ask_yes_no "配置 Exa API Key？" "N"; then
      ask_value "请输入 Exa API Key（留空跳过）: " "exa_key" false
      if [[ -n "$exa_key" ]]; then
        sed -i "s|^# EXA_API_KEY=.*|EXA_API_KEY=${exa_key}|" "$env_file"
        ok "Exa API Key 已写入"
      fi
    fi

    local tavily_key=""
    echo ""
    echo -e "${DIM}   Tavily: AI 摘要搜索 (https://tavily.com/)${NC}"
    if ask_yes_no "配置 Tavily API Key？" "N"; then
      ask_value "请输入 Tavily API Key（留空跳过）: " "tavily_key" false
      if [[ -n "$tavily_key" ]]; then
        sed -i "s|^# TAVILY_API_KEY=.*|TAVILY_API_KEY=${tavily_key}|" "$env_file"
        ok "Tavily API Key 已写入"
      fi
    fi
  fi

  echo ""
  ok "环境变量配置完成 → ${env_file}"
}

# ── 步骤 7: 配置飞书 ─────────────────────────────────────────────────────────
configure_feishu() {
  step 7 7 "配置飞书机器人"

  if [[ "$SKIP_FEISHU" == true ]]; then
    warn "已跳过飞书配置（--skip-feishu）"
    return 0
  fi

  echo -e "${BOLD}📡 飞书应用配置${NC}"
  echo -e "${DIM}   开放平台: https://open.feishu.cn/${NC}"
  echo -e "${DIM}   创建企业自建应用 → 获取 App ID 和 App Secret${NC}"
  echo -e "${DIM}   机器人能力 → 开启「机器人」${NC}"
  echo ""

  if ! ask_yes_no "是否现在配置飞书？（可稍后手动配置）"; then
    warn "跳过飞书配置"
    info "稍后可通过以下命令配置："
    echo "  kaijibot config set channels.feishu.appId \"你的AppID\""
    echo "  kaijibot config set channels.feishu.appSecret \"你的AppSecret\""
    return 0
  fi

  local app_id="" app_secret=""
  ask_value "请输入飞书 App ID: " "app_id" false
  ask_value "请输入飞书 App Secret: " "app_secret" false

  if [[ -n "$app_id" && -n "$app_secret" ]]; then
    pnpm kaijibot config set channels.feishu.appId "$app_id" 2>/dev/null || \
      warn "kaijibot config 命令失败，请手动配置"
    pnpm kaijibot config set channels.feishu.appSecret "$app_secret" 2>/dev/null || \
      warn "kaijibot config 命令失败，请手动配置"
    ok "飞书配置完成"
  else
    warn "未输入完整信息，飞书未配置"
    info "稍后请手动运行："
    echo "  kaijibot config set channels.feishu.appId \"你的AppID\""
    echo "  kaijibot config set channels.feishu.appSecret \"你的AppSecret\""
  fi
}

# ── 启动网关 ──────────────────────────────────────────────────────────────────
start_gateway() {
  echo ""
  echo -e "${BOLD}${CYAN}════════════════════════════════════════${NC}"
  echo -e "${BOLD}${GREEN}  🧠 KaijiBot 部署完成！${NC}"
  echo -e "${BOLD}${CYAN}════════════════════════════════════════${NC}"
  echo ""

  if ask_yes_no "是否现在启动网关？"; then
    echo ""
    info "正在启动 KaijiBot Gateway..."
    echo -e "${DIM}按 Ctrl+C 停止${NC}"
    echo ""
    exec pnpm kaijibot gateway --port 18789 --verbose
  else
    echo ""
    info "手动启动方式："
    echo ""
    echo -e "  ${BOLD}前台运行：${NC}"
    echo "    pnpm kaijibot gateway --port 18789 --verbose"
    echo ""
    echo -e "  ${BOLD}后台运行：${NC}"
    echo "    nohup pnpm kaijibot gateway --port 18789 > kaijibot.log 2>&1 &"
    echo "    # 查看日志: tail -f kaijibot.log"
    echo ""
    echo -e "  ${BOLD}systemd 服务（推荐生产环境）：${NC}"
    echo "    # 创建 /etc/systemd/system/kaijibot.service"
    echo "    # 参考文档: docs/ 目录下的部署指南"
  fi
}

# ── 后续步骤 ──────────────────────────────────────────────────────────────────
show_next_steps() {
  echo ""
  echo -e "${BOLD}${CYAN}📋 后续步骤${NC}"
  echo -e "${DIM}────────────────────────────────────────${NC}"
  echo ""
  echo -e "${BOLD}1. 配置飞书机器人${NC}"
  echo "   开放平台: https://open.feishu.cn/"
  echo "   事件订阅 URL: http://<你的IP>:18789/feishu/webhook"
  echo "   需要订阅的事件：im.message.receive_v1"
  echo ""
  echo -e "${BOLD}2. 查看日志${NC}"
  echo "   启动时加 --verbose 查看详细日志"
  echo "   日志目录: ~/.kaijibot/logs/"
  echo ""
  echo -e "${BOLD}3. 配置认知系统${NC}"
  echo "   kaijibot config set cognitive.enabled true"
  echo "   kaijibot config set cognitive.proactive.enabled true"
  echo "   kaijibot config set cognitive.proactive.minIntervalHours 4"
  echo "   kaijibot config set cognitive.proactive.activeHours \"09:00-22:00\""
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
  configure_env
  configure_feishu
  show_next_steps
  start_gateway
}

main
