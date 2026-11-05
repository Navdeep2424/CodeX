import { pathToFileURL } from 'node:url';

export function summarizeTasks(tasks) {
  if (!Array.isArray(tasks)) throw new TypeError('Expected an array of tasks');
  const done = tasks.filter(t => t.done === true).length;
  return { total: tasks.length, done, remaining: tasks.length - done };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log('Codex harness demo');
  console.log(summarizeTasks([{ title: 'Set up the harness', done: true }, { title: 'Try a coding task', done: false }]));
}
