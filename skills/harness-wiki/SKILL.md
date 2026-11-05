---
name: harness-wiki
description: Read or update persistent project decisions and handoffs in the Codex harness. Use for past decisions, project context, or saving lessons from a completed harness task.
---

# Project memory

Resolve the sibling `cos/scripts/harness.mjs` relative to this skill's folder; call its absolute path `H`.

Use `node H status --json` to find the project id, then `node H wiki show <project-id>`. Answer questions about prior decisions from that file and cite it. If the answer is absent, inspect the relevant task/repository or connected source; do not invent a past decision.

Append new facts with:

```text
node H wiki note <project-id> --text "Decision, reason, and any follow-up" --source "Task id, PR URL, or user instruction"
```

Distinguish verified results from worker claims and proposed decisions. Record meaningful decisions and blockers, not transcripts, secrets, or routine tool output. Keep open requests in the task queue, updating their status as work changes.
