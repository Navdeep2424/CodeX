# CodeX — Codex project harness

A local Chief of Staff for coding projects: project routing, a durable task queue, isolated task branches, project notes, readiness checks, and a local status dashboard. Inspired by [claude-harness-starter](https://github.com/RishabhSFI/claude-harness-starter), implemented for Codex using Node built-ins. No Claude desktop or pstack dependency.

## Use in Codex

The installer adds three skills: `$cos`, `$until-ready`, and `$harness-wiki`. After installation, start with:

> Use $cos to show my projects and tasks.

Then try:

> Use $cos to add a completion percentage to harness-demo's task summary, with tests.

The hub records the request, creates a worktree, delegates implementation when tools permit it, runs checks, reviews the result, and saves the outcome. Native subagents work within the active hub task. Separate user-owned worker chats are created only on an explicit request for a new chat. The queue does not consume model usage or run unattended while the hub is idle.

## Installation

Requires Node 18+ and Git. Optional GitHub CLI or the connected GitHub plugin handles requested PRs. No npm dependencies or API keys are required by the harness scripts.

```bash
git clone https://github.com/Navdeep2424/CodeX.git
cd CodeX
node install.mjs --dry-run
node install.mjs
node demo.mjs
```

`demo.mjs` creates and registers a local demo repository under ignored `state/demo-projects/`. It uses the included `examples/harness-demo` template, makes a local initial commit, and does not create or publish a GitHub repository. It preserves any existing project registered as `harness-demo`. Skip it if you only want to register your own repositories.

The installer links skills into `~/.agents/skills` and merges one Stop hook into `$CODEX_HOME/hooks.json` (default `~/.codex/hooks.json`). It uses absolute paths and the actual Node executable, preserves other hooks, and backs up modified hook configuration. The earlier downloaded Claude-only `cos` is archived under `state/backups/`. It does not replace global AGENTS.md or change sandbox, approval, model, login, or hook-trust settings.

**Review the installed Stop hook in Codex Settings > Hooks (or CLI `/hooks`).** Codex skips untrusted hooks. Explicit `gate check` works independently. See [Codex hooks](https://learn.chatgpt.com/docs/hooks) and [skills](https://learn.chatgpt.com/docs/build-skills).

Keep this directory in place: installed skills link to it. Newly installed skills should appear automatically; restart Codex if needed.

## Commands

Run from this directory, or use the absolute path to `harness.mjs`.

```bash
node harness.mjs add /absolute/repo --id my-app --what "My app" --keywords "app,alias"
node harness.mjs status
node harness.mjs doctor
node harness.mjs status --github --json
node harness.mjs route "Add dark mode to my-app"
node harness.mjs task add my-app "Add dark mode"
node harness.mjs task prepare TASK_ID
node harness.mjs brief TASK_ID
node harness.mjs task finish TASK_ID
node harness.mjs task record TASK_ID --status done --note "Verified outcome"
node harness.mjs wiki note my-app --text "Decision and reason" --source "Task or PR"
node harness.mjs wiki show my-app
node harness.mjs mc
```

`mc` serves a read-only dashboard at `http://127.0.0.1:4747`, with manual refresh. It has no mutation endpoints or background worker launcher. `status --github` reads PRs through authenticated `gh`, selecting each origin explicitly. Without GitHub access, local status and checks still work. Codex performs requested PR handoffs through GitHub tools or `gh`.

## Readiness gate

Each project defines `.codex/gate.json`:

```json
{
  "steps": [
    { "name": "tests", "run": "npm test", "timeoutSeconds": 120 },
    { "name": "build", "run": "npm run build", "timeoutSeconds": 120 }
  ],
  "tries": 5,
  "rules": ["Do not weaken tests to pass."]
}
```

Use only commands the project provides; the demo has tests and syntax checks, not a build. Commands run under `/bin/sh` in the worktree and must terminate. Optional `env` maps names to strings; keep secret values out of committed gate files. Supports 1–20 steps, individual timeouts of 1–300 seconds, a total timeout budget of at most 1500 seconds, and 1–10 attempts. Browser QA can be an explicit step; Claude's separate `serve`/`qa` fields are rejected.

```bash
node harness.mjs gate check --dir /absolute/worktree
node harness.mjs gate on --dir /absolute/worktree --goal "Requested outcome"
node harness.mjs gate status --dir /absolute/worktree
node harness.mjs gate off --dir /absolute/worktree
```

`gate check` returns JSON and exits nonzero on failure. `gate on` reads `CODEX_THREAD_ID` or explicit `--session`. Use it only in a top-level coding session that owns the task. Subagents use explicit checks to avoid attaching work to the parent hub's Stop event.

When trusted and armed, the Stop hook runs checks, feeds failures back for a bounded fix cycle, and gives one final continuation for success or blocker handoff. It freezes the gate definition while armed and detects content changes after a pass before allowing the final stop. Process-group timeouts stop stuck checks. Results are saved to `state/checks/`.

The gate verifies configured commands, not all requirements. Rules are instructions, not an OS security boundary. Hook runtime/trust must be enabled in Codex; simulating hook JSON is not proof that the app invoked it. Report approval/credential failures rather than bypassing them.

## Local state

`state/projects.json`, `state/tasks.json`, `state/wiki/`, `state/checks/`, `state/sessions/`, and task worktrees are local and ignored by Git. Override `CODEX_HARNESS_HOME` for another state directory, consistently in CLI and hook environments. Registry mutations use locks and atomic writes.

Worktrees use the project's configured base branch, without automatically fetching changes. Prepare requires a clean source checkout and committed gate. It does not copy untracked `.env`, dependencies, or data: prepare dependencies as each project requires. A prepared task is not a running worker.

Targets macOS/Linux (`/bin/sh`, POSIX process groups). Uses ordinary Git worktrees instead of the original macOS-specific dependency-copy command. No automatic merge/deploy policy is enabled.

If system Git is unavailable (for example, an Xcode license prompt), the harness uses Codex's bundled Git wrapper when available. `doctor` prints the selected executable; `CODEX_HARNESS_GIT` can select another existing Git. This does not accept licenses or change Xcode settings. Install and authenticate GitHub CLI separately with `gh auth login` for CLI-based PR actions, or use the connected GitHub plugin.

## Verification

```bash
npm test
```

Tests use temporary Git repositories and fake commands. They exercise routing, persistence, isolation, checks and timeouts, bounded hook continuations, gate tampering, stale readiness, dashboard responses, and installer preservation. They do not make paid model calls, publish, or require GitHub credentials.

## Uninstall

Remove the three symlinks in `~/.agents/skills` pointing into this package. Remove only this package's Stop handler from `~/.codex/hooks.json`. The archived Claude `cos` can be moved back to `~/.codex/skills/cos`. Preserve `state/` until its task worktrees are committed or deliberately removed with `git worktree remove`.
