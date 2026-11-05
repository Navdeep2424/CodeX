import { spawn, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, lstatSync, readlinkSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { GIT, toolEnv } from './store.mjs';

export const digest = text => createHash('sha256').update(text).digest('hex');
export function loadGate(dir) {
  const file = join(dir, '.codex', 'gate.json');
  if (!existsSync(file)) throw new Error(`No gate: create ${file} from this project's real checks.`);
  const raw = readFileSync(file, 'utf8');
  const c = JSON.parse(raw);
  if (!Array.isArray(c.steps) || c.steps.length < 1 || c.steps.length > 20) throw new Error('A gate needs 1–20 real check steps.');
  const tries = c.tries ?? 5;
  if (!Number.isInteger(tries) || tries < 1 || tries > 10) throw new Error('Gate tries must be an integer from 1 to 10.');
  for (const step of c.steps) {
    if (typeof step.name !== 'string' || !step.name.trim() || typeof step.run !== 'string' || !step.run.trim()) throw new Error('Each gate step needs a nonempty name and run command.');
    const timeout = step.timeoutSeconds ?? 120;
    if (!Number.isInteger(timeout) || timeout < 1 || timeout > 300) throw new Error('Each timeoutSeconds must be between 1 and 300.');
  }
  if (c.steps.reduce((n, s) => n + (s.timeoutSeconds ?? 120), 0) > 1500) throw new Error('Total gate timeouts must not exceed 1500 seconds.');
  if (c.env && (typeof c.env !== 'object' || Array.isArray(c.env) || Object.values(c.env).some(v => typeof v !== 'string'))) throw new Error('Gate env must map names to strings.');
  if (c.rules && (!Array.isArray(c.rules) || c.rules.some(v => typeof v !== 'string'))) throw new Error('Gate rules must be an array of strings.');
  if (c.serve || c.qa) throw new Error('Put browser/QA checks in explicit steps; serve/qa from the Claude gate format is not supported.');
  return { file, config: { ...c, tries }, hash: digest(raw) };
}
export function shellCheck(command, dir, env, timeoutSeconds) {
  return new Promise(resolve => {
    const start = Date.now();
    const child = spawn('/bin/sh', ['-c', command], { cwd: dir, env: { ...toolEnv(), ...env }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', timedOut = false;
    const append = b => { output = (output + b.toString()).slice(-64000); };
    child.stdout.on('data', append); child.stderr.on('data', append);
    const timer = setTimeout(() => { timedOut = true; try { process.kill(-child.pid, 'SIGKILL'); } catch {} }, timeoutSeconds * 1000);
    child.on('error', e => { clearTimeout(timer); resolve({ ok: false, output: e.message, ms: Date.now() - start }); });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve({ ok: code === 0 && !timedOut, code, signal, output: output + (timedOut ? '\nCheck timed out.' : ''), ms: Date.now() - start });
    });
  });
}
export async function checkGate(dir, expectedHash) {
  const gate = loadGate(dir);
  if (expectedHash && gate.hash !== expectedHash) throw new Error('Gate changed after activation. Restore it; do not weaken checks to pass. Re-arm only for an authorized gate change.');
  const results = [];
  for (const step of gate.config.steps) {
    const result = await shellCheck(step.run, dir, gate.config.env || {}, step.timeoutSeconds ?? 120);
    results.push({ name: step.name, command: step.run, ...result });
    if (!result.ok) break;
  }
  return { ok: results.every(r => r.ok), dir, gateHash: gate.hash, checkedAt: new Date().toISOString(), results };
}
export function fingerprint(dir) {
  const names = execFileSync(GIT, ['ls-files', '-c', '-o', '--exclude-standard', '-z'], { cwd: dir, env: toolEnv(), encoding: 'utf8' }).split('\0').filter(Boolean);
  const hash = createHash('sha256');
  for (const name of [...new Set(names)].sort()) {
    hash.update(name + '\0'); const file = join(dir, name);
    if (!existsSync(file)) { hash.update('deleted\0'); continue; }
    const stat = lstatSync(file);
    hash.update(String(stat.mode));
    if (stat.isSymbolicLink()) hash.update(readlinkSync(file));
    else if (stat.isFile()) hash.update(readFileSync(file));
    else hash.update('directory');
  }
  return hash.digest('hex');
}
