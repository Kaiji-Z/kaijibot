---
summary: "CLI reference for `kaijibot docs` (search the live docs index)"
read_when:
  - You want to search the live KaijiBot docs from the terminal
title: "docs"
---

# `kaijibot docs`

Search the live docs index.

Arguments:

- `[query...]`: search terms to send to the live docs index

Examples:

```bash
kaijibot docs
kaijibot docs browser existing-session
kaijibot docs sandbox allowHostControl
kaijibot docs gateway token secretref
```

Notes:

- With no query, `kaijibot docs` opens the live docs search entrypoint.
- Multi-word queries are passed through as one search request.
