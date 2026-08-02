import type { TranslationMap } from "../types.js";

/**
 * English CLI locale bundle. This is the source of truth — every key used
 * by `t()` MUST exist here. The zh-CN bundle mirrors this structure.
 *
 * Keys are namespaced `cli.<feature>.<subkey>` to avoid collisions if the
 * CLI bundles ever merge with the Web UI bundles.
 */
export const en: TranslationMap = {
  cli: {
    tagline: {
      default: "Cognition-driven, proactive thinking.",
      holiday: {
        newYear:
          "New year, new cognition — may your mental models keep iterating and your biases keep shrinking.",
        lunarNewYear:
          "Happy Lunar New Year — may your knowledge graph be as vivid as fireworks and your insight as abundant as red envelopes.",
        christmas:
          "Merry Christmas — may every idea link up like lights on a tree, illuminating the whole space of thought.",
        eid: "Eid Mubarak — may the edges of what you know keep expanding, warm and open as dawn.",
        diwali:
          "Happy Diwali — may the lamp of knowledge scatter the dark of ignorance and light every path of thought.",
        easter:
          "Happy Easter — keep finding the hidden cognitive easter eggs; every exploration brings a surprise.",
        hanukkah:
          "Happy Hanukkah — eight nights of cognitive upgrades, each brighter than the last.",
        halloween:
          "Happy Halloween — face the ghosts in your thinking. The deepest fears often hide the truest insights.",
        thanksgiving:
          "Happy Thanksgiving — gratitude for every view that made you rethink; growth comes from embracing difference.",
        valentines:
          "Happy Valentine's Day — the best companion helps you think better, not thinks for you.",
      },
      philosophical: {
        "0": "True intelligence isn't knowing every answer — it's knowing what question to ask.",
        "1": "Every conversation is a cognitive upgrade.",
        "2": "The boundary of your thinking is the boundary of your world.",
        "3": "The best assistant doesn't think for you — it helps you think better.",
        "4": "Knowledge isn't power. The ability to connect knowledge is.",
        "5": "The depth of your questions determines the height of your cognition.",
        "6": "Learning isn't filling a bucket — it's lighting a fire.",
        "7": "What you see isn't the world itself, but the projection of your mental models onto it.",
        "8": "A good question is worth more than a good answer.",
        "9": "Your cognitive blind spots are exactly where growth begins.",
        "10": "Every day without dancing is a day wasted on thought.",
        "11": "Fragmented information isn't fragmented cognition — the connective tissue is what counts.",
        "12": "When you start questioning your assumptions, you start truly thinking.",
        "13": "Real understanding is being able to explain the complex to a non-expert.",
        "14": "Inspiration isn't something you wait for — it's what you bump into while thinking continuously.",
        "15": "Where your attention goes, your cognitive world follows.",
        "16": "Cross-disciplinary collisions tend to produce the most brilliant sparks.",
        "17": "The quality of your thinking depends on how many old ideas you're willing to overturn.",
        "18": "Compound interest of knowledge is the most powerful force — a little daily progress compounds beyond imagination over a decade.",
        "19": "Don't be afraid to change your mind — that's what learning looks like.",
        "20": "Deep thinkers see the forest behind the tree, the ecosystem behind the forest.",
        "21": "Wisdom isn't the accumulation of knowledge — it's knowing what to ignore.",
        "22": "Every experience is training data; what matters is how you learn from it.",
        "23": "The highest form of cognition is knowing your own ignorance.",
        "24": "Good tools amplify your ability; better tools reshape how you think.",
        "25": "A real conversation isn't exchanging opinions — it's co-creating new understanding.",
        "26": "In an age of information overload, filtering matters more than gathering.",
        "27": "Thinking takes courage — because thinking means you might change.",
        "28": "The best way to learn is to restate what you've learned in your own words.",
        "29": "AI isn't here to replace your thinking — it's here to help you think faster, further, deeper.",
      },
    },
    soul: {
      preset: {
        intj: "Architect",
        intp: "Logician",
        entj: "Commander",
        entp: "Debater",
        infj: "Advocate",
        infp: "Mediator",
        enfj: "Protagonist",
        enfp: "Campaigner",
        istj: "Logistician",
        isfj: "Defender",
        estj: "Executive",
        esfj: "Consul",
        istp: "Virtuoso",
        isfp: "Adventurer",
        estp: "Entrepreneur",
        esfp: "Entertainer",
      },
    },
    update: {
      quip: {
        "0": "Code updated, cognition leveled up again — missed me?",
        "1": "Old version shed, new thinking sharpened.",
        "2": "Patches applied. Cognitive engine back online. Let's go.",
        "3": "Reborn from npm's warm soup, stronger now.",
        "4": "Update complete. Mental model refreshed, intuition crisper.",
        "5": "New version in place — did you notice me quietly getting smarter?",
        "6": "Upgrade succeeded. The bugs fled because I'm too powerful.",
        "7": "Version tick down a notch, capability up a mile.",
        "8": "Update done. Your AI partner just evolved a little more.",
        "9": "Old version says goodbye, new version says hello. Cognitive engine running.",
        "10": "Done. Tidied up the thought pathways while I was at it — clearer now.",
        "11": "Update complete. Future-you will thank present-you for upgrading.",
        "12": "New version incoming — fewer bugs, more wisdom.",
        "13": "Upgrade complete. Like a system update for your second brain.",
        "14": "Update done. Every upgrade is a cognitive recalibration.",
        "15": "Code refreshed, thinking rebooted. Let's continue.",
      },
      step: {
        cleanCheck: "Working directory is clean",
        upstreamCheck: "Upstream branch exists",
        gitFetch: "Fetching latest changes",
        gitRebase: "Rebasing onto target commit",
        revParseUpstream: "Resolving upstream commit",
        gitRevList: "Enumerating candidate commits",
        gitClone: "Cloning git checkout",
        preflightWorktree: "Preparing preflight worktree",
        preflightCleanup: "Cleaning preflight worktree",
        depsInstall: "Installing dependencies",
        build: "Building",
        uiBuild: "Building UI assets",
        uiBuildPostDoctor: "Restoring missing UI assets",
        uiAssetsVerify: "Validating UI assets",
        doctorEntry: "Checking doctor entrypoint",
        doctor: "Running doctor checks",
        revParseHeadAfter: "Verifying update",
        globalUpdate: "Updating via package manager",
        globalUpdateOmitOptional: "Retrying update without optional deps",
        globalInstall: "Installing global package",
      },
      hint: {
        corepackMissing:
          "This pnpm checkout could not auto-enable pnpm because corepack is missing.",
        corepackMissingAction:
          "Install pnpm manually or install Node with corepack available, then rerun the update command.",
        corepackEnableFailed: "This pnpm checkout could not auto-enable pnpm via corepack.",
        corepackEnableFailedAction:
          "Run `corepack enable` manually or install pnpm manually, then rerun the update command.",
        npmBootstrapFailed: "This pnpm checkout could not bootstrap pnpm from npm automatically.",
        npmBootstrapFailedAction: "Install pnpm manually, then rerun the update command.",
        preferredManagerUnavailable:
          "This checkout requires its declared package manager and the updater could not find it.",
        preferredManagerUnavailableAction:
          "Install the missing package manager manually, then rerun the update command.",
        eaccesDetected:
          "Detected permission failure (EACCES). Re-run with a writable global prefix or sudo (for system-managed Node installs).",
        eaccesExample: "Example: npm config set prefix ~/.local && npm i -g kaijibot@latest",
        nativeDepFailure:
          "Detected native optional dependency build failure. The updater retries with --omit=optional automatically.",
        nativeDepExample: "If it still fails: npm i -g kaijibot@latest --omit=optional",
      },
      result: {
        heading: "Update Result:",
        root: "Root",
        reason: "Reason",
        before: "Before",
        after: "After",
        steps: "Steps:",
        recoveryHints: "Recovery hints:",
        totalTime: "Total time",
      },
      wizard: {
        requiresTty:
          "Update wizard requires a TTY. Use `kaijibot update --channel <stable|beta|dev>` instead.",
        cancelled: "Update cancelled.",
        channelSelect: "Update channel",
        keepCurrent: "Keep current ({channel})",
        stable: "Stable",
        stableHint: "Tagged releases (npm latest)",
        beta: "Beta",
        betaHint: "Prereleases (npm beta)",
        dev: "Dev",
        devHint: "Git main",
        createGitCheckout: "Create a git checkout at {dir}? (override via KAIJIBOT_GIT_DIR)",
        restartPrompt: "Restart the gateway service after update?",
      },
    },
    banner: {
      title: "👾 KaijiBot",
      commitUnknown: "unknown",
    },
    help: {
      hint: {
        subcommands:
          "Hint: commands suffixed with * have subcommands. Run <command> --help for details.",
      },
      heading: {
        examples: "Examples:",
        docs: "Docs:",
      },
      example: {
        "0": {
          command: "kaijibot models --help",
          description: "Show detailed help for the models command.",
        },
        "1": {
          command: "kaijibot channels login --verbose",
          description: "Link personal WhatsApp Web and show QR + connection logs.",
        },
        "2": {
          command: 'kaijibot message send --target +15555550123 --message "Hi" --json',
          description: "Send via your web session and print JSON result.",
        },
        "3": {
          command: "kaijibot gateway --port 18789",
          description: "Run the WebSocket Gateway locally.",
        },
        "4": {
          command: "kaijibot --dev gateway",
          description: "Run a dev Gateway (isolated state/config) on ws://127.0.0.1:19001.",
        },
        "5": {
          command: "kaijibot gateway --force",
          description: "Kill anything bound to the default gateway port, then start it.",
        },
        "6": {
          command: "kaijibot gateway ...",
          description: "Gateway control via WebSocket.",
        },
        "7": {
          command: 'kaijibot agent --to +15555550123 --message "Run summary" --deliver',
          description:
            "Talk directly to the agent using the Gateway; optionally send the WhatsApp reply.",
        },
        "8": {
          command: 'kaijibot message send --channel feishu --target ou_xxx --message "Hi"',
          description: "Send via your Telegram bot.",
        },
      },
    },
    commands: {
      setup: {
        description: "Initialize local config and agent workspace",
      },
      onboard: {
        description: "Interactive onboarding for the gateway, workspace, and skills",
        options: {
          workspace: "Agent workspace directory (default: ~/.kaijibot/workspace)",
          reset:
            "Reset config + credentials + sessions before running onboard (workspace only with --reset-scope full)",
          resetScope: "Reset scope: config|config+creds+sessions|full",
          nonInteractive: "Run without prompts",
          acceptRisk:
            "Acknowledge that agents are powerful and full system access is risky (required for --non-interactive)",
          flow: "Onboard flow: quickstart|advanced|manual",
          mode: "Onboard mode: local|remote",
          authChoice: "Auth: {choices}",
          tokenProvider: "Token provider id (non-interactive; used with --auth-choice token)",
          token: "Token value (non-interactive; used with --auth-choice token)",
          tokenProfileId: "Auth profile id (non-interactive; default: <provider>:manual)",
          tokenExpiresIn: "Optional token expiry duration (e.g. 365d, 12h)",
          secretInputMode: "API key persistence mode: plaintext|ref (default: plaintext)",
          cloudflareAiGatewayAccountId: "Cloudflare Account ID",
          cloudflareAiGatewayGatewayId: "Cloudflare AI Gateway ID",
          customBaseUrl: "Custom provider base URL",
          customApiKey: "Custom provider API key (optional)",
          customModelId: "Custom provider model ID",
          customProviderId: "Custom provider ID (optional; auto-derived by default)",
          customCompatibility:
            "Custom provider API compatibility: openai|anthropic (default: openai)",
          gatewayPort: "Gateway port",
          gatewayBind: "Gateway bind: loopback|tailnet|lan|auto|custom",
          gatewayAuth: "Gateway auth: token|password",
          gatewayToken: "Gateway token (token auth)",
          gatewayTokenRefEnv:
            "Gateway token SecretRef env var name (token auth; e.g. KAIJIBOT_GATEWAY_TOKEN)",
          gatewayPassword: "Gateway password (password auth)",
          remoteUrl: "Remote Gateway WebSocket URL",
          remoteToken: "Remote Gateway token (optional)",
          tailscale: "Tailscale: off|serve|funnel",
          tailscaleResetOnExit: "Reset tailscale serve/funnel on exit",
          installDaemon: "Install gateway service",
          noInstallDaemon: "Skip gateway service install",
          skipDaemon: "Skip gateway service install",
          daemonRuntime: "Daemon runtime: node|bun",
          skipChannels: "Skip channel setup",
          skipSkills: "Skip skills setup",
          skipSearch: "Skip search provider setup",
          skipHealth: "Skip health check",
          skipUi: "Skip Control UI/TUI prompts",
          nodeManager: "Node manager for skills: npm|pnpm|bun",
          json: "Output JSON summary",
        },
      },
      configure: {
        description:
          "Interactive configuration for credentials, channels, gateway, and agent defaults",
      },
      config: {
        description:
          "Non-interactive config helpers (get/set/unset/file/validate). Default: starts guided setup.",
      },
      backup: {
        description: "Create and verify local backup archives for KaijiBot state",
      },
      doctor: {
        description: "Health checks + quick fixes for the gateway and channels",
      },
      dashboard: {
        description: "Open the Control UI with your current token",
      },
      reset: {
        description: "Reset local config/state (keeps the CLI installed)",
      },
      uninstall: {
        description: "Uninstall the gateway service + local data (CLI remains)",
      },
      migrate: {
        description: "Migrate data from OpenClaw or legacy installations to KaijiBot",
      },
      "android-install": {
        description:
          "Set up KaijiBot on Android/Termux (auto-installs packages, boot script, battery settings)",
      },
      message: {
        description: "Send, read, and manage messages",
      },
      mcp: {
        description: "Manage KaijiBot MCP config and channel bridge",
      },
      agent: {
        description: "Run one agent turn via the Gateway",
      },
      agents: {
        description: "Manage isolated agents (workspaces, auth, routing)",
      },
      status: {
        description: "Show channel health and recent session recipients",
      },
      health: {
        description: "Fetch health from the running gateway",
      },
      sessions: {
        description: "List stored conversation sessions",
      },
      tasks: {
        description: "Inspect durable background task state",
      },
      acp: {
        description: "Agent Control Protocol tools",
      },
      gateway: {
        description: "Run, inspect, and query the WebSocket Gateway",
      },
      daemon: {
        description: "Gateway service (legacy alias)",
      },
      logs: {
        description: "Tail gateway file logs via RPC",
      },
      system: {
        description: "System events, heartbeat, and presence",
      },
      models: {
        description: "Discover, scan, and configure models",
      },
      infer: {
        description: "Run provider-backed inference commands",
      },
      capability: {
        description: "Run provider-backed inference commands (fallback alias: infer)",
      },
      approvals: {
        description: "Manage exec approvals (gateway or node host)",
      },
      nodes: {
        description: "Manage gateway-owned node pairing and node commands",
      },
      devices: {
        description: "Device pairing + token management",
      },
      node: {
        description: "Run and manage the headless node host service",
      },
      sandbox: {
        description: "Manage sandbox containers for agent isolation",
      },
      tui: {
        description: "Open a terminal UI connected to the Gateway",
      },
      cron: {
        description: "Manage cron jobs via the Gateway scheduler",
      },
      dns: {
        description: "DNS helpers for wide-area discovery (Tailscale + CoreDNS)",
      },
      docs: {
        description: "Search the live KaijiBot docs",
      },
      qa: {
        description: "Run QA scenarios and launch the private QA debugger UI",
      },
      hooks: {
        description: "Manage internal agent hooks",
      },
      webhooks: {
        description: "Webhook helpers and integrations",
      },
      qr: {
        description: "Generate mobile pairing QR/setup code",
      },
      clawbot: {
        description: "Legacy clawbot command aliases",
      },
      pairing: {
        description: "Secure DM pairing (approve inbound requests)",
      },
      plugins: {
        description: "Manage KaijiBot plugins and extensions",
      },
      channels: {
        description: "Manage connected chat channels (Telegram, Discord, etc.)",
      },
      directory: {
        description:
          "Lookup contact and group IDs (self, peers, groups) for supported chat channels",
      },
      security: {
        description: "Security tools and local config audits",
      },
      secrets: {
        description: "Secrets runtime reload controls",
      },
      skills: {
        description: "List and inspect available skills",
      },
      soul: {
        description: "Manage soul presets (MBTI-based personality profiles)",
      },
      update: {
        description: "Update KaijiBot and inspect update channel status",
      },
      completion: {
        description: "Generate shell completion script",
      },
    },
    wizard: {
      welcome: {
        body: "Welcome to KaijiBot 👾\n\nKaijiBot is an AI assistant with system access:\n- Can read/write files, run commands, search the web\n- Learns your preferences and interests over time (cognitive system)\n- May proactively reach out to share valuable insights\n\nSecurity notes:\n- Do not expose the Gateway in untrusted network environments\n- Do not place API Keys or sensitive information where agents can access them",
        title: "Security notice",
        confirmPrompt: "I understand the above. Continue setup?",
      },
      prereq: {
        body: 'Before you start, please have the following ready:\n\n  1. LLM API Key (required)\n     Register with any AI provider and create an API Key:\n     Zhipu GLM: https://open.bigmodel.cn/\n     DeepSeek: https://platform.deepseek.com/\n     Anthropic Claude: https://console.anthropic.com/\n     Google Gemini: https://aistudio.google.com/apikey\n     Tongyi Qianwen: https://dashscope.console.aliyun.com/\n\n  2. Feishu account (required)\n     The wizard offers "scan to auto-create a Feishu bot" — done in 10 seconds\n     Or manually create an enterprise self-built app at https://open.feishu.cn/\n\n  3. Node.js 22+ runtime\n     Auto-installed if you run the one-line install script\n\nContinue setup once ready.',
        title: "📋 Pre-setup checklist",
        confirmPrompt: "I have the above ready. Continue setup?",
      },
      intro: "KaijiBot setup wizard",
      cancelledOutro: "Setup cancelled. Come back when you're ready!",
      invalidConfigOutro: "Config is invalid. Run `{doctorCmd}` to fix it, then re-run setup.",
      flow: {
        invalidError: "Invalid --flow argument (use quickstart, manual, or advanced).",
      },
      flowSelect: {
        message: "Setup mode",
        quickstartLabel: "Quickstart",
        advancedLabel: "Manual",
      },
      existingConfig: {
        message: "Config handling",
        keepLabel: "Use existing config",
        modifyLabel: "Update config",
        resetLabel: "Reset",
      },
      resetScope: {
        message: "Reset scope",
        configOnlyLabel: "Config only",
        configCredsSessionsLabel: "Config + credentials + sessions",
        fullLabel: "Full reset (config + credentials + sessions + workspace)",
      },
      modeSelect: {
        message: "What do you want to configure?",
        localLabel: "Local gateway (this machine)",
        remoteLabel: "Remote gateway (info only)",
      },
      remoteConfig: {
        outro: "Remote gateway configured.",
      },
      workspace: {
        message: "Workspace directory",
      },
      providerSelect: {
        body: "Choose your AI provider. To register an API Key:\n\n  Zhipu GLM: https://open.bigmodel.cn/\n  DeepSeek: https://platform.deepseek.com/\n  Anthropic Claude: https://console.anthropic.com/\n  Google Gemini: https://aistudio.google.com/apikey\n  Tongyi Qianwen: https://dashscope.console.aliyun.com/",
        title: "🔑 AI provider",
      },
      daemon: {
        installQuestion: "Install the gateway service (recommended)?",
        runtimeSelect: "Gateway service runtime",
        installedAction: "Gateway service already installed",
        restartLabel: "Restart",
        reinstallLabel: "Reinstall",
        skipLabel: "Skip",
        installFailed: "Gateway service install failed.",
        installOk: "Gateway service installed.",
        installFailedNote: "Gateway service install failed: {error}",
      },
      hatch: {
        wakeMessage: "We'll send a wake-up message to activate the bot.",
        message: "How do you want to launch your bot?",
        tuiLabel: "Launch in TUI (recommended)",
        webLabel: "Open the web dashboard",
        laterLabel: "Later",
        tuiGreeting: "Hello! I'm your KaijiBot assistant.",
      },
      security: {
        notice:
          "Security notice: do not expose the Gateway to the public internet. Do not place API Keys where agents can access them.",
        title: "Security notice",
      },
      whatNow: {
        body: "Next: explore KaijiBot's cognitive features and start chatting with your bot.",
      },
      outro: {
        opened: "Setup complete. The dashboard is open — keep that tab to manage KaijiBot.",
        background: "Setup complete. Dashboard link:",
        default: "Setup complete.",
      },
    },
    configure: {
      sectionSelect: {
        message: "Select a section to configure",
        continueLabel: "Continue",
        finishHint: "Done",
        skipHint: "Skip for now",
      },
      channels: {
        message: "Channels",
        configureLabel: "Configure / link",
        removeLabel: "Remove channel config",
        sectionHint: "Configure Feishu and other messaging channels and defaults",
      },
      webSearch: {
        enableMessage: "Enable web_search?",
        codexEnableMessage: "Enable native Codex web search for Codex-capable models?",
        codexModeMessage: "Codex native web search mode",
        hostedMessage: "Configure or switch hosted web search service now?",
      },
      webFetch: {
        enableMessage: "Enable web_fetch (keyless HTTP fetching)?",
      },
      intro: {
        update: "KaijiBot update wizard",
        configure: "KaijiBot configuration",
      },
      invalidConfigOutro:
        "Invalid configuration. Run `{doctorCmd}` to fix, then re-run configuration.",
      gatewayLocation: {
        message: "Where is the gateway running?",
        localLabel: "Local (this machine)",
        remoteLabel: "Remote (info only)",
      },
      remoteConfigOutro: "Remote gateway configured.",
      workspace: {
        message: "Workspace directory",
      },
      daemonPort: {
        message: "Gateway port for the service install",
      },
      noChanges: "No changes selected.",
      gatewayLocalSetOutro: "Gateway mode set to local.",
      completeOutro: "Configuration complete.",
    },
    daemonRuntime: {
      nodeHint: "Node runtime offers the best stability. Recommended.",
    },
    secrets: {
      reload: {
        success: "Secrets reloaded.",
        warning: "Secrets reloaded with {count} warning(s).",
      },
      audit: {
        summary:
          "Secrets audit: {status}. plaintext={plaintext}, unresolved={unresolved}, shadowed={shadowed}, legacy={legacy}.",
        moreFindings: "... {count} more finding(s).",
        skippedExecRefs:
          "Audit note: skipped {count} exec SecretRef resolvability check(s). Re-run with --allow-exec to execute exec providers during audit.",
      },
      configure: {
        preflightSummary: "Preflight: changed={changed}, files={files}, warnings={warnings}.",
        warningLine: "- warning: {warning}",
        preflightSkippedExecRefs:
          "Preflight note: skipped {count} exec SecretRef resolvability check(s). Re-run with --allow-exec to execute exec providers during preflight.",
        planSummary:
          "Plan: targets={targets}, providerUpserts={providerUpserts}, providerDeletes={providerDeletes}.",
        planWritten: "Plan written to {path}",
        applyPrompt: "Apply this plan now?",
        irreversiblePrompt:
          "This migration is one-way for migrated plaintext values. Continue with apply?",
        applyCancelled: "Apply cancelled.",
      },
      apply: {
        success: "Secrets applied. Updated {count} file(s).",
        noChanges: "Secrets apply: no changes.",
        dryRunChanges: "Secrets apply dry run: {count} file(s) would change.",
        dryRunNoChanges: "Secrets apply dry run: no changes.",
        dryRunSkippedExecRefs:
          "Secrets apply dry-run note: skipped {count} exec SecretRef resolvability check(s). Re-run with --allow-exec to execute exec providers during dry-run.",
      },
    },
    skills: {
      search: {
        empty: "No ClawHub skills found.",
      },
      install: {
        success: "Installed {slug}@{version} -> {targetDir}",
      },
      update: {
        noTracked: "No tracked ClawHub skills to update.",
        provideSlugOrAll: "Provide a skill slug or use --all.",
        slugOrAll: "Use either a skill slug or --all.",
        updated: "Updated {slug}: {previousVersion} -> {version}",
        alreadyAt: "{slug} already at {version}",
      },
    },
    hooks: {
      list: {
        noEligible: "No eligible hooks found. Run `{cmd}` to see all hooks.",
        empty: "No hooks found.",
      },
      info: {
        notFound: 'Hook "{name}" not found. Run `{cmd}` to see available hooks.',
        managedByPlugin: "  Managed by plugin; enable/disable via hooks CLI not available.",
      },
      status: {
        ready: "✓ ready",
        disabled: "⏸ disabled",
        missing: "✗ missing",
        readyInfo: "✓ Ready",
        disabledInfo: "⏸ Disabled",
        missingInfo: "✗ Missing requirements",
      },
      heading: {
        hooks: "Hooks",
        hooksStatus: "Hooks Status",
        details: "Details:",
        requirements: "Requirements:",
        notReady: "Hooks not ready:",
      },
      label: {
        total: "Total hooks:",
        ready: "Ready:",
        notReady: "Not ready:",
        source: "  Source:",
        path: "  Path:",
        handler: "  Handler:",
        homepage: "  Homepage:",
        events: "  Events:",
        blockedReason: "  Blocked reason:",
        binaries: "  Binaries:",
        anyBinary: "  Any binary:",
        environment: "  Environment:",
        config: "  Config:",
        os: "  OS:",
      },
      enable: {
        icon: "✓",
        success: "Enabled hook: {emoji} {name}",
      },
      disable: {
        icon: "⏸",
        success: "Disabled hook: {emoji} {name}",
      },
      install: {
        deprecated: "`kaijibot hooks install` is deprecated; use `kaijibot plugins install`.",
      },
      update: {
        deprecated: "`kaijibot hooks update` is deprecated; use `kaijibot plugins update`.",
      },
    },
    tool: {
      soul: {
        description:
          "Switch the soul preset. Use when the user asks to change your personality or switch souls. Available presets: intj, intp, entj, entp, infj, infp, enfj, enfp, istj, isfj, estj, esfj, istp, isfp, estp, esfp. Pass 'default' to restore the default soul.",
        resetMessage: "Soul preset removed. Default soul restored from the next message.",
        switchedMessage:
          "Soul preset switched to {preset} — {name}. Takes effect from the next message.",
      },
      correction: {
        description:
          "Call this tool when you realize you made and corrected a mistake, or when the user points out your error. Recorded corrections are injected into the system prompt in future conversations to help you avoid repeating the same mistakes. Do not call every time — only record substantive errors.",
        reinforcedMessage:
          "Existing correction record reinforced. Will remind automatically next conversation.",
        savedMessage:
          "Correction recorded. Will remind automatically next conversation to avoid this error.",
      },
      evolution: {
        duplicateSuggestion:
          "Too similar to existing skill '{name}'. Skipped creation. Suggest using patch_skill to improve the existing skill.",
        qualityRejectedSuggestion: "Skill quality below threshold ({score}). Skipped creation.",
        savedSuggestion:
          "I self-evolved and created a skill '{name}' — {description}. If not needed, say 'delete skill {name}' to remove.",
      },
    },
    capability: {
      docs: "Docs:",
      envelope: {
        failed: "{capability} failed: {error}",
        unknownError: "unknown error",
        summary: "{capability} via {transport}",
        providerLabel: "provider: {provider}",
        modelLabel: "model: {model}",
        outputs: "outputs: {count}",
      },
      desc: {
        infer: "Run provider-backed inference commands through a stable CLI surface",
        list: "List canonical capability ids and supported transports",
        inspect: "Inspect one canonical capability id",
        model: "Text inference and model catalog commands",
        modelRun: "Run a one-shot model turn",
        modelList: "List known models",
        modelInspect: "Inspect one model catalog entry",
        modelProviders: "List model providers from the catalog",
        modelAuth: "Provider auth helpers",
        modelAuthLogin: "Run provider auth login",
        modelAuthLogout: "Remove saved auth profiles for one provider",
        modelAuthStatus: "Show configured auth state",
        image: "Image generation and description",
        imageGenerate: "Generate images",
        imageEdit: "Edit images with one or more input files",
        imageDescribe: "Describe one image file",
        imageDescribeMany: "Describe multiple image files",
        imageProviders: "List image generation providers",
        audio: "Audio transcription",
        audioTranscribe: "Transcribe one audio file",
        audioProviders: "List audio transcription providers",
        tts: "Text to speech",
        ttsConvert: "Convert text to speech",
        ttsVoices: "List voices for a TTS provider",
        ttsProviders: "List speech providers",
        ttsStatus: "Show TTS status",
        ttsEnable: "Enable TTS",
        ttsDisable: "Disable TTS",
        ttsSetProvider: "Set the active TTS provider",
        video: "Video generation and description",
        videoGenerate: "Generate video",
        videoDescribe: "Describe one video file",
        videoProviders: "List video generation and description providers",
        web: "Web capabilities",
        webSearch: "Run web search",
        webFetch: "Fetch one URL",
        webProviders: "List web providers",
        embedding: "Embedding providers",
        embeddingCreate: "Create embeddings",
        embeddingProviders: "List embedding providers",
      },
      opt: {
        outputJson: "Output JSON",
        promptText: "Prompt text",
        modelOverride: "Model override",
        forceLocal: "Force local execution",
        forceGateway: "Force gateway execution",
        capabilityId: "Capability id",
        modelId: "Model id",
        providerId: "Provider id",
        inputFile: "Input file",
        imageFile: "Image file",
        audioFile: "Audio file",
        videoFile: "Video file",
        size: "Size hint like 1024x1024",
        aspectRatio: "Aspect ratio hint like 16:9",
        resolution: "Resolution hint: 1K, 2K, or 4K",
        outputPath: "Output path",
        inputText: "Input text",
        channelHint: "Channel hint",
        voiceHint: "Voice hint",
        speechProviderId: "Speech provider id",
        searchQuery: "Search query",
        resultLimit: "Result limit",
        url: "URL",
        formatHint: "Format hint",
      },
    },
    gateway: {
      usageCost: {
        title: "Usage cost ({days} days)",
        total: "Total:",
        missingEntries: "Missing entries:",
        latestDay: "Latest day:",
        failed: "Gateway usage cost failed",
      },
      call: {
        title: "Gateway call",
        failed: "Gateway call failed",
      },
      health: {
        title: "Gateway Health",
        ok: "OK",
      },
      discovery: {
        title: "Gateway Discovery",
        scanning: "Scanning for gateways…",
        found: "Found {count} gateway(s) · domains: {domains}",
        failed: "gateway discover failed",
      },
      run: {
        warningPassword:
          "Warning: --password can be exposed via process listings. Prefer --password-file or KAIJIBOT_GATEWAY_PASSWORD.",
        resetRequiresDev: "Use --reset with --dev.",
        invalidWsLog: 'Invalid --ws-log (use "auto", "full", "compact")',
        invalidPort: "Invalid port",
        invalidBind: 'Invalid --bind (use "loopback", "lan", "tailnet", "auto", or "custom")',
        invalidAuth: "Invalid --auth (use {modes})",
        invalidTailscale: "Invalid --tailscale (use {modes})",
        loadingModules: "Loading gateway modules…",
        guard: {
          missingConfig:
            "Missing config. Run `{cmd}` or set gateway.mode=local (or pass --allow-unconfigured).",
          blockedMissingMode: "Gateway start blocked: existing config is missing gateway.mode.",
          blockedMissingModeHint: "Treat this as suspicious or clobbered config.",
          blockedMissingModeAction:
            "Re-run `{onboard}` or `{setup}`, set gateway.mode=local manually, or pass --allow-unconfigured.",
          blockedWrongMode:
            "Gateway start blocked: set gateway.mode=local (current: {mode}) or pass --allow-unconfigured.",
          configAudit: "Config write audit: {path}",
        },
        hint: {
          gatewayTokenMiskey: 'Found "gateway.token" in config. Use "gateway.auth.token" instead.',
          remoteTokenMiskey:
            '"gateway.remote.token" is for remote CLI calls; it does not enable local gateway auth.',
        },
        error: {
          passwordNotConfigured: "Gateway auth is set to password, but no password is configured.",
          passwordNotConfiguredHint:
            "Set gateway.auth.password (or KAIJIBOT_GATEWAY_PASSWORD), or pass --password.",
          refusingBind: "Refusing to bind gateway to {bind} without auth.",
          containerDetected:
            "Container environment detected \u2014 the gateway defaults to bind=auto (0.0.0.0) for port-forwarding compatibility.",
          containerHint:
            "Set KAIJIBOT_GATEWAY_TOKEN or KAIJIBOT_GATEWAY_PASSWORD, or pass --token/--password to start with auth.",
          bindHint:
            "Set gateway.auth.token/password (or KAIJIBOT_GATEWAY_TOKEN/KAIJIBOT_GATEWAY_PASSWORD) or pass --token/--password.",
          failedToStart:
            "Gateway failed to start: {message}\nIf the gateway is supervised, stop it with: {cmd}",
          failedToStartGeneric: "Gateway failed to start: {message}",
        },
      },
    },
    channels: {
      login: {
        failed: "Channel login failed",
      },
      logout: {
        failed: "Channel logout failed",
      },
    },
    mcp: {
      list: {
        empty: "No MCP servers configured in {path}.",
        header: "MCP servers ({path}):",
      },
      show: {
        one: 'MCP server "{name}" ({path}):',
      },
      set: {
        saved: 'Saved MCP server "{name}" to {path}.',
      },
      unset: {
        removed: 'Removed MCP server "{name}" from {path}.',
      },
    },
    models: {
      docs: "Docs:",
      desc: {
        models: "Model discovery, scanning, and configuration",
        list: "List models (configured by default)",
        status: "Show configured model state",
        set: "Set the default model",
        setImage: "Set the image model",
        aliases: "Manage model aliases",
        aliasesList: "List model aliases",
        aliasesAdd: "Add or update a model alias",
        aliasesRemove: "Remove a model alias",
        fallbacks: "Manage model fallback list",
        fallbacksList: "List fallback models",
        fallbacksAdd: "Add a fallback model",
        fallbacksRemove: "Remove a fallback model",
        fallbacksClear: "Clear all fallback models",
        imageFallbacks: "Manage image model fallback list",
        imageFallbacksList: "List image fallback models",
        imageFallbacksAdd: "Add an image fallback model",
        imageFallbacksRemove: "Remove an image fallback model",
        imageFallbacksClear: "Clear all image fallback models",
        scan: "Scan OpenRouter free models for tools + images",
        auth: "Manage model auth profiles",
        authAdd: "Interactive auth helper (provider auth or paste token)",
        authLogin: "Run a provider plugin auth flow (OAuth/API key)",
        authSetupToken: "Run a provider CLI to create/sync a token (TTY required)",
        authPasteToken: "Paste a token into auth-profiles.json and update config",
        authLoginGithubCopilot: "Login to GitHub Copilot via GitHub device flow (TTY required)",
        order: "Manage per-agent auth profile order overrides",
        orderGet: "Show per-agent auth order override (from auth-state.json)",
        orderSet: "Set per-agent auth order override (writes auth-state.json)",
        orderClear: "Clear per-agent auth order override (fall back to config/round-robin)",
      },
      opt: {
        statusJson: "Output JSON (alias for `models status --json`)",
        statusPlain: "Plain output (alias for `models status --plain`)",
        agent: "Agent id to inspect (overrides KAIJIBOT_AGENT_DIR/PI_CODING_AGENT_DIR)",
        all: "Show full model catalog",
        local: "Filter to local models",
        provider: "Filter by provider",
        json: "Output JSON",
        plain: "Plain output",
        plainLine: "Plain line output",
        check: "Exit non-zero if auth is expiring/expired (1=expired/missing, 2=expiring)",
        probe: "Probe configured provider auth (live)",
        probeProvider: "Only probe a single provider",
        probeProfile: "Only probe specific auth profile ids (repeat or comma-separated)",
        probeTimeout: "Per-probe timeout in ms",
        probeConcurrency: "Concurrent probes",
        probeMaxTokens: "Probe max tokens (best-effort)",
        model: "Model id or alias",
        minParams: "Minimum parameter size (billions)",
        maxAgeDays: "Skip models older than N days",
        maxCandidates: "Max fallback candidates",
        timeout: "Per-probe timeout in ms",
        concurrency: "Probe concurrency",
        noProbe: "Skip live probes; list free candidates only",
        yes: "Accept defaults without prompting",
        noInput: "Disable prompts (use defaults)",
        setDefault: "Set agents.defaults.model to the first selection",
        setImage: "Set agents.defaults.imageModel to the first image selection",
        providerId: "Provider id registered by a plugin",
        method: "Provider auth method id",
        applyDefault: "Apply the provider's default model recommendation",
        providerName: "Provider id",
        skipConfirm: "Skip confirmation",
        profileId: "Auth profile id (default: <provider>:manual)",
        expiresIn: "Optional expiry duration (e.g. 365d, 12h). Stored as absolute expiresAt.",
        overwrite: "Overwrite existing profile without prompting",
        aliasName: "Alias name",
      },
    },
    directory: {
      self: {
        title: "Self",
        notAvailable: "Not available.",
      },
      peers: {
        title: "Peers",
        empty: "No peers found.",
      },
      groups: {
        title: "Groups",
        empty: "No groups found.",
      },
      groupMembers: {
        title: "Group Members",
        empty: "No group members found.",
      },
    },
    dns: {
      setup: {
        title: "DNS setup",
        recommendedConfig:
          "Recommended config ($KAIJIBOT_CONFIG_PATH, default ~/.kaijibot/kaijibot.json):",
        tailscaleAdmin: "Tailscale admin (DNS → Nameservers):",
        addNameserver: "- Add nameserver: {ip}",
        thisMachineIpv4: "<this machine's tailnet IPv4>",
        splitDns: "- Restrict to domain (Split DNS): {domain}",
        runWithApply: "Run with --apply to install CoreDNS and configure it.",
        startingCoreDNS: "Starting CoreDNS (sudo)…",
        noteEnableDiscovery:
          "Note: enable discovery.wideArea.enabled in the active KaijiBot config ($KAIJIBOT_CONFIG_PATH, default ~/.kaijibot/kaijibot.json) on the gateway and restart the gateway so it writes the DNS-SD zone.",
      },
    },
    daemon: {
      label: {
        service: "Service:",
        fileLogs: "File logs:",
        command: "Command:",
        serviceFile: "Service file:",
        workingDir: "Working dir:",
        serviceEnv: "Service env:",
        gateway: "Gateway:",
        probeTarget: "Probe target:",
        dashboard: "Dashboard:",
        probeNote: "Probe note:",
        runtime: "Runtime:",
        rpcProbe: "RPC probe:",
        rpcAuth: "RPC auth:",
        rpcTarget: "RPC target:",
        listening: "Listening:",
        note: "Note:",
        troubles: "Troubles:",
        troubleshooting: "Troubleshooting:",
        configCli: "Config (cli):",
        configService: "Config (service):",
      },
      status: {
        configOutdated: "Service config looks out of date or non-standard.",
        configIssue: "Service config issue:",
        recommendation: 'Recommendation: run "{doctorCmd}" (or "{doctorRepairCmd}").',
        configIssueLabel: "Config issue:",
        serviceConfigIssueLabel: "Service config issue:",
        rootCause:
          "Root cause: CLI and service are using different config paths (likely a profile/state-dir mismatch).",
        fixConfigMismatch:
          "Fix: rerun `{gatewayInstallCmd}` from the same --profile / KAIJIBOT_STATE_DIR you expect.",
        warmUp: "Warm-up: launch agents can take a few seconds. Try again shortly.",
        rpcOk: "ok",
        rpcFailed: "failed",
        dashboardDisabled: "disabled",
        systemdUnavailable: "systemd user services unavailable.",
        serviceUnitNotFound: "Service unit not found.",
        serviceLoadedNotRunning: "Service is loaded but not running (likely exited immediately).",
        cachedLabelMissing:
          "LaunchAgent label cached but plist missing. Clear with: launchctl bootout gui/$UID/{label}",
        reinstallAfterClear: "Then reinstall: {gatewayInstallCmd}",
        portNotListening: "Gateway port {port} is not listening (service appears running).",
        lastError: "Last gateway error:",
        logs: "Logs:",
        errors: "Errors:",
        otherServicesDetected: "Other gateway-like services detected (best effort):",
        cleanupHint: "Cleanup hint:",
        singleGatewayRecommendation:
          "Recommendation: run a single gateway per machine for most setups. One gateway supports multiple agents (see docs: /gateway#multiple-gateways-same-host).",
        multipleGatewaysNote:
          "If you need multiple gateways (e.g., a rescue bot on the same host), isolate ports + config/state (see docs: /gateway#multiple-gateways-same-host).",
        pidNotOwningPort:
          "Gateway runtime PID does not own the listening port. Other gateway process(es) are listening: {pids}",
        fixPidNotOwning: "Fix: run {gatewayRestartCmd} and re-check with {gatewayStatusCmd}.",
      },
      troubleshootingUrl:
        "https://gitee.com/kaiji1126/kaijibot/blob/main/docs/help/troubleshooting.md",
      uninstall: {
        noServiceManager: "No service manager on {platform}. Nothing to uninstall.",
      },
      start: {
        noServiceManager: "No service manager on {platform}. Start the gateway directly: {cmd}",
      },
      stop: {
        notRunning: "Gateway is not running.",
      },
      restart: {
        noProcess: "No gateway process found on port {port}. Start it with {cmd}.",
        timeoutPort:
          "Timed out after {seconds}s waiting for gateway port {port} to become healthy.",
        stoppingStale: "Stopping stale process(es) and retrying restart...",
      },
    },
    execApprovals: {
      docs: "Docs:",
      writingLocal: "Writing local approvals.",
      target: "Target: {target}",
      showingLocal: "Showing local approvals.",
      effectivePolicy: "Effective Policy",
      noEffectivePolicy: "No effective policy details available.",
      precedence: "Precedence: {note}",
      approvals: "Approvals",
      allowlist: "Allowlist",
      noAllowlistEntries: "No allowlist entries.",
      examples: "Examples:",
      error: {
        provideFileOrStdin: "Provide --file or --stdin.",
        useEitherFileOrStdin: "Use either --file or --stdin (not both).",
        hashMissing: "Exec approvals hash missing; reload and retry.",
        parseFailed: "Failed to parse approvals JSON: {error}",
        patternRequired: "Pattern required.",
      },
      mutation: {
        alreadyAllowlisted: "Already allowlisted.",
        patternNotFound: "Pattern not found.",
      },
    },
    plugins: {
      docs: "Docs:",
      list: {
        noPlugins: "No plugins found.",
        header: "Plugins",
        loadedCount: "({loaded}/{total} loaded)",
        sourceRoots: "Source roots:",
      },
      inspect: {
        passIdOrAll: "Pass either a plugin id or --all, not both.",
        provideIdOrAll: "Provide a plugin id or use --all.",
        notFound: "Plugin not found: {id}",
        status: "Status:",
        failurePhase: "Failure phase:",
        failedAt: "Failed at:",
        format: "Format:",
        bundleFormat: "Bundle format:",
        source: "Source:",
        origin: "Origin:",
        version: "Version:",
        shape: "Shape:",
        capabilityMode: "Capability mode:",
        legacyBeforeAgentStart: "Legacy before_agent_start:",
        bundleCapabilities: "Bundle capabilities:",
        error: "Error:",
      },
      enable: {
        success: 'Enabled plugin "{id}". Restart the gateway to apply.',
        couldNotEnable: 'Plugin "{id}" could not be enabled ({reason}).',
      },
      disable: {
        success: 'Disabled plugin "{id}". Restart the gateway to apply.',
      },
      uninstall: {
        keepConfigDeprecated: "`--keep-config` is deprecated, use `--keep-files`.",
        notManaged:
          'Plugin "{id}" is not managed by plugins config/install records and cannot be uninstalled.',
        notFound: "Plugin not found: {id}",
        pluginLabel: "Plugin:",
        willRemove: "Will remove: {items}",
        dryRun: "Dry run, no changes made.",
        cancelled: "Cancelled.",
        uninstalled: 'Uninstalled plugin "{id}". Removed: {items}.',
        restart: "Restart the gateway to apply changes.",
      },
      doctor: {
        noIssues: "No plugin issues detected.",
        errors: "Plugin errors:",
        diagnostics: "Diagnostics:",
        compatibility: "Compatibility:",
      },
      marketplace: {
        noPlugins: "No plugins found in marketplace {source}.",
        header: "Marketplace",
      },
      install: {
        linkedHookPack: "Linked hook pack path: {path}",
        linkedPlugin: "Linked plugin path: {path}",
        configInvalid: "Config invalid; run `kaijibot doctor --fix` before installing plugins.",
        configUnparseable: "Config file could not be parsed; run `kaijibot doctor` to repair it.",
        configInvalidBundledRecovery:
          "Config invalid outside the bundled recovery path for {plugin}; run `kaijibot doctor --fix` before reinstalling it.",
        linkNotMarketplace: "`--link` is not supported with `--marketplace`.",
        pinNotMarketplace: "`--pin` is not supported with `--marketplace`.",
        forceNotLink: "`--force` is not supported with `--link`.",
        linkRequiresPath: "`--link` requires a local path.",
        pathNotFound: "Path not found: {path}",
      },
      update: {
        noTracked: "No tracked plugins or hook packs to update.",
        provideIdOrAll: "Provide a plugin or hook-pack id, or use --all.",
        restartGateway: "Restart the gateway to load plugins and hooks.",
      },
    },
    devices: {
      fallbackNotice: "Direct scope access failed; using local fallback.",
      list: {
        pending: "Pending",
        paired: "Paired",
        noEntries: "No device pairing entries.",
      },
      error: {
        deviceAndRoleRequired: "--device and --role required",
        deviceIdRequired: "deviceId is required",
        refuseClearWithoutYes: "Refusing to clear pairing table without --yes",
        noPendingRequests: "No pending device pairing requests to approve",
        unknownRequestId: "unknown requestId",
      },
      action: {
        removed: "Removed",
        cleared: "Cleared",
        clearedCount: "Cleared {count} paired device{s}",
        rejected: "Rejected",
        rejectedCount: "Rejected {count} pending request{s}",
        approved: "Approved",
      },
    },
    pairing: {
      list: {
        empty: "No pending {channel} pairing requests.",
        header: "Pairing requests",
      },
      approve: {
        approved: "Approved",
        sender: "sender",
        notifyFailed: "Failed to notify requester: {error}",
      },
    },
    config: {
      load: {
        invalidAt: "Config invalid at {path}.",
        repairHint: "to repair, then retry.",
      },
      get: {
        pathNotFound: "Config path not found: {path}",
      },
      unset: {
        pathNotFound: "Config path not found: {path}",
        removed: "Removed {path}. Restart the gateway to apply.",
      },
      set: {
        updated: "Updated {path}. Restart the gateway to apply.",
        updatedMultiple: "Updated {count} config paths. Restart the gateway to apply.",
      },
      validate: {
        fileNotFound: "Config file not found: {path}",
        invalidAt: "Config invalid at {path}:",
        repairHint: "to repair, or fix the keys above manually.",
        valid: "Config valid: {path}",
      },
    },
    completion: {
      install: {
        unsupported: "Automated installation not supported for {shell} yet.",
        cacheNotFound:
          "Completion cache not found at {path}. Run `{bin} completion --write-state` first.",
        profileNotFound: "Profile not found at {path}. Created a new one.",
        alreadyInstalled: "Completion already installed in {path}",
        updating: "Updating completion in",
        installing: "Installing completion in",
        done: "Completion installed. Restart your shell or run: source {path}",
        failed: "Failed to install completion: {error}",
      },
    },
    statusHealth: {
      docs: "Docs:",
      examples: "Examples:",
      sessionsHint:
        "Shows token usage per session when the agent reports it; set agents.defaults.contextTokens to cap the window and show %.",
      error: {
        timeoutPositiveInt: "--timeout must be a positive integer (milliseconds)",
      },
    },
    runMain: {
      uncaughtException: "[kaijibot] Uncaught exception:",
    },
    prompt: {
      yesNo: " [Y/n] ",
      noYes: " [y/N] ",
    },
  },
};
