# Harness demo

A small Node.js project for trying the Codex project harness, with no external packages.

Run `npm test` and `node --check src/index.mjs` before reporting a change ready. The gate is `.codex/gate.json`.

Perform harness tasks in their prepared worktree. Preserve the main checkout. Do not create a GitHub repository, publish, merge, or deploy unless the user requests it.
