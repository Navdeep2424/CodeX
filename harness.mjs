#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, rmSync, realpathSync } from 'node:fs';
import { join, basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { ROOT, HOME, GIT, expand, init, projects, project, tasks, task, updateTask, mutate, writeJSON, readJSON, git, repoRoot, defaultBranch, slug, run } from './lib/store.mjs';
import { checkGate, loadGate, fingerprint } from './lib/gate.mjs';
import { stopHook, sessionFile } from './lib/hook.mjs';

export function parse(args) {
  const words = [], flags = {};
  const bools = new Set(['json', 'github', 'dry-run']);
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith('--')) { words.push(args[i]); continue; }
    const key = args[i].slice(2);
    if (bools.has(key)) flags[key] = true;
    else { if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Missing value for --${key}`); flags[key] = args[++i]; }
  }
  return { words, flags };
}
export function addProject(dir, flags = {}) {
  dir = repoRoot(dir);
  const id = slug(flags.id || basename(dir).toLowerCase().replace(/[^a-z0-9-]/g, '-'));
  const baseBranch = defaultBranch(dir);
  let origin = null; try { origin = git(dir, 'remote', 'get-url', 'origin'); } catch {}
  const p = { id, name: flags.name || basename(dir), what: flags.what || '', dir, baseBranch, origin,
    keywords: (flags.keywords || id).split(',').map(s => s.trim()).filter(Boolean),
    public: { branches: [baseBranch], notes: ['Production deployment, live data changes, and messages to other people require user authorization.'] } };
  mutate('projects.json', { projects: [] }, data => {
    if (data.projects.some(p => p.id === id || p.dir === dir)) throw new Error('That project id or repository is already registered.');
    data.projects.push(p);
  });
  const wiki = join(HOME, 'wiki', `${id}.md`);
  if (!existsSync(wiki)) writeFileSync(wiki, `# ${p.name}\n\n${p.what}\n\nRepository: ${dir}\n\n## Decisions and handoffs\n`, { mode: 0o600 });
  return p;
}
export function route(text) {
  const q = text.toLowerCase();
  const ranked = projects().map(p => ({ id: p.id, score: [p.id, p.name, ...(p.keywords || [])].reduce((n, term) => n + (term && q.includes(term.toLowerCase()) ? 1 : 0), 0) }))
    .filter(p => p.score > 0).sort((a, b) => b.score - a.score);
  return { project: ranked.length && (ranked.length === 1 || ranked[0].score > ranked[1].score) ? ranked[0].id : null, candidates: ranked };
}
export function addTask(projectId, goal) {
  project(projectId); if (!goal?.trim()) throw new Error('A task needs a goal.');
  const t = { id: randomUUID().slice(0, 8), project: projectId, goal, status: 'queued', created: new Date().toISOString() };
  mutate('tasks.json', { tasks: [] }, data => { data.tasks.push(t); }); return t;
}
export function prepareTask(id) {
  const t = task(id); const p = project(t.project);
  if (t.dir) { if (!existsSync(t.dir)) throw new Error(`Task worktree is missing: ${t.dir}`); return t; }
  if (git(p.dir, 'status', '--porcelain')) throw new Error('The source repository has uncommitted changes. Commit or stash them before preparing a task.');
  const sourceGate = loadGate(p.dir);
  const branch = `task/${t.id}`;
  const dir = join(HOME, 'worktrees', p.id, t.id);
  mkdirSync(dirname(dir), { recursive: true });
  git(p.dir, 'worktree', 'add', '-b', branch, dir, p.baseBranch);
  return updateTask(id, { dir, branch, baseBranch: p.baseBranch, gateHash: sourceGate.hash, status: 'prepared', baseCommit: git(dir, 'rev-parse', 'HEAD') });
}
export function workerBrief(id) {
  const t = task(id), p = project(t.project);
  if (!t.dir) throw new Error('Prepare the task first.');
  const cli = JSON.stringify(join(ROOT, 'harness.mjs'));
  return `Work on this Codex harness task in ${t.dir}.\nGoal: ${t.goal}\nTask id: ${t.id}; branch: ${t.branch}; PR base: ${t.baseBranch}.\nGit executable for this machine: ${GIT}. Use this path for Git commands when system Git is unavailable.\nRead the project's AGENTS.md and ${join(HOME, 'wiki', `${p.id}.md`)} first.\nPlan briefly, implement, run the real checks, fix their causes, and review the diff independently when delegation is available and authorized.\nRun: node ${cli} gate check --dir ${JSON.stringify(t.dir)}\nUse at most ${loadGate(t.dir).config.tries} check/fix cycles. Never weaken tests or the gate to pass.\nA top-level Codex worker can arm the Stop loop: node ${cli} gate on --dir ${JSON.stringify(t.dir)} --goal ${JSON.stringify(t.goal)}\nSubagents should run the explicit check/fix loop; do not arm a parent session's Stop hook.\nRecord a verified check result: node ${cli} task finish ${t.id}\nOne task, one worktree. Commit only task changes. Preserve the source checkout.\nGitHub origin: ${p.origin || '(none; report the local branch)'}\nFor an authorized PR handoff, push the task branch to origin and open a PR into ${t.baseBranch}; use connected GitHub tools or gh with an explicit repository.\nDo not merge, deploy, message others, or publish without user authorization. Never expand permissions or bypass approval/hook trust.\nReturn: outcome, branch/PR, checks, review findings, decisions, and remaining blockers.\n`;
}
export async function finishTask(id) {
  const t = task(id); if (!t.dir) throw new Error('Prepare the task first.');
  let result;
  try { result = await checkGate(t.dir, t.gateHash); }
  catch (e) { result = { ok: false, dir: t.dir, checkedAt: new Date().toISOString(), error: e.message, results: [] }; }
  writeJSON(join(HOME, 'checks', `${id}.json`), result);
  return updateTask(id, { status: result.ok ? 'ready' : 'blocked', checks: result, checkedFingerprint: result.ok ? fingerprint(t.dir) : null });
}
export function snapshot(withGithub = false) {
  return { generated: new Date().toISOString(), projects: projects().map(p => {
    const row = { ...p, tasks: tasks().filter(t => t.project === p.id).map(t => {
      let verified = false;
      try { verified = Boolean(t.checkedFingerprint && t.dir && t.checkedFingerprint === fingerprint(t.dir)); } catch {}
      return { ...t, checksCurrent: verified };
    }) };
    try { row.branch = git(p.dir, 'branch', '--show-current'); row.changes = git(p.dir, 'status', '--porcelain').split('\n').filter(Boolean).length; row.gate = existsSync(join(p.dir, '.codex/gate.json')); }
    catch (e) { row.error = e.message; }
    if (withGithub && p.origin) {
      const repo = githubRepo(p.origin);
      try { if (!repo) throw new Error('Origin is not a supported github.com URL.'); const localGh = join(homedir(), '.local/bin/gh'); row.prs = JSON.parse(run(existsSync(localGh) ? localGh : 'gh', ['pr', 'list', '--repo', repo, '--json', 'number,title,url,baseRefName,isDraft,statusCheckRollup'], p.dir)); }
      catch (e) { row.githubNote = e.message; }
    }
    return row;
  }) };
}
export function githubRepo(url) {
  return url?.match(/^(?:https:\/\/github\.com\/|git@github\.com:)([^/]+\/[^/]+?)(?:\.git)?$/)?.[1] || null;
}
function prettyStatus(s) {
  if (!s.projects.length) return 'No projects yet. Use: node harness.mjs add /path/to/repo --what "Description"';
  return s.projects.map(p => `${p.name} (${p.id}) — ${p.error || `${p.branch}, ${p.changes} unsaved changes, gate ${p.gate ? 'configured' : 'missing'}`}\n${p.tasks.map(t => `  ${t.id} [${t.status}${t.status === 'ready' && !t.checksCurrent ? ', checks stale' : ''}] ${t.goal}`).join('\n')}${p.githubNote ? `\n  GitHub: ${p.githubNote}` : ''}${p.prs ? '\n' + p.prs.map(pr => `  PR #${pr.number}: ${pr.title} — ${pr.url}`).join('\n') : ''}`).join('\n\n');
}
export function startDashboard(port = 4747) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid dashboard port.');
  const server = createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'unsafe-inline' 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'");
    if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
    if (req.url === '/api/status') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(snapshot())); return; }
    if (req.url !== '/') { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Codex Harness</title><style>body{font:16px system-ui;background:#f5f4ef;color:#202b25;max-width:1000px;margin:60px auto;padding:0 24px}h1{font-size:36px}article{background:white;border:1px solid #d7ddd4;border-radius:12px;padding:24px;margin:20px 0}small{color:#536659}li{margin:12px 0}button{padding:8px 14px;cursor:pointer}</style><h1>Codex Harness</h1><p>Projects and tasks on this computer.</p><button onclick="refresh()">Refresh</button><main id="projects"></main><small id="updated"></small><script>async function refresh(){try{const r=await fetch('/api/status');const data=await r.json();const root=document.getElementById('projects');root.replaceChildren();for(const p of data.projects){const card=document.createElement('article');const title=document.createElement('h2');title.textContent=p.name;card.append(title);const desc=document.createElement('p');desc.textContent=p.what;card.append(desc);const state=document.createElement('p');state.textContent=p.error||p.branch+' · '+p.changes+' uncommitted changes · checks '+(p.gate?'configured':'missing');card.append(state);const list=document.createElement('ul');for(const t of p.tasks){const item=document.createElement('li');item.textContent=t.status+(t.status==='ready'&&!t.checksCurrent?' (checks stale)':'')+' — '+t.goal;list.append(item)}card.append(list);root.append(card)}if(!data.projects.length)root.textContent='No projects registered.';document.getElementById('updated').textContent='Updated '+new Date(data.generated).toLocaleString()}catch(e){document.getElementById('updated').textContent='Could not refresh: '+e.message}}refresh();</script>`);
  });
  return server.listen(port, '127.0.0.1');
}
export async function main(args = process.argv.slice(2)) {
  const { words: [command = 'status', sub, ...rest], flags: f } = parse(args);
  if (command === 'hook') {
    try { console.log(JSON.stringify(await stopHook(JSON.parse(readFileSync(0, 'utf8') || '{}')))); }
    catch (e) { console.log(JSON.stringify({ systemMessage: `Codex harness hook error: ${e.message}. Run gate check explicitly; readiness is unverified.` })); }
    return;
  }
  init(); let result;
  if (command === 'init') result = { home: HOME };
  else if (command === 'doctor') result = { node: process.execPath, nodeVersion: process.version, git: GIT, gitVersion: run(GIT, ['--version']), home: HOME, source: ROOT };
  else if (command === 'add') { if (!sub) throw new Error('Usage: add /path/to/repo --what "Description"'); result = addProject(sub, f); }
  else if (command === 'route') result = route([sub, ...rest].filter(Boolean).join(' '));
  else if (command === 'status') { const s = snapshot(f.github); console.log(f.json ? JSON.stringify(s, null, 2) : prettyStatus(s)); return; }
  else if (command === 'brief') result = workerBrief(sub);
  else if (command === 'mc') { const s = startDashboard(Number(f.port ?? 4747)); s.on('listening', () => console.log(`Dashboard: http://127.0.0.1:${s.address().port}`)); return; }
  else if (command === 'task') {
    if (sub === 'add') result = addTask(rest[0], rest.slice(1).join(' '));
    else if (sub === 'list') result = tasks();
    else if (sub === 'prepare') result = prepareTask(rest[0]);
    else if (sub === 'finish') { result = await finishTask(rest[0]); if (result.status === 'blocked') process.exitCode = 1; }
    else if (sub === 'record') {
      if (!['working', 'blocked', 'done'].includes(f.status)) throw new Error('Record status must be working, blocked, or done; readiness is set by task finish.');
      const t = task(rest[0]);
      if (f.status === 'done' && (!t.dir || !t.checkedFingerprint || t.checkedFingerprint !== fingerprint(t.dir))) throw new Error('Run task finish successfully before recording done.');
      result = updateTask(rest[0], { status: f.status, note: f.note || '', ...(f.url ? { url: f.url } : {}) });
    } else throw new Error('Usage: task add|list|prepare|finish|record');
  } else if (command === 'gate') {
    const dir = repoRoot(f.dir || process.cwd());
    if (sub === 'check') {
      result = await checkGate(dir); if (!result.ok) process.exitCode = 1;
    } else {
      const sid = f.session || process.env.CODEX_THREAD_ID;
      if (!sid) throw new Error('No Codex session id. Run inside Codex or pass --session from the hook session_id.');
      const file = sessionFile(sid);
      if (sub === 'on') {
        const gate = loadGate(dir);
        if (!f.goal) throw new Error('Provide --goal "The requested outcome".');
        result = { dir, goal: f.goal, max: gate.config.tries, rules: gate.config.rules || [], gateHash: gate.hash, attempts: 0, started: new Date().toISOString() };
        writeJSON(file, result);
      } else if (sub === 'off') { rmSync(file, { force: true }); result = { active: false }; }
      else if (sub === 'status') result = readJSON(file, { active: false });
      else throw new Error('Usage: gate on|off|status|check --dir /repo');
    }
  } else if (command === 'wiki') {
    const p = project(rest[0]); const file = join(HOME, 'wiki', `${p.id}.md`);
    if (sub === 'show') result = readFileSync(file, 'utf8');
    else if (sub === 'note') {
      if (!f.text) throw new Error('Provide --text "Decision or handoff".');
      appendFileSync(file, `\n### ${new Date().toISOString()}\n${f.text}\n${f.source ? `Source: ${f.source}\n` : ''}`); result = { file };
    } else throw new Error('Usage: wiki show|note <project-id>');
  } else throw new Error('Commands: init, add, route, status, task, brief, gate, wiki, mc');
  console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 2));
}
if (process.argv[1] && realpathSync(resolve(process.argv[1])) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error(e.message); process.exitCode = 1; });
}
