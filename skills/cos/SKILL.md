---
name: cos
description: Coordinate coding tasks across local Git projects using the Codex project harness. Use for Chief of Staff, project status, managing the harness queue, or assigning implementation work to a registered project.
---

# Codex Chief of Staff

Use the bundled `scripts/harness.mjs` with Node. Resolve that script relative to this SKILL.md; never assume the chat's working directory is the harness. Call its absolute path `H` below.

## Start and route

1. Run `node H status --json` and `node H task list`. These are the durable project and request records. Read the relevant project notes with `node H wiki show <project-id>`.
2. Resolve the user's project by name, registered directory, or `node H route "<request>"`. If there is no unique match, ask which project before changing its files. For a new folder, initialize a Git repo only when requested, then register it with `node H add /absolute/repo --what "Description" --keywords "name,alias"`.
3. Record each implementation request immediately: `node H task add <project-id> "<goal>"`. Reuse its id for follow-ups to that task. A status-only question needs no task.

## Dispatch and verify

For an implementation request, prepare its isolated branch with `node H task prepare <id>`, then read `node H brief <id>`.

- Delegate independently scoped project work to available subagent tools, passing the complete brief and absolute worktree path. This skill requests delegation for those implementation tasks. Keep edits in that worktree. If delegation is unavailable, execute the brief in the worktree in this chat and say so.
- Do not create separate user-owned Codex chats unless the user explicitly asks for a new chat. If they do, discover `create_thread`, supply the brief, and use the returned project/worktree identifiers. Message existing chats only within explicit user authorization. Use `wait_threads` for requested monitoring.
- Each worker plans, implements, checks, and fixes failures within the configured attempts. Use `$until-ready` in a top-level coding session. Subagents run explicit check/fix cycles; they must not arm the root chat's Stop hook.
- Run `node H task finish <id>` yourself after the worker reports. Inspect the actual diff and resulting checks. For a substantive change, use an independent review subagent when available; resolve actionable findings and rerun checks after code changes. Look at UI changes in the browser when relevant.
- A missing gate is a setup task: draft `.codex/gate.json` from existing checks, prove the commands run, and show the definition to the user. The definition of readiness must be agreed before using it as a release criterion. Do not invent checks or run install commands just to get a green result.
- If the gate fails after its attempt budget, record `task record <id> --status blocked --note "Failure and next step"`. Preserve the branch and give the user the failure.

## Handoff and memory

Commit only the task's changes when that is within the request. For a requested PR handoff, use connected GitHub tools or authenticated `gh`, explicitly selecting the origin repository. Push the task branch, open a PR against the recorded base branch, and include actual checks and review findings. With no remote, report the local branch; do not create a remote or publish the demo automatically. Never infer permission to merge, deploy, or message people from `public` configuration.

Record the verified outcome using `task record <id> --status done --note "Outcome"` (optionally `--url "PR URL"`). Done requires a current passing check result. Readiness and completion are separate: a prepared or ready task may still need review, a commit, or a requested PR.

Append durable decisions and blockers with `node H wiki note <project-id> --text "Decision and reason" --source "PR, task id, or user request"`. Keep project memory in these files, not only in the chat.

Report: what needs the user, completed outcomes with evidence, and work still in flight. State when checks are stale or GitHub access is unavailable. Do not describe queued or prepared work as running.

`node H mc` opens the local read-only status dashboard at port 4747. The queue is processed when the user invokes this skill; it is not an unattended background agent service.
