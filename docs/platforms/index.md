---
summary: "Platform support overview (Gateway + companion apps)"
read_when:
  - Looking for OS support or install paths
  - Deciding where to run the Gateway
title: "Platforms"
---

# Platforms

KaijiBot core is written in TypeScript. **Node is the recommended runtime**.
Bun is not recommended for the Gateway (WhatsApp/Telegram bugs).

Companion apps exist for macOS (menu bar app) and mobile nodes (iOS/Android). Windows and
Linux companion apps are planned, but the Gateway is fully supported today.
Native companion apps for Windows are also planned; the Gateway is recommended via WSL2.

## Choose your OS

- macOS: [macOS](/platforms/macos)
- iOS: [iOS](/platforms/ios)
- Android: [Android](/platforms/android)
- Windows: [Windows](/platforms/windows)
- Linux: [Linux](/platforms/linux)

## VPS & hosting

- VPS hub: [VPS hosting](/vps)
- Fly.io: [Fly.io](/install/fly)
- Hetzner (Docker): [Hetzner](/install/hetzner)
- GCP (Compute Engine): [GCP](/install/gcp)
- Azure (Linux VM): [Azure](/install/azure)
- exe.dev (VM + HTTPS proxy): [exe.dev](/install/exe-dev)

## Common links

- Install guide: [Getting Started](/start/getting-started)
- Gateway runbook: [Gateway](/gateway)
- Gateway configuration: [Configuration](/gateway/configuration)
- Service status: `kaijibot gateway status`

## Gateway service install (CLI)

Use one of these (all supported):

- Wizard (recommended): `kaijibot onboard --install-daemon`
- Direct: `kaijibot gateway install`
- Configure flow: `kaijibot configure` → select **Gateway service**
- Repair/migrate: `kaijibot doctor` (offers to install or fix the service)

The service target depends on OS:

- macOS: LaunchAgent (`ai.kaijibot.gateway` or `ai.kaijibot.<profile>`; legacy `com.kaijibot.*`)
- Linux/WSL2: systemd user service (`kaijibot-gateway[-<profile>].service`)
- Native Windows: Scheduled Task (`KaijiBot Gateway` or `KaijiBot Gateway (<profile>)`), with a per-user Startup-folder login item fallback if task creation is denied
