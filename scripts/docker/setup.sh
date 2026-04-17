#!/bin/bash
# 🧠 KaijiBot Docker 一键部署脚本
# 面向中国开发者 — 一条命令启动你的主动型 AI 助手
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# 🧠 KaijiBot 标识
print_banner() {
  echo -e "${CYAN}"
  echo "  🧠 KaijiBot — 主动型 AI 私人助手"
  echo "  Docker 一键部署"
  echo -e "${NC}"
}

print_step() {
  echo -e "\n${BOLD}${BLUE}>>> $1${NC}\n"
}

print_success() {
  echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
  echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
  echo -e "${RED}❌ $1${NC}"
}

die() {
  print_error "$1"
  exit 1
}

# ── 前置检查 ──────────────────────────────────────────────────
check_prerequisites() {
  print_step "检查前置依赖..."

  # 检查 Docker
  if ! command -v docker &>/dev/null; then
    echo -e "${RED}未检测到 Docker，请先安装 Docker。${NC}"
    echo ""
    echo "Ubuntu/Debian 安装方法："
    echo "  curl -fsSL https://get.docker.com | sh"
    echo "  sudo usermod -aG docker \$USER"
    echo "  # 重新登录终端使 docker 组生效"
    echo ""
    echo "CentOS/RHEL 安装方法："
    echo "  sudo yum install -y yum-utils"
    echo "  sudo yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo"
    echo "  sudo yum install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin"
    echo "  sudo systemctl enable --now docker"
    echo ""
    echo "macOS 安装方法："
    echo "  brew install --cask docker"
    echo "  # 或从 https://www.docker.com/products/docker-desktop 下载"
    echo ""
    echo "Arch Linux 安装方法："
    echo "  sudo pacman -S docker docker-compose-plugin"
    echo "  sudo systemctl enable --now docker"
    echo ""
    die "请安装 Docker 后重新运行此脚本。"
  fi

  # 检查 Docker 守护进程是否运行
  if ! docker info &>/dev/null; then
    die "Docker 守护进程未运行。请先启动 Docker（sudo systemctl start docker 或打开 Docker Desktop）。"
  fi

  # 检查 Docker Compose（支持 docker compose 和 docker-compose 两种形式）
  local compose_cmd=""
  if docker compose version &>/dev/null 2>&1; then
    compose_cmd="docker compose"
  elif command -v docker-compose &>/dev/null; then
    compose_cmd="docker-compose"
  else
    echo -e "${RED}未检测到 Docker Compose。${NC}"
    echo ""
    echo "安装方法（推荐使用 Docker Compose V2 插件）："
    echo "  Ubuntu/Debian: sudo apt install docker-compose-plugin"
    echo "  CentOS/RHEL:   sudo yum install docker-compose-plugin"
    echo "  macOS:         Docker Desktop 自带"
    echo "  通用:          mkdir -p ~/.docker/cli-plugins && curl -SL https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64 -o ~/.docker/cli-plugins/docker-compose && chmod +x ~/.docker/cli-plugins/docker-compose"
    echo ""
    die "请安装 Docker Compose 后重新运行此脚本。"
  fi

  print_success "Docker 和 Docker Compose 已就绪"
}

# 获取 docker compose 命令
get_compose_cmd() {
  if docker compose version &>/dev/null 2>&1; then
    echo "docker compose"
  else
    echo "docker-compose"
  fi
}

# ── 创建环境文件 ──────────────────────────────────────────────
create_env_file() {
  print_step "配置环境变量..."

  local env_file="$PROJECT_ROOT/.env"

  if [[ -f "$env_file" ]]; then
    # 检查必要的变量是否已设置
    local zai_key=""
    local gateway_token=""

    if [[ -f "$env_file" ]]; then
      zai_key=$(grep -E "^ZAI_API_KEY=" "$env_file" 2>/dev/null | head -1 | cut -d'=' -f2- || true)
      gateway_token=$(grep -E "^KAIJIBOT_GATEWAY_TOKEN=" "$env_file" 2>/dev/null | head -1 | cut -d'=' -f2- || true)
    fi

    if [[ -n "$zai_key" && "$zai_key" != "your-zai-api-key" && "$zai_key" != "change-me-to-a-long-random-token" ]]; then
      print_success ".env 文件已存在，ZAI_API_KEY 已配置"
      return 0
    fi
    echo -e "${YELLOW}.env 文件已存在但 ZAI_API_KEY 未配置。${NC}"
  else
    # 从 .env.example 创建
    if [[ -f "$PROJECT_ROOT/.env.example" ]]; then
      cp "$PROJECT_ROOT/.env.example" "$env_file"
      print_success "已从 .env.example 创建 .env 文件"
    else
      # 没有 .env.example 则创建最小的 .env
      cat > "$env_file" <<'ENVEOF'
# KaijiBot 环境变量
ZAI_API_KEY=your-zai-api-key
KAIJIBOT_GATEWAY_TOKEN=change-me-to-a-long-random-token
KAIJIBOT_CONFIG_DIR=
KAIJIBOT_WORKSPACE_DIR=
ENVEOF
      print_success "已创建最小 .env 文件"
    fi
  fi

  # 交互式配置
  echo ""
  echo -e "${BOLD}请配置以下必要参数：${NC}"
  echo ""

  # ZAI_API_KEY
  local current_zai=""
  if [[ -f "$env_file" ]]; then
    current_zai=$(grep -E "^ZAI_API_KEY=" "$env_file" 2>/dev/null | head -1 | cut -d'=' -f2- || true)
  fi
  if [[ -z "$current_zai" || "$current_zai" == "your-zai-api-key" ]]; then
    echo -e "${CYAN}🧠 Z.AI API Key（必需）${NC}"
    echo "  获取地址: https://open.bigmodel.cn/"
    read -rp "  请输入你的 Z.AI API Key: " zai_input
    if [[ -n "$zai_input" ]]; then
      update_env_var "$env_file" "ZAI_API_KEY" "$zai_input"
    else
      print_warning "未设置 Z.AI_API_KEY，KaijiBot 将无法启动。请稍后手动编辑 .env 文件。"
    fi
  fi

  # KAIJIBOT_GATEWAY_TOKEN — 自动生成
  local current_token=""
  if [[ -f "$env_file" ]]; then
    current_token=$(grep -E "^KAIJIBOT_GATEWAY_TOKEN=" "$env_file" 2>/dev/null | head -1 | cut -d'=' -f2- || true)
  fi
  if [[ -z "$current_token" || "$current_token" == "change-me-to-a-long-random-token" ]]; then
    local auto_token
    auto_token=$(openssl rand -hex 32 2>/dev/null || echo "kaijibot-$(date +%s)-$$")
    update_env_var "$env_file" "KAIJIBOT_GATEWAY_TOKEN" "$auto_token"
    print_success "已自动生成 KAIJIBOT_GATEWAY_TOKEN"
  fi

  # 可选的搜索 API
  echo ""
  echo -e "${CYAN}可选：配置网络搜索（让洞察具备实时性）${NC}"
  echo "  不配置也完全可以正常使用，只是洞察不会引用最新网络信息。"
  read -rp "  EXA_API_KEY（留空跳过）: " exa_input
  if [[ -n "$exa_input" ]]; then
    update_env_var "$env_file" "EXA_API_KEY" "$exa_input"
  fi

  read -rp "  TAVILY_API_KEY（留空跳过）: " tavily_input
  if [[ -n "$tavily_input" ]]; then
    update_env_var "$env_file" "TAVILY_API_KEY" "$tavily_input"
  fi

  # 设置 Docker 卷路径
  local config_dir="$HOME/.kaijibot"
  local workspace_dir="$HOME/.kaijibot/workspace"
  update_env_var "$env_file" "KAIJIBOT_CONFIG_DIR" "$config_dir"
  update_env_var "$env_file" "KAIJIBOT_WORKSPACE_DIR" "$workspace_dir"

  print_success "环境变量配置完成"
}

# 更新 .env 文件中的变量
update_env_var() {
  local file="$1"
  local key="$2"
  local value="$3"

  if grep -q "^${key}=" "$file" 2>/dev/null; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$file"
  else
    echo "${key}=${value}" >> "$file"
  fi
}

# ── 创建配置目录 ──────────────────────────────────────────────
create_config_dirs() {
  print_step "创建配置目录..."

  local config_dir="$HOME/.kaijibot"
  local workspace_dir="$HOME/.kaijibot/workspace"

  mkdir -p "$config_dir"
  mkdir -p "$workspace_dir"

  print_success "配置目录已就绪: $config_dir"
}

# ── 构建镜像 ──────────────────────────────────────────────────
build_image() {
  print_step "构建 KaijiBot Docker 镜像（首次构建约需 5-10 分钟）..."

  local extensions="feishu zai openai ollama lmstudio exa tavily browser memory-core memory-lancedb memory-wiki speech-core talk-voice media-understanding-core image-generation-core diffs llm-task device-pair webhooks shared"

  cd "$PROJECT_ROOT"

  docker build \
    --build-arg "KAIJIBOT_EXTENSIONS=${extensions}" \
    -t kaijibot:local \
    . || die "镜像构建失败。请检查上方错误信息。"

  print_success "KaijiBot 镜像构建完成 (kaijibot:local)"
}

# ── 启动网关 ──────────────────────────────────────────────────
start_gateway() {
  print_step "启动 KaijiBot 网关..."

  cd "$PROJECT_ROOT"

  local compose_cmd
  compose_cmd=$(get_compose_cmd)

  $compose_cmd up -d || die "容器启动失败。请运行 'docker compose logs' 查看日志。"

  print_success "KaijiBot 网关已启动"
}

# ── 显示状态 ──────────────────────────────────────────────────
show_status() {
  print_step "KaijiBot 运行状态"

  cd "$PROJECT_ROOT"

  local compose_cmd
  compose_cmd=$(get_compose_cmd)

  # 容器状态
  echo -e "${BOLD}容器状态：${NC}"
  $compose_cmd ps
  echo ""

  # 端口信息
  local gateway_port=""
  local bridge_port=""
  if [[ -f "$PROJECT_ROOT/.env" ]]; then
    gateway_port=$(grep -E "^KAIJIBOT_GATEWAY_PORT=" "$PROJECT_ROOT/.env" 2>/dev/null | head -1 | cut -d'=' -f2- || true)
    bridge_port=$(grep -E "^KAIJIBOT_BRIDGE_PORT=" "$PROJECT_ROOT/.env" 2>/dev/null | head -1 | cut -d'=' -f2- || true)
  fi
  gateway_port="${gateway_port:-18789}"
  bridge_port="${bridge_port:-18790}"

  echo -e "${BOLD}服务端口：${NC}"
  echo "  🧠 网关地址: http://localhost:${gateway_port}"
  echo "  📡 桥接端口: http://localhost:${bridge_port}"
  echo ""

  # 健康检查
  echo -e "${BOLD}健康检查：${NC}"
  if curl -sf "http://localhost:${gateway_port}/healthz" >/dev/null 2>&1; then
    print_success "网关健康检查通过"
  else
    print_warning "网关尚未就绪，请等待几秒后重试（容器正在启动中...）"
  fi
  echo ""

  # 下一步指引
  echo -e "${BOLD}${CYAN}═══════════════════════════════════════════${NC}"
  echo -e "${BOLD}${CYAN}  🧠 下一步操作${NC}"
  echo -e "${BOLD}${CYAN}═══════════════════════════════════════════${NC}"
  echo ""
  echo -e "${BOLD}1. 配置飞书机器人${NC}"
  echo "   在飞书开放平台创建机器人后，运行以下命令配置："
  echo ""
  echo "   ${CYAN}docker exec kaijibot-gateway-kaijibot-gateway-1 \\"
  echo "     node dist/index.js config set channels.feishu.appId \"你的 AppID\"${NC}"
  echo ""
  echo "   ${CYAN}docker exec kaijibot-gateway-kaijibot-gateway-1 \\"
  echo "     node dist/index.js config set channels.feishu.appSecret \"你的 AppSecret\"${NC}"
  echo ""
  echo "   飞书开放平台: https://open.feishu.cn/"
  echo ""
  echo -e "${BOLD}2. 查看日志${NC}"
  echo "   ${CYAN}${compose_cmd} logs -f${NC}"
  echo ""
  echo -e "${BOLD}3. 停止服务${NC}"
  echo "   ${CYAN}bash scripts/docker/setup.sh --stop${NC}"
  echo ""
  echo -e "${BOLD}4. 重启服务${NC}"
  echo "   ${CYAN}bash scripts/docker/setup.sh --restart${NC}"
  echo ""
  echo -e "详细文档请查看 ${BOLD}DOCKER.md${NC}"
  echo ""
}

# ── 停止容器 ──────────────────────────────────────────────────
stop_gateway() {
  print_step "停止 KaijiBot..."

  cd "$PROJECT_ROOT"

  local compose_cmd
  compose_cmd=$(get_compose_cmd)

  $compose_cmd down || die "停止容器失败。"

  print_success "KaijiBot 已停止"
}

# ── 重启容器 ──────────────────────────────────────────────────
restart_gateway() {
  print_step "重启 KaijiBot..."

  cd "$PROJECT_ROOT"

  local compose_cmd
  compose_cmd=$(get_compose_cmd)

  $compose_cmd restart || die "重启容器失败。"

  print_success "KaijiBot 已重启"
  show_status
}

# ── 帮助信息 ──────────────────────────────────────────────────
show_help() {
  print_banner
  echo "用法: bash scripts/docker/setup.sh [选项]"
  echo ""
  echo "选项:"
  echo "  (无参数)       完整部署流程（检查依赖 → 配置环境 → 构建 → 启动 → 显示状态）"
  echo "  --build-only   仅构建 Docker 镜像，不启动服务"
  echo "  --restart      重启 KaijiBot 容器"
  echo "  --stop         停止 KaijiBot 容器"
  echo "  --status       显示运行状态和端口信息"
  echo "  --help         显示此帮助信息"
  echo ""
  echo "示例:"
  echo "  bash scripts/docker/setup.sh              # 首次一键部署"
  echo "  bash scripts/docker/setup.sh --status     # 查看运行状态"
  echo "  bash scripts/docker/setup.sh --stop       # 停止服务"
  echo "  bash scripts/docker/setup.sh --build-only # 重新构建镜像"
  echo ""
  echo "详细文档: DOCKER.md"
}

# ── 主流程 ────────────────────────────────────────────────────
main() {
  local action="${1:-}"

  case "$action" in
    --help|-h)
      show_help
      exit 0
      ;;
    --status)
      print_banner
      show_status
      exit 0
      ;;
    --stop)
      print_banner
      stop_gateway
      exit 0
      ;;
    --restart)
      print_banner
      restart_gateway
      exit 0
      ;;
    --build-only)
      print_banner
      check_prerequisites
      create_config_dirs
      build_image
      echo ""
      print_success "构建完成。运行 'bash scripts/docker/setup.sh' 启动服务。"
      exit 0
      ;;
    "")
      # 完整部署流程
      print_banner
      check_prerequisites
      create_env_file
      create_config_dirs
      build_image
      start_gateway
      echo ""
      sleep 3
      show_status
      exit 0
      ;;
    *)
      print_error "未知选项: $action"
      show_help
      exit 1
      ;;
  esac
}

main "$@"
