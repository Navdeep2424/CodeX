import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { HOME, readJSON, writeJSON, lock } from './store.mjs';
import { digest, checkGate, fingerprint } from './gate.mjs';

export const sessionFile = id => join(HOME, 'sessions', `${digest(id)}.json`);
export async function stopHook(input) {
  if (!input.session_id || input.agent_id || (input.hook_event_name && input.hook_event_name !== 'Stop')) return {};
  const file = sessionFile(input.session_id);
  if (!existsSync(file)) return {};
  let release;
  try { release = lock(`${file}.lock`); }
  catch { return { decision: 'block', reason: 'Another gate check is running for this session. Wait for that check, then finish again.' }; }
  try {
    const state = readJSON(file);
    if (state.done === 'failed') { rmSync(file); return {}; }
    if (state.done === 'passed' && state.fingerprint === fingerprint(state.dir)) { rmSync(file); return {}; }
    if (input.turn_id && state.turnId === input.turn_id) return state.response || {};
    state.turnId = input.turn_id;
    state.attempts++;
    let result;
    try { result = await checkGate(state.dir, state.gateHash); }
    catch (e) { result = { ok: false, dir: state.dir, checkedAt: new Date().toISOString(), error: e.message, results: [] }; }
    writeJSON(join(HOME, 'checks', `${digest(input.session_id)}.json`), result);
    let reason;
    if (result.ok) {
      state.done = 'passed'; state.fingerprint = fingerprint(state.dir);
      reason = `Gate passed: ${result.results.map(r => r.name).join(', ')}. Goal: ${state.goal}.\nComplete the authorized commit/PR handoff and report the checks. Do not change more code. Do not merge or deploy without authorization.`;
    } else {
      const failure = result.error || result.results.find(r => !r.ok)?.output || 'Unknown failure';
      state.done = state.attempts >= state.max ? 'failed' : null;
      reason = state.done ? `Gate still fails after ${state.max} attempts. Stop editing and report the blocker and branch; open a draft PR only if authorized and a remote is available.\n${failure.slice(-12000)}`
        : `Gate attempt ${state.attempts}/${state.max} failed. Goal: ${state.goal}.\nFix the cause, preserve the checks, then finish again. Project rules: ${(state.rules || []).join('; ')}\n${failure.slice(-12000)}`;
    }
    state.response = { decision: 'block', reason };
    writeJSON(file, state);
    return state.response;
  } finally { release(); }
}
