---
summary: "Redirect: flow commands live under `kaijibot tasks flow`"
read_when:
  - You encounter kaijibot flows in older docs or release notes
title: "flows (redirect)"
---

# `kaijibot tasks flow`

Flow commands are subcommands of `kaijibot tasks`, not a standalone `flows` command.

```bash
kaijibot tasks flow list [--json]
kaijibot tasks flow show <lookup>
kaijibot tasks flow cancel <lookup>
```

For full documentation see [Task Flow](/automation/taskflow) and the [tasks CLI reference](/cli/index#tasks).
