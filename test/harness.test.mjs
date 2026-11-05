import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, realpathSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';

const scratch = mkdtempSync(join(tmpdir(), 'codex-harness-test-'));
process.env.CODEX_HARNESS_HOME = join(scratch, 'state');
const cli = await import('../harness.mjs');
const store = await import('../lib/store.mjs');
const gate = await import('../lib/gate.mjs');
const hook = await import('../lib/hook.mjs');
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
after(() => rmSync(scratch, { recursive: true, force: true }));
let serial = 0;
function fixture(check = 'node --check app.mjs', tries = 2) {
  const dir = join(scratch, `repo-${serial++}`); mkdirSync(join(dir, '.codex'), { recursive: true });
  writeFileSync(join(dir, 'app.mjs'), 'export const value = 1;\n');
  writeFileSync(join(dir, '.gitignore'), 'runs.txt\n');
  writeFileSync(join(dir, '.codex/gate.json'), JSON.stringify({ steps: [{ name: 'test', run: check, timeoutSeconds: 3 }], tries }));
  store.git(dir, 'init', '-b', 'main'); store.git(dir, 'config', 'user.name', 'Harness Test'); store.git(dir, 'config', 'user.email', 'harness@example.invalid');
  store.git(dir, 'add', '.'); store.git(dir, 'commit', '-m', 'Initial fixture');
  return dir;
}
function arm(dir, id, max = 2) {
  const g = gate.loadGate(dir);
  store.writeJSON(hook.sessionFile(id), { dir, goal: 'Test outcome', max, gateHash: g.hash, attempts: 0 });
}

test('registers projects persistently and refuses duplicates', () => {
  store.init(); const dir = fixture(); const p = cli.addProject(dir, { id: 'alpha', what: 'First app', keywords: 'alpha, shared' });
  assert.equal(p.baseBranch, 'main'); assert.equal(p.dir, realpathSync(dir));
  assert.equal(store.project('alpha').what, 'First app');
  assert.throws(() => cli.addProject(dir, { id: 'other' }), /already registered/);
  assert.ok(existsSync(join(store.HOME, 'wiki/alpha.md')));
});
test('routes unique matches and refuses ambiguous project selection', () => {
  cli.addProject(fixture(), { id: 'beta', keywords: 'beta, shared' });
  assert.equal(cli.route('fix alpha').project, 'alpha');
  assert.equal(cli.route('fix shared').project, null);
  assert.equal(cli.route('unknown project').project, null);
});
test('creates an isolated branch/worktree and preserves the main checkout', () => {
  const t = cli.addTask('alpha', 'Change the app'); const prepared = cli.prepareTask(t.id);
  assert.equal(store.git(prepared.dir, 'branch', '--show-current'), `task/${t.id}`);
  writeFileSync(join(prepared.dir, 'app.mjs'), 'export const value = 2;\n');
  assert.match(readFileSync(join(store.project('alpha').dir, 'app.mjs'), 'utf8'), /value = 1/);
  assert.equal(cli.prepareTask(t.id).dir, prepared.dir);
  assert.match(cli.workerBrief(t.id), /Do not merge/);
});
test('rejects preparing a task from an uncommitted source checkout', () => {
  const dir = fixture(); cli.addProject(dir, { id: 'dirty' }); writeFileSync(join(dir, 'new.txt'), 'unsaved');
  assert.throws(() => cli.prepareTask(cli.addTask('dirty', 'Task').id), /uncommitted/);
});
test('passes real commands and stops on the first failing command', async () => {
  const good = fixture(); assert.equal((await gate.checkGate(good)).ok, true);
  const bad = fixture('exit 7');
  const config = JSON.parse(readFileSync(join(bad, '.codex/gate.json')));
  config.steps.push({ name: 'should-not-run', run: 'touch should-not-run' });
  writeFileSync(join(bad, '.codex/gate.json'), JSON.stringify(config));
  const result = await gate.checkGate(bad);
  assert.equal(result.ok, false); assert.equal(result.results[0].code, 7); assert.equal(result.results.length, 1);
  assert.equal(existsSync(join(bad, 'should-not-run')), false);
});
test('times out a stuck check and kills its process group', async () => {
  const r = await gate.shellCheck('node -e "setInterval(() => {}, 1000)"', scratch, {}, 1);
  assert.equal(r.ok, false); assert.match(r.output, /timed out/); assert.ok(r.ms < 4000);
});
test('rejects missing and empty gates, unsupported QA fields, and unbounded settings', () => {
  assert.throws(() => gate.loadGate(scratch), /No gate/);
  const dir = fixture(); const file = join(dir, '.codex/gate.json');
  for (const config of [{ steps: [] }, { steps: [{ name: 'a', run: 'true' }], tries: 999 }, { steps: [{ name: 'a', run: 'true' }], qa: 'true' }]) {
    writeFileSync(file, JSON.stringify(config)); assert.throws(() => gate.loadGate(dir));
  }
});
test('Stop hook ignores inactive sessions and subagent events', async () => {
  assert.deepEqual(await hook.stopHook({ session_id: 'inactive' }), {});
  assert.deepEqual(await hook.stopHook({ session_id: 'inactive', agent_id: 'worker' }), {});
});
test('a failing Stop loop is bounded and releases the final report', async () => {
  const dir = fixture('echo failure >&2; exit 1'); arm(dir, 'fail');
  const first = await hook.stopHook({ session_id: 'fail', turn_id: '1' }); assert.match(first.reason, /attempt 1\/2/);
  const second = await hook.stopHook({ session_id: 'fail', turn_id: '2' }); assert.match(second.reason, /after 2 attempts/);
  assert.deepEqual(await hook.stopHook({ session_id: 'fail', turn_id: '3' }), {});
  assert.equal(existsSync(hook.sessionFile('fail')), false);
});
test('a passing Stop loop gives one handoff then allows completion', async () => {
  const dir = fixture(); arm(dir, 'pass');
  assert.match((await hook.stopHook({ session_id: 'pass', turn_id: '1' })).reason, /Gate passed/);
  assert.deepEqual(await hook.stopHook({ session_id: 'pass', turn_id: '2' }), {});
});
test('code changes after a pass invalidate the result and rerun checks', async () => {
  const dir = fixture(); arm(dir, 'changed');
  await hook.stopHook({ session_id: 'changed', turn_id: '1' });
  writeFileSync(join(dir, 'app.mjs'), 'this is not valid JavaScript !');
  const result = await hook.stopHook({ session_id: 'changed', turn_id: '2' });
  assert.match(result.reason, /still fails/);
});
test('an armed gate rejects gate tampering rather than silently changing readiness', async () => {
  const dir = fixture('exit 1'); arm(dir, 'tampered');
  writeFileSync(join(dir, '.codex/gate.json'), JSON.stringify({ steps: [{ name: 'weakened', run: 'true' }] }));
  assert.match((await hook.stopHook({ session_id: 'tampered', turn_id: '1' })).reason, /Gate changed after activation/);
});
test('duplicate Stop handlers do not spend another attempt in the same turn', async () => {
  const dir = fixture('exit 1'); arm(dir, 'duplicate');
  const input = { session_id: 'duplicate', turn_id: 'same' };
  const a = await hook.stopHook(input); const b = await hook.stopHook(input);
  assert.deepEqual(a, b); assert.equal(store.readJSON(hook.sessionFile('duplicate')).attempts, 1);
});
test('verified task readiness becomes stale after a content change', async () => {
  const t = cli.prepareTask(cli.addTask('beta', 'Test task readiness').id);
  const ready = await cli.finishTask(t.id); assert.equal(ready.status, 'ready');
  let row = cli.snapshot().projects.find(p => p.id === 'beta').tasks.find(x => x.id === t.id); assert.equal(row.checksCurrent, true);
  writeFileSync(join(t.dir, 'app.mjs'), 'export const value = 3;\n');
  row = cli.snapshot().projects.find(p => p.id === 'beta').tasks.find(x => x.id === t.id); assert.equal(row.checksCurrent, false);
  const result = spawnSync(process.execPath, [join(root, 'harness.mjs'), 'task', 'record', t.id, '--status', 'done'], { env: process.env, encoding: 'utf8' });
  assert.equal(result.status, 1); assert.match(result.stderr, /task finish/);
});
test('fingerprints include untracked files with spaces in their names', () => {
  const dir = fixture(); const before = gate.fingerprint(dir);
  writeFileSync(join(dir, ' leading space.txt'), 'data'); assert.notEqual(gate.fingerprint(dir), before);
});
test('task readiness rejects a weakened gate and CLI finish exits nonzero', () => {
  const t = cli.prepareTask(cli.addTask('beta', 'Keep readiness checks intact').id);
  writeFileSync(join(t.dir, '.codex/gate.json'), JSON.stringify({ steps: [{ name: 'weakened', run: 'true' }] }));
  const result = spawnSync(process.execPath, [join(root, 'harness.mjs'), 'task', 'finish', t.id], { env: process.env, encoding: 'utf8' });
  assert.equal(result.status, 1);
  const updated = store.task(t.id); assert.equal(updated.status, 'blocked'); assert.match(updated.checks.error, /Gate changed/);
});
test('GitHub remote parsing targets only the origin owner/repository', () => {
  assert.equal(cli.githubRepo('git@github.com:owner/repo.git'), 'owner/repo');
  assert.equal(cli.githubRepo('https://github.com/owner/repo.git'), 'owner/repo');
  assert.equal(cli.githubRepo('https://example.com/owner/repo'), null);
});
test('dashboard serves local status and rejects mutations', async () => {
  const s = cli.startDashboard(0); await new Promise(resolve => s.once('listening', resolve));
  try {
    const url = `http://127.0.0.1:${s.address().port}`;
    assert.equal((await fetch(url)).status, 200);
    const data = await (await fetch(url + '/api/status')).json(); assert.ok(data.projects.some(p => p.id === 'alpha'));
    assert.equal((await fetch(url + '/api/status', { method: 'POST' })).status, 405);
    assert.equal((await fetch(url + '/missing')).status, 404);
  } finally { s.closeAllConnections(); await new Promise(resolve => s.close(resolve)); }
});
test('installer dry-run, preservation, and reruns work in isolated config directories', () => {
  const configDir = join(scratch, 'config'), skillsDir = join(scratch, 'skills'), dataDir = join(scratch, 'install-data');
  mkdirSync(configDir); const hooksFile = join(configDir, 'hooks.json');
  writeFileSync(hooksFile, JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'existing-hook' }] }] } }));
  const env = { ...process.env, CODEX_HOME: configDir, CODEX_HARNESS_SKILLS_DIR: skillsDir, CODEX_HARNESS_HOME: dataDir };
  const install = extra => execFileSync(process.execPath, [join(root, 'install.mjs'), ...extra], { env, encoding: 'utf8' });
  install(['--dry-run']); assert.equal(existsSync(skillsDir), false); assert.equal(existsSync(dataDir), false);
  install([]); install([]);
  const hooks = JSON.parse(readFileSync(hooksFile)); assert.equal(hooks.hooks.Stop.length, 2); assert.equal(hooks.hooks.Stop[0].hooks[0].command, 'existing-hook');
  assert.equal(realpathSync(join(skillsDir, 'cos')), join(root, 'skills/cos'));
});

test('demo setup creates a usable local repo and preserves it on reruns', () => {
  const dataDir = join(scratch, 'demo-data');
  const env = { ...process.env, CODEX_HARNESS_HOME: dataDir };
  const alias = join(scratch, 'repo-link'); symlinkSync(root, alias, 'dir');
  const setup = () => JSON.parse(execFileSync(process.execPath, [join(alias, 'demo.mjs')], { env, encoding: 'utf8' }));
  const first = setup(); assert.equal(first.id, 'harness-demo');
  assert.ok(existsSync(join(first.dir, '.git')));
  assert.equal(store.git(first.dir, 'remote'), '');
  const check = JSON.parse(execFileSync(process.execPath, [join(root, 'harness.mjs'), 'gate', 'check', '--dir', first.dir], { env, encoding: 'utf8' }));
  assert.equal(check.ok, true);
  writeFileSync(join(first.dir, 'user-work.txt'), 'preserved');
  assert.equal(setup().dir, first.dir);
  assert.equal(readFileSync(join(first.dir, 'user-work.txt'), 'utf8'), 'preserved');
});
