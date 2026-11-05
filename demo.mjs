#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, readdirSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, HOME, init, projects, git } from './lib/store.mjs';
import { addProject } from './harness.mjs';

export function createDemo() {
  init();
  const existing = projects().find(p => p.id === 'harness-demo');
  if (existing) return existing;
  const dir = join(HOME, 'demo-projects', 'harness-demo');
  if (existsSync(dir) && readdirSync(dir).length) throw new Error(`Preserving existing files at ${dir}. Register that repository manually or choose another data directory.`);
  mkdirSync(dir, { recursive: true });
  cpSync(join(ROOT, 'examples', 'harness-demo'), dir, { recursive: true });
  git(dir, 'init', '-b', 'main');
  git(dir, 'add', '.');
  git(dir, '-c', 'user.name=Codex Harness Demo', '-c', 'user.email=codex-harness-demo@local.invalid', 'commit', '-m', 'Initialize local harness demo');
  return addProject(dir, { id: 'harness-demo', what: 'Local demo for testing the Codex project harness', keywords: 'demo,harness-demo' });
}
if (process.argv[1] && realpathSync(resolve(process.argv[1])) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(createDemo(), null, 2)); }
  catch (e) { console.error(e.message); process.exitCode = 1; }
}
