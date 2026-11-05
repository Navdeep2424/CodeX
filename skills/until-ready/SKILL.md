---
name: until-ready
description: Implement a coding task in an isolated Git worktree, run its real checks, and fix failures within a bounded attempt budget using the Codex harness. Use for keep going until checks pass or until-ready tasks.
---

# Work until the checks pass

Resolve the sibling `cos/scripts/harness.mjs` relative to this skill's folder; call its absolute path `H`. Read the task brief and repository AGENTS.md. Work in the prepared task worktree; use `node H task prepare <id>` from an existing queue entry if needed.

Read `.codex/gate.json`. It must list real, terminating check commands in `steps` as `{ "name": "tests", "run": "npm test", "timeoutSeconds": 120 }`, optionally `env`, `rules`, and `tries` (default 5, maximum 10). No empty gate counts as a pass. For a missing gate, draft one from actual project scripts and agree the checks with the user before relying on it for readiness. See the harness README for the full supported schema.

For a top-level Codex coding session, run:

```text
node H gate on --dir /absolute/worktree --goal "User's requested outcome"
```

The script reads `CODEX_THREAD_ID`, or accepts `--session <session_id>` when explicitly supplied by the Codex hook context. The installed Stop hook runs checks when the turn ends. It feeds failures back to Codex, stops after the configured attempts, and gives one continuation for the final report/handoff. Hook definitions require review in Codex Settings > Hooks or CLI `/hooks`. Do not bypass trust. Until hooks are trusted, use the explicit loop below and say that automatic enforcement is not active.

Inside a subagent, or when hooks are unavailable, run `node H gate check --dir /absolute/worktree` after implementation; fix the actual failure and rerun, for at most `tries` cycles. Do not activate a parent session's gate. Check exit status and result JSON. On budget exhaustion, report the failing command and preserved branch. On an approval refusal or missing credential, report the blocker rather than changing permissions.

Keep tests and the gate intact. An armed gate rejects configuration changes. Meaningful checks can still miss requirements: inspect behavior, and visually inspect UI changes. Review the final diff independently when available and warranted. After all final code changes, run `node H task finish <id>` to save verified readiness. Finish only the commit/push/PR steps authorized by the user's task. Never merge or deploy by default.

To cancel an armed loop on the user's request: `node H gate off --dir /absolute/worktree`. Cancellation does not mean checks passed.
