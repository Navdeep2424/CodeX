#!/usr/bin/env node
import { existsSync, mkdirSync, symlinkSync, realpathSync, renameSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { ROOT, HOME, init, readJSON, writeJSON } from './lib/store.mjs';

const dry = process.argv.includes('--dry-run');
const codexHome = resolve(process.env.CODEX_HOME || join(homedir(), '.codex'));
const skillsHome = resolve(process.env.CODEX_HARNESS_SKILLS_DIR || join(homedir(), '.agents', 'skills'));
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backup = join(HOME, 'backups', stamp);
const plans = [];
for (const name of ['cos', 'until-ready', 'harness-wiki']) {
  const target = join(ROOT, 'skills', name), dest = join(skillsHome, name);
  if (existsSync(dest) && realpathSync(dest) === target) continue;
  if (existsSync(dest)) throw new Error(`Existing skill at ${dest}; move or rename it before installing.`);
  plans.push({ target, dest });
}
// Retire only the exact Claude-only cos skill installed earlier in this chat.
// Preserve it outside skill discovery. Unrelated skills are never replaced.
const legacy = join(codexHome, 'skills', 'cos');
let migrateLegacy = false;
if (existsSync(legacy) && realpathSync(legacy) !== join(ROOT, 'skills', 'cos')) {
  const text = readFileSync(join(legacy, 'SKILL.md'), 'utf8');
  if (text.includes('mcp__ccd_session__start_session') && text.includes('~/Projects/claude-harness')) migrateLegacy = true;
  else if (realpathSync(legacy) !== join(skillsHome, 'cos')) throw new Error(`Unrelated cos skill exists at ${legacy}; preserving it. Resolve the name collision first.`);
}
const hookFile = join(codexHome, 'hooks.json');
const hooks = readJSON(hookFile, { hooks: {} });
hooks.hooks ??= {};
const shellQuote = s => `'${s.replaceAll("'", "'\\''")}'`;
const command = `${shellQuote(process.execPath)} ${shellQuote(join(ROOT, 'harness.mjs'))} hook`;
const groups = hooks.hooks.Stop ?? [];
const already = groups.some(g => g.hooks?.some(h => h.command === command));
if (!already) hooks.hooks.Stop = [...groups, { hooks: [{ type: 'command', command, timeout: 1800, statusMessage: 'Checking Codex harness readiness' }] }];
console.log(JSON.stringify({ dryRun: dry, skills: plans, archiveLegacyCos: migrateLegacy, hookFile, hookNeedsUpdate: !already, data: HOME }, null, 2));
if (!dry) {
  init();
  mkdirSync(skillsHome, { recursive: true });
  if (migrateLegacy) { mkdirSync(backup, { recursive: true }); renameSync(legacy, join(backup, 'claude-cos')); }
  for (const { target, dest } of plans) { mkdirSync(dirname(dest), { recursive: true }); symlinkSync(target, dest, 'dir'); }
  if (!already) {
    if (existsSync(hookFile)) { mkdirSync(backup, { recursive: true }); writeJSON(join(backup, 'hooks.json'), readJSON(hookFile)); }
    writeJSON(hookFile, hooks);
  }
  console.log('Installed. Review the new Stop hook in Codex Settings > Hooks, or CLI /hooks. No trust decisions or permission settings were changed.');
}
