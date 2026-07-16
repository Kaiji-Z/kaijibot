# KaijiBot Android Launcher

极简 Android 应用：内置 Termux + 一键引导安装 KaijiBot。

**下载**:[GitHub Release `launcher` tag](https://github.com/Kaiji-Z/kaijibot/releases/tag/launcher) — `kaijibot-launcher.apk`(约 41MB,包含 Termux)

## 用户体验

1. 下载并安装 `kaijibot-launcher.apk`(允许"未知来源")
2. 打开 Launcher → 点击「安装 Termux」(从 APK 内部解压内置的 termux.apk,无需联网下载)
3. Termux 装好后,点击「复制命令并打开 Termux」→ 长按粘贴 → 回车
4. KaijiBot 自动安装并启动 gateway,完成

## 构建

需要 Android Studio 或 Java 17 + Android SDK 34。

```bash
cd android
gradle assembleDebug
# APK 输出: app/build/outputs/apk/debug/app-debug.apk
```

或通过 GitHub Actions 自动构建(`android/**` 路径推送到 main 时触发,自动上传到 `launcher` release tag)。

> 注意:Termux APK(`app/src/main/res/raw/termux.apk`,约 34MB)在 `.gitignore` 里,不长期追踪。CI 构建时从 [`v2026.6.25-1` release](https://github.com/Kaiji-Z/kaijibot/releases/tag/v2026.6.25-1) 的 `termux-arm64.apk` 资源拉取。本地构建需要手动放置。详见 `.github/workflows/android-build.yml`。

## 技术方案

- **Termux 内置**:`res/raw/termux.apk` 通过 `aaptOptions noCompress("apk")` 保持原样打包,运行时 `installBundledTermux()` 解压到 cacheDir 并触发 `ACTION_VIEW` 安装
- **Termux 检测**:PackageManager 查询 `com.termux`
- **命令传递**:剪贴板(避免 RUN_COMMAND 的 `allow-external-apps` 鸡生蛋问题)
- **UI**:单 Activity + ConstraintLayout(无 Compose 依赖,Launcher 本身只有几百 KB;APK 总大小主要由内置 Termux 决定)
