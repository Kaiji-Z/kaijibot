# 🧠 KaijiBot Docker 部署指南

面向中国开发者的一键 Docker 部署方案。

## 前置要求

| 依赖 | 说明 |
|------|------|
| Docker | 20.10+，[安装指南](https://docs.docker.com/engine/install/) |
| Docker Compose | V2 插件（推荐）或独立版 |
| Z.AI API Key | [https://open.bigmodel.cn/](https://open.bigmodel.cn/) 注册获取 |
| 飞书机器人 | [https://open.feishu.cn/](https://open.feishu.cn/) 创建企业自建应用 |

### 快速安装 Docker

Ubuntu/Debian:
```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# 重新登录终端
```

macOS:
```bash
brew install --cask docker
```

## 一键启动

```bash
git clone <你的仓库地址>
cd KaijiBot
bash scripts/docker/setup.sh
```

脚本会自动完成：检查依赖 → 创建 .env → 构建镜像 → 启动服务 → 显示状态。

首次构建约需 5-10 分钟，后续启动只需几秒。

## 配置飞书频道

服务启动后，需要配置飞书机器人的 appId 和 appSecret：

```bash
# 查找容器名称
docker ps

# 设置飞书配置（替换容器名和实际值）
docker exec <容器名> node dist/index.js config set channels.feishu.appId "你的AppID"
docker exec <容器名> node dist/index.js config set channels.feishu.appSecret "你的AppSecret"
```

设置后容器会自动热重载配置，无需重启。

## 常用命令

```bash
# 一键部署（首次或重新部署）
bash scripts/docker/setup.sh

# 仅构建镜像（不启动）
bash scripts/docker/setup.sh --build-only

# 查看运行状态
bash scripts/docker/setup.sh --status

# 重启服务
bash scripts/docker/setup.sh --restart

# 停止服务
bash scripts/docker/setup.sh --stop

# 查看实时日志
docker compose logs -f

# 查看最近 100 行日志
docker compose logs --tail 100
```

## 环境变量

所有变量在 `.env` 文件中配置（首次运行脚本会自动创建）。

### 必需

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `ZAI_API_KEY` | 智谱 GLM API Key | 无（必须设置） |
| `KAIJIBOT_GATEWAY_TOKEN` | 网关认证令牌 | 自动生成 |

### 可选

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `EXA_API_KEY` | Exa 语义搜索（增强洞察实时性） | 无 |
| `TAVILY_API_KEY` | Tavily 搜索（增强洞察实时性） | 无 |
| `KAIJIBOT_GATEWAY_PORT` | 网关端口 | `18789` |
| `KAIJIBOT_BRIDGE_PORT` | 桥接端口 | `18790` |
| `KAIJIBOT_TZ` | 时区 | `Asia/Shanghai` |

### 数据卷

| 宿主路径 | 容器路径 | 说明 |
|----------|----------|------|
| `~/.kaijibot/` | `/home/node/.kaijibot` | 配置、凭证、认知画像 |
| `~/.kaijibot/workspace/` | `/home/node/.kaijibot/workspace` | 工作空间 |

## 故障排查

### 容器启动失败

```bash
# 查看错误日志
docker compose logs

# 检查 .env 是否配置正确
cat .env | grep -v "^#" | grep -v "^$"
```

### ZAI_API_KEY 未设置

编辑 `.env` 文件，设置有效的 API Key：
```bash
ZAI_API_KEY=你的实际Key
```

### 端口被占用

在 `.env` 中修改端口：
```bash
KAIJIBOT_GATEWAY_PORT=28789
KAIJIBOT_BRIDGE_PORT=28790
```

### 权限问题

```bash
# 确保 Docker 守护进程运行
sudo systemctl start docker

# 确保当前用户在 docker 组
sudo usermod -aG docker $USER
# 重新登录终端
```

### 飞书连接不上

1. 确认 appId 和 appSecret 已正确设置
2. 在飞书开放平台确认：事件订阅已开启、机器人已发布
3. 网关需要公网可达（或使用飞书的 WebSocket 长连接模式）

### 重新构建

当更新代码后需要重新构建镜像：
```bash
bash scripts/docker/setup.sh --build-only
docker compose up -d
```

## 手动部署（不用脚本）

```bash
# 1. 创建 .env
cp .env.example .env
# 编辑 .env 填入 ZAI_API_KEY

# 2. 构建镜像
docker build \
  --build-arg KAIJIBOT_EXTENSIONS="feishu zai openai ollama lmstudio exa tavily browser memory-core memory-lancedb memory-wiki speech-core talk-voice media-understanding-core image-generation-core diffs llm-task device-pair webhooks shared" \
  -t kaijibot:local .

# 3. 启动
KAIJIBOT_CONFIG_DIR=~/.kaijibot \
KAIJIBOT_WORKSPACE_DIR=~/.kaijibot/workspace \
docker compose up -d
```
