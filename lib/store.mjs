import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, realpathSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const HOME = resolve(process.env.CODEX_HARNESS_HOME || join(ROOT, 'state'));
export const expand = p => resolve(p.startsWith('~/') ? join(homedir(), p.slice(2)) : p);
function findGit() {
  if (process.env.CODEX_HARNESS_GIT) return process.env.CODEX_HARNESS_GIT;
  if (spawnSync('git', ['--version'], { encoding: 'utf8' }).status === 0) return 'git';
  const bundled = join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/git');
  if (existsSync(bundled) && spawnSync(bundled, ['--version'], { encoding: 'utf8' }).status === 0) return bundled;
  return 'git';
}
export const GIT = findGit();
export const toolEnv = () => ({ ...process.env, PATH: [GIT.includes('/') ? dirname(GIT) : '', join(homedir(), '.local/bin'), process.env.PATH].filter(Boolean).join(':') });
export const readJSON = (file, fallback) => existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback;
export function writeJSON(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  renameSync(temp, file);
}
export function lock(file) {
  mkdirSync(dirname(file), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try { writeFileSync(file, String(process.pid), { flag: 'wx', mode: 0o600 }); return () => { try { unlinkSync(file); } catch {} }; }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const pid = Number(readFileSync(file, 'utf8'));
      if (!pid) throw new Error('Another harness operation is acquiring the lock. Retry shortly.');
      try { process.kill(pid, 0); }
      catch (err) { if (err.code === 'EPERM') throw new Error('Another harness operation is running. Retry shortly.'); try { unlinkSync(file); } catch {} continue; }
      throw new Error('Another harness operation is running. Retry shortly.');
    }
  }
  throw new Error('Could not acquire harness lock.');
}
export function mutate(name, initial, fn) {
  const file = join(HOME, name);
  const release = lock(`${file}.lock`);
  try { const value = readJSON(file, initial); const result = fn(value); writeJSON(file, value); return result; }
  finally { release(); }
}
export function run(exe, args, cwd = ROOT) {
  const r = spawnSync(exe, args, { cwd, env: toolEnv(), encoding: 'utf8', timeout: 20000, maxBuffer: 8 * 1024 * 1024 });
  if (r.error || r.status !== 0) throw new Error(`${exe}: ${r.error?.message || r.stderr?.trim() || `exit ${r.status}`}`);
  return r.stdout.trim();
}
export const git = (cwd, ...args) => run(GIT, args, cwd);
export const repoRoot = dir => realpathSync(git(expand(dir), 'rev-parse', '--show-toplevel'));
export function slug(value) {
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(value || '')) throw new Error('Use an id of 1–63 lowercase letters, digits, or hyphens.');
  return value;
}
export function init() {
  mkdirSync(HOME, { recursive: true });
  for (const [name, value] of [['projects.json', { projects: [] }], ['tasks.json', { tasks: [] }]]) {
    if (!existsSync(join(HOME, name))) writeJSON(join(HOME, name), value);
  }
  mkdirSync(join(HOME, 'wiki'), { recursive: true });
}
export const projects = () => readJSON(join(HOME, 'projects.json'), { projects: [] }).projects;
export const tasks = () => readJSON(join(HOME, 'tasks.json'), { tasks: [] }).tasks;
export function project(id) { const p = projects().find(p => p.id === id); if (!p) throw new Error(`Unknown project: ${id}`); return p; }
export function task(id) { const t = tasks().find(t => t.id === id); if (!t) throw new Error(`Unknown task: ${id}`); return t; }
export function updateTask(id, patch) {
  return mutate('tasks.json', { tasks: [] }, data => {
    const t = data.tasks.find(t => t.id === id); if (!t) throw new Error(`Unknown task: ${id}`);
    Object.assign(t, patch, { updated: new Date().toISOString() }); return t;
  });
}
export function defaultBranch(dir) {
  try { return git(dir, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD').replace(/^origin\//, ''); } catch {}
  for (const name of ['main', 'master']) { try { git(dir, 'rev-parse', '--verify', `refs/heads/${name}`); return name; } catch {} }
  return git(dir, 'branch', '--show-current') || (() => { throw new Error('Set a base branch before creating a task.'); })();
}
