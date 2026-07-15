---
summary: "Project origin, contributors, and license."
read_when:
  - You want the project backstory or contributor credits
title: "Credits"
---

# Credits and Acknowledgments

## Origin

KaijiBot is an **independent project** that forked from [OpenClaw](https://github.com/openclaw/openclaw) in April 2026 and has since diverged with its own cognitive layer, architecture direction, and focus on the Chinese ecosystem (Feishu-first). The fork retains the upstream gateway architecture, plugin SDK, agent loop, and tool ecosystem as its foundation.

## Upstream acknowledgment

KaijiBot stands on the shoulders of **OpenClaw**, built by **Peter Steinberger** ([@steipete](https://x.com/steipete)) and the OpenClaw community. OpenClaw provided the Gateway architecture, Plugin SDK boundaries, the agent loop, multi-channel plumbing, and the full tool ecosystem — these are the foundation KaijiBot builds its cognitive layer on.

## KaijiBot

- **KaijiBot Contributors** ([github.com/Kaiji-Z](https://github.com/Kaiji-Z)) — fork maintainer, cognitive layer, memory rewrite, Feishu/WeChat focus, Chinese-native optimization
- All KaijiBot-specific code (the `src/cognitive/` layer, the memory consolidation engine, the i18n locale-aware CLI) is original to this project

## License

MIT — see [LICENSE](https://github.com/Kaiji-Z/kaijibot/blob/main/LICENSE). The upstream OpenClaw copyright notice is retained as required by the MIT license.
