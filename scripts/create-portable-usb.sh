#!/usr/bin/env bash
# ═══════════════════════════════════════════════
# KaijiBot 便携版 U盘 制作脚本
# 
# 用法：
#   1. 插上 USB 3.0 U盘
#   2. 在 WSL 中运行：bash scripts/create-portable-usb.sh /mnt/e
#   3. 等待完成（USB 3.0 约 5 分钟，USB 2.0 约 30 分钟）
# ═══════════════════════════════════════════════
set -euo pipefail

USB_ROOT="${1:-/mnt/e}"

# 颜色
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
info()  { echo -e "${CYAN}ℹ${NC} $*"; }
ok()    { echo -e "${GREEN}✓${NC} $*"; }
fail()  { echo -e "${RED}✘${NC} $*"; exit 1; }
step()  { echo -e "\n${BOLD}${CYAN}[$1/$TOTAL] $2${NC}"; }

TOTAL=5

# ── 检查 U盘 ──
step 1 "检查 U盘"
[ -d "$USB_ROOT" ] || fail "U盘 路径不存在: $USB_ROOT"
[ -w "$USB_ROOT" ] || fail "U盘 不可写: $USB_ROOT"
ok "U盘 就绪: $USB_ROOT"

# ── 准备目录 ──
mkdir -p "$USB_ROOT/archives" "$USB_ROOT/config"

# ── 步骤 2: 下载 Node.js ──
step 2 "下载 Node.js Windows 二进制"
NODE_ZIP="$USB_ROOT/archives/node-win-x64.zip"
if [ -f "$NODE_ZIP" ] && [ $(stat -c%s "$NODE_ZIP" 2>/dev/null || echo 0) -gt 30000000 ]; then
    ok "已存在，跳过"
else
    NODE_VERSION=$(curl -s https://nodejs.org/dist/index.json | python3 -c "
import json,sys
data=json.load(sys.stdin)
versions=[v['version'] for v in data if v['version'].startswith('v22.') and v['lts']]
print(versions[0] if versions else 'v22.11.0')
" 2>/dev/null || echo "v22.11.0")
    info "Node.js 版本: $NODE_VERSION"
    curl -L -o "$NODE_ZIP" "https://nodejs.org/dist/${NODE_VERSION}/node-${NODE_VERSION}-win-x64.zip"
    ok "下载完成: $(ls -lh "$NODE_ZIP" | awk '{print $5}')"
fi

# ── 步骤 3: 在 Windows 侧安装 KaijiBot（获取 Windows 原生模块）──
step 3 "安装 KaijiBot（Windows 原生模块）"
KAIJI_TAR="$USB_ROOT/archives/kaijibot-offline.tar"
if [ -f "$KAIJI_TAR" ] && [ $(stat -c%s "$KAIJI_TAR" 2>/dev/null || echo 0) -gt 600000000 ]; then
    ok "已存在，跳过"
else
    BUILD_DIR="C:\\temp\\kaijibot-usb-build"
    info "在 C 盘创建临时构建目录（SSD 速度快）..."
    
    # 解压 Node.js 到 C:\temp
    powershell.exe -Command "
        New-Item -ItemType Directory -Force -Path 'C:\temp\node-usb' | Out-Null
        Expand-Archive -Path '$USB_ROOT/archives/node-win-x64.zip' -DestinationPath 'C:\temp\node-usb' -Force
    " 2>/dev/null
    
    NODE_DIR=$(powershell.exe -Command "(Get-ChildItem 'C:\temp\node-usb' -Directory | Select-Object -First 1).FullName" 2>/dev/null | tr -d '\r')
    NPM_CMD="$NODE_DIR\\npm.cmd"
    NODE_EXE="$NODE_DIR\\node.exe"
    
    info "清理旧构建..."
    powershell.exe -Command "Remove-Item '$BUILD_DIR' -Recurse -Force -ErrorAction SilentlyContinue" 2>/dev/null
    powershell.exe -Command "New-Item -ItemType Directory -Force -Path '$BUILD_DIR' | Out-Null" 2>/dev/null
    
    info "npm install（获取 Windows 原生模块，约 5-10 分钟）..."
    powershell.exe -Command "
        Set-Location '$BUILD_DIR'
        & '$NPM_CMD' install 'kaijibot@latest' '--omit=dev' 2>&1
    " 2>/dev/null
    
    # 验证安装
    KAIJI_ENTRY="$BUILD_DIR\\node_modules\\kaijibot\\dist\\index.js"
    powershell.exe -Command "
        if (-not (Test-Path '$KAIJI_ENTRY')) { Write-Error 'KaijiBot install failed'; exit 1 }
        & '$NODE_EXE' '$KAIJI_ENTRY' --version
    " 2>/dev/null | tr -d '\r' | while read -r line; do ok "$line"; done
    
    info "打包（不压缩，解包速度快）..."
    powershell.exe -Command "
        tar cf '$KAIJI_TAR' -C '$BUILD_DIR' node_modules
    " 2>/dev/null
    ok "打包完成: $(ls -lh "$KAIJI_TAR" | awk '{print $5}')"
    
    # 清理 C 盘临时文件
    info "清理 C 盘临时文件..."
    powershell.exe -Command "Remove-Item '$BUILD_DIR' -Recurse -Force -ErrorAction SilentlyContinue; Remove-Item 'C:\temp\node-usb' -Recurse -Force -ErrorAction SilentlyContinue" 2>/dev/null
    ok "C 盘已清理"
fi

# ── 步骤 4: 写入启动器 ──
step 4 "写入启动器"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# KaijiBot.bat
cat > "$USB_ROOT/KaijiBot.bat" << 'BATEOF'
@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion

set "USB_ROOT=%~dp0"
set "USB_ROOT=%USB_ROOT:~0,-1%"
set "CONFIG_DIR=%USB_ROOT%\config"
set "KAIJI_DIR=%USB_ROOT%\kaijibot"
set "NODE_DIR=%USB_ROOT%\node"
set "NODE_EXE=%NODE_DIR%\node.exe"

set "KAIJIBOT_STATE_DIR=%CONFIG_DIR%"
set "KAIJIBOT_HOME=%CONFIG_DIR%"

if not exist "%CONFIG_DIR%" mkdir "%CONFIG_DIR%"

if not exist "%NODE_EXE%" (
    echo.
    echo  [1/3] 解包 Node.js...
    mkdir "%NODE_DIR%" 2>nul
    tar xf "%USB_ROOT%\archives\node-win-x64.zip" -C "%NODE_DIR%" --strip-components=1
    if not exist "%NODE_EXE%" ( echo  失败 & pause & exit /b 1 )
    echo  OK
)

set "KAIJI_ENTRY=%KAIJI_DIR%\node_modules\kaijibot\dist\index.js"
if not exist "%KAIJI_ENTRY%" (
    echo.
    echo  [2/3] 解包 KaijiBot + 依赖（约 1-2 分钟）...
    mkdir "%KAIJI_DIR%" 2>nul
    cd /d "%KAIJI_DIR%"
    tar xf "%USB_ROOT%\archives\kaijibot-offline.tar"
    if not exist "%KAIJI_ENTRY%" ( echo  失败 & pause & exit /b 1 )
    echo  OK
    cd /d "%USB_ROOT%"
)

if not exist "%CONFIG_DIR%\kaijibot.json" (
    echo.
    echo  [3/3] 首次配置...
    echo.
    echo  准备好：1. API Key（推荐 open.bigmodel.cn）2. 飞书账号
    echo.
    pause
    "%NODE_EXE%" "%KAIJI_ENTRY%" onboard
    if errorlevel 1 ( echo  未完成 & pause & exit /b 1 )
)

echo.
echo  KaijiBot 启动中...
echo  网关: http://localhost:18789
echo.

"%NODE_EXE%" "%KAIJI_ENTRY%" gateway --port 18789 --verbose
pause
BATEOF
ok "KaijiBot.bat"

# README.txt
cat > "$USB_ROOT/README.txt" << 'READMEEOF'
KaijiBot 便携版 — Windows 完全离线安装

使用方法：双击 KaijiBot.bat

首次使用（约 2 分钟，离线安装）：
  1. 解包 Node.js（10 秒）
  2. 解包 KaijiBot + 依赖（1-2 分钟）
  3. 配置向导（需联网注册 API Key）

之后：双击即用，3 秒启动。
换电脑：拔了插上就行，配置跟着 U盘 走。

系统要求：Windows 10+
READMEEOF
ok "README.txt"

# ── 步骤 5: 验证 ──
step 5 "验证"
echo ""
echo "  U盘 内容:"
ls -lh "$USB_ROOT/KaijiBot.bat" "$USB_ROOT/README.txt" 2>/dev/null | awk '{print "   " $5 "  " $9}'
ls -lh "$USB_ROOT/archives/" 2>/dev/null | awk '{print "   " $5 "  " $9}'
echo ""
echo "  总大小: $(du -sh "$USB_ROOT/" 2>/dev/null | awk '{print $1}' || echo '未知')"
echo ""
ok "完成！双击 KaijiBot.bat 即可使用。"
