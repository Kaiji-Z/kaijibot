# KaijiBot Android Launcher

极简 Android 应用：一键安装 Termux + KaijiBot。

## 用户体验

1. 安装 KaijiBot Launcher APK（约 100KB）
2. 打开 → 自动下载 Termux → 点击安装
3. 点击「复制命令并打开 Termux」→ 长按粘贴 → 回车
4. 完成

## 构建

需要 Android Studio 或 Java 17 + Android SDK 34。

```bash
cd android
gradle assembleDebug
# APK 输出: app/build/outputs/apk/debug/app-debug.apk
```

或通过 GitHub Actions 自动构建（push 到 main 触发）。

## 技术方案

- **Termux 检测**：PackageManager 查询 `com.termux`
- **APK 安装**：FileProvider + ACTION_VIEW Intent
- **命令传递**：剪贴板（避免 RUN_COMMAND 的 `allow-external-apps` 鸡生蛋问题）
- **UI**：单 Activity + ConstraintLayout（无 Compose 依赖，APK 体积最小化）
