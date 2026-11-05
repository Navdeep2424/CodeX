# Codex harness implementation

A Codex-native implementation inspired by RishabhSFI/claude-harness-starter. Uses Node built-ins, Git worktrees, and Codex skills/hooks. No pstack or Claude dependency.

Run `npm test` for regression checks. Project/task/wiki/check state lives in ignored `state/`. Do not publish that state. Installing skills does not authorize external messages, merges, deployments, GitHub repository creation, or changes to permission/trust decisions.
