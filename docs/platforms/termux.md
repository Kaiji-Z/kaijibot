---
summary: "在 Android 手机的 Termux 终端中部署 KaijiBot，实现 24/7 在线"
read_when:
  - 想在 Android 手机上运行 KaijiBot
  - Termux 环境配置或保活问题
  - Android 开机自启设置
title: "Termux 部署"
---

# Termux 部署

## 概述

KaijiBot 可以在 Android 手机的 Termux 终端模拟器中运行。把一台闲置手机变成 24/7 在线的 AI 助手，不需要额外的服务器。只要手机有网络，KaijiBot 就能通过飞书收发消息、主动推送洞察。

> **注意**：本文档介绍的是 Termux 方案。`docs/platforms/android.md` 描述的是 KaijiBot 原生 Android 伴侣 App（尚未发布），两者是完全不同的使用方式。

## 准备工作

**Termux 安装**：从 F-Droid 安装，不要用 Google Play 版本（Play 版已废弃，版本滞后且不接收更新）。

下载地址：https://f-droid.org/packages/com.termux/

**设备要求**：

| 要求         | 最低配置         |
| ------------ | ---------------- |
| Android 版本 | 7.0+             |
| RAM          | 4GB              |
| 存储         | 2GB 可用空间     |
| 网络         | 需要稳定网络连接 |

## 一键安装

推荐用一键脚本，自动完成所有配置：

```bash
curl -fsSL https://gitee.com/kaiji1126/kaijibot/raw/main/scripts/install-termux.sh | bash
```

如果手动安装后需要配置开机自启和保活，运行：

```bash
kaijibot android-install
```

## 手动安装步骤

如果不想用一键脚本，可以按以下步骤手动操作：

```bash
# 1. 更新包管理器并安装依赖
pkg update && pkg install nodejs-lts imagemagick ffmpeg

# 2. 安装 KaijiBot
npm install -g kaijibot --force

# 3. 安装图片处理库（WASM 版，适用于 Termux 的 arm32 环境）
npm install -g @img/sharp-wasm32 --force

# 4. 运行配置向导，配置飞书机器人和 LLM 提供商
kaijibot onboard

# 5. 配置开机自启和后台保活
kaijibot android-install
```

## 开机自启

开机自启依赖 Termux:Boot 插件，配置步骤如下：

1. **安装 Termux:Boot**：在 F-Droid 搜索 `com.termux.boot` 并安装
2. **必须打开一次**：安装后先手动打开 Termux:Boot 应用。Android 要求应用至少启动过一次才会注册开机广播接收器，这一步不做的话开机后什么都不会执行
3. **生成启动脚本**：`kaijibot android-install` 会自动写入 `~/.termux/boot/start-kaijibot.sh`
4. 重启手机，KaijiBot 自动启动

启动脚本的内容大致如下：

```bash
#!/data/data/com.termux/files/usr/bin/sh
termux-wake-lock
kaijibot gateway
```

## 后台保活

Termux 被 Android 系统杀掉是最常见的可靠性问题。以下是多层防护措施：

### 唤醒锁

```bash
termux-wake-lock
```

获取 CPU 唤醒锁，防止手机休眠时 Termux 进程被暂停。`kaijibot android-install` 生成的启动脚本已自动包含此命令。

### 电池优化白名单

**设置路径**：设置 → 应用 → Termux → 电池 → 不限制

这步必须做。不做的话 Android 会在几分钟内杀掉 Termux 进程，开机自启形同虚设。

### 前台服务

Termux 的通知栏必须保持常驻。如果通知栏看不到 Termux 的通知，说明进程已经被杀了。下拉通知栏检查，如果没有就手动重启一次 `kaijibot gateway`。

## OEM 电池优化设置（按品牌）

这是最关键的一步。不同品牌的 Android 系统对后台进程的管控策略差异很大，只做通用的电池优化白名单远远不够。必须按你的手机品牌完成以下设置：

### 小米 / MIUI / 澎湃OS

- **设置** → 应用设置 → 应用管理 → Termux → 省电策略 → **无限制**
- **设置** → 应用设置 → 应用管理 → Termux → 自启动 → **开启**
- **安全中心** → 应用管理 → Termux → 后台弹出权限 → **开启**

### 三星 / One UI

- **设置** → 电池和设备维护 → 电池 → 后台使用限制 → 从不睡眠应用 → **添加 Termux**

### 华为 / EMUI / 鸿蒙

- **设置** → 电池 → 更多设置 → 受保护的应用 → **Termux 开启**
- **设置** → 应用 → 应用启动管理 → Termux → 手动管理 → **全部开启**

### vivo / OriginOS

- **设置** → 电池 → 后台高耗电 → Termux → **允许后台运行**
- **i管家** → 应用管理 → 自启动 → Termux → **开启**
- **设置** → 快捷与辅助 → 安全管理 → 后台管理 → Termux → **允许**

### OPPO / ColorOS

- **设置** → 电池 → 应用耗电管理 → Termux → **允许后台运行** + **允许自启**

### Pixel / 原生 Android

- **设置** → 应用 → Termux → 电池 → **不受限**
- **设置** → 应用 → Termux:Boot → 电池 → **不受限**

> **提示**：设置完成后，重启一次手机验证所有设置是否生效。如果重启后 KaijiBot 没有自动启动，回到本章逐项排查。

## 日常使用

```bash
# 前台启动 gateway（可以在终端看到实时日志）
kaijibot gateway

# 重启 gateway
kaijibot gateway restart

# 停止 gateway
kaijibot gateway stop

# 更新 KaijiBot 到最新版本
kaijibot update
```

日志文件位于 `~/.kaijibot/gateway.log`，排查问题时先看这里。

## 浏览器自动化（可选）

需要网页抓取或截图功能时，可以在 Termux 中安装 Chromium：

```bash
pkg install x11-repo && pkg install chromium
```

KaijiBot 会自动检测 `$PREFIX/bin/chromium-browser`。Termux 环境下需要额外配置：

```bash
kaijibot config set browser.noSandbox true
```

不装 Chromium 也不影响核心功能，飞书消息收发和认知系统都能正常工作。

## 功能限制

Android/Termux 环境下，部分功能会降级：

| 功能             | 降级原因                               | 替代方案                                      |
| ---------------- | -------------------------------------- | --------------------------------------------- |
| 向量语义搜索     | sqlite-vec 没有 android-arm64 预编译包 | 降级为 FTS 全文搜索                           |
| LanceDB 记忆插件 | 无 arm64 支持                          | 使用 memory-core 插件代替                     |
| 图片处理         | 无原生 sharp 二进制包                  | 使用 WASM 版 sharp（速度慢 2-5 倍，功能完整） |
| PTY 终端模拟     | Termux 限制                            | 降级为 child_process（TUI 体验略差）          |

这些降级不影响日常使用。飞书消息、认知洞察、技能系统、记忆管理等核心功能全部正常。

## 故障排除

### Gateway 被系统杀掉

1. 检查 `termux-wake-lock` 是否生效：`termux-wake-lock` 命令执行后通知栏应出现锁图标
2. 检查电池优化白名单是否已将 Termux 设为不限制
3. 检查 OEM 电池优化设置（见上方按品牌说明）

### 开机不自启

1. 确认已安装 Termux:Boot（F-Droid 搜索 `com.termux.boot`）
2. 确认已至少打开过一次 Termux:Boot 应用
3. 确认 `~/.termux/boot/start-kaijibot.sh` 文件存在且可执行
4. 手动运行该脚本验证内容是否正确：`bash ~/.termux/boot/start-kaijibot.sh`

### TLS / SSL 错误

Termux 的 CA 证书可能与 Node.js 不匹配。设置环境变量：

```bash
export NODE_EXTRA_CA_CERTS=$PREFIX/etc/tls/ca-bundle.crt
```

建议写入 `~/.bashrc` 或 `~/.profile` 使其永久生效：

```bash
echo 'export NODE_EXTRA_CA_CERTS=$PREFIX/etc/tls/ca-bundle.crt' >> ~/.bashrc
```

### npm install 失败

某些包（如 `@lancedb/lancedb`）没有 arm64 预编译包，安装会报平台检查错误。加 `--force` 跳过：

```bash
npm install -g kaijibot --force
```

### 内存不足

4GB RAM 的手机在运行 KaijiBot 的同时使用其他应用可能会卡顿。建议：

- 关闭不必要的后台应用
- 在 Termux 中限制 Node.js 内存：`export NODE_OPTIONS="--max-old-space-size=512"`
- 使用轻量模型（如 `zai/glm-5-turbo`）减少推理时的内存占用

## 本地语音（语音输入 + 朗读）

KaijiBot 的语音输入（按住说话→转文字）由本地 sherpa-onnx 引擎提供，朗读由 edge-tts 提供；Termux 上 sherpa-onnx 有三种部署方式：

### 方式一：静态构建（推荐，零编译）

`scripts/install-sherpa-onnx-termux.sh` 会下载官方 **linux-aarch64 静态构建**（完全静态链接，无需编译，Termux 直接运行）到 `~/.kaijibot/sherpa-speech/runtime`：

```bash
bash scripts/install-sherpa-onnx-termux.sh
# 中国大陆网络建议先设置镜像前缀：
export SHERPA_ONNX_DOWNLOAD_MIRROR=https://gh-proxy.com
```

运行时二进制就位后，网关启动时会**自动后台下载 ASR 模型**（sense-voice int8 约 155MB），下载完成后语音输入即可离线使用。语音朗读走 edge-tts 云服务（微软免费接口），无本地模型、不占额外磁盘。

### 方式二：源码编译（静态构建失败时的后备）

```bash
pkg install -y git cmake clang ninja
git clone --depth 1 --branch v1.13.6 https://github.com/k2-fsa/sherpa-onnx.git
cd sherpa-onnx
# 注意：Termux 是 bionic libc，需要在 CMakeLists.txt 中为 sherpa-onnx 核心库
# 的 target_link_libraries(...) 追加 android log 库（参考 k2-fsa/sherpa-onnx#1459）
cmake -B build -DSHERPA_ONNX_ENABLE_BINARY=ON -DSHERPA_ONNX_ENABLE_TTS=ON \
      -DSHERPA_ONNX_ENABLE_PYTHON=OFF -DSHERPA_ONNX_ENABLE_TESTS=OFF \
      -DSHERPA_ONNX_ENABLE_CHECK=OFF -DSHERPA_ONNX_ENABLE_PORTAUDIO=OFF \
      -DBUILD_SHARED_LIBS=OFF
cmake --build build -j "$(nproc)"
mkdir -p ~/.kaijibot/sherpa-speech/runtime/bin
cp build/bin/sherpa-onnx-offline ~/.kaijibot/sherpa-speech/runtime/bin/
```

### 方式三：proot-distro（免编译兜底）

```bash
pkg install proot-distro
proot-distro login ubuntu
# 在 ubuntu 内下载官方 linux-aarch64 静态构建，解压到宿主 Termux 可访问的路径
```

### 手机端注意事项

- **内存**：SenseVoice int8 推理时运行内存约 600MB（转写结束即释放）。低内存设备可在网关配置 `SHERPA_ONNX_AUTO_DOWNLOAD=0` 关闭自动下载，语音输入将自动走云端 provider（如已配置）。
- **镜像**：模型与运行时默认从 GitHub Releases 下载；不可达时设置 `SHERPA_ONNX_DOWNLOAD_MIRROR`（URL 前缀）走代理镜像。
- **语音输入 UX**：手机浏览器（Chrome Custom Tabs）中长按麦克风按钮说话、松开转文字；桌面浏览器点击切换。
