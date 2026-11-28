// The poke-through check over every outfit (2026-11-27): where the skin or a garment under another shows through it, at rest
// and in a duel's motion. clipdetect.js reads back every drawn vertex of a man from his own vertex shaders (skinning, dual
// quaternions, cloth sway), finds for each the other surfaces within 2.5 cm and which side of them it lies on, and counts the
// area (cm2) of the inner surface out through the outer (skin and hair are under anything they lie in; otherwise the one
// mostly inside the other at rest), of a different colour only (the same cloth through itself does not show).
//   node tools/clipcheck/mkspec.mjs spec.json male,female N        (builds: E N M F1 F2 F3 F4)
//   Chrome with --remote-debugging-port=9351, the game served (spec.url, default http://localhost:8995/index.html)
//   node tools/clipcheck/sweep.mjs results.jsonl spec.json          (resumes: keys already in the file are skipped)
//   python3 tools/clipcheck/rank.py results.jsonl ranked.md
// spec: { runs: [{ key, entry }], count, every, reloadEvery, url }
import { readFileSync, appendFileSync, existsSync } from 'node:fs';
const [out, specFile] = process.argv.slice(2);
const spec = JSON.parse(readFileSync(specFile, 'utf8'));
const done = new Set(existsSync(out) ? readFileSync(out, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).key) : []);
const PORT = 9351;
const tab = await (await fetch(`http://localhost:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0;
const wait = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); }
});
const send = (method, params = {}) => new Promise((r) => { const n = ++id; wait.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
const evalJs = async (expr) => {
  const res = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true, timeout: 600000 });
  if (res.result?.exceptionDetails) return { error: res.result.exceptionDetails.exception?.description?.split('\n').slice(0, 3).join(' | ') ?? res.result.exceptionDetails.text };
  return res.result?.result?.value;
};
await send('Runtime.enable');
await send('Page.enable');
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
const load = async () => {
  await send('Page.navigate', { url: spec.url ?? 'http://localhost:8995/index.html' });
  for (let i = 0; i < 120 && !(await evalJs('typeof boxer !== "undefined" && !!boxer.state')); i += 1) await new Promise((r) => setTimeout(r, 1000));
  await evalJs(`(async () => { ${readFileSync(new URL('./clipdetect.js', import.meta.url), 'utf8')} })()`);
  await evalJs(`(async () => { ${readFileSync(new URL('./cliprun.js', import.meta.url), 'utf8')} })()`);
};
await load();
let since = 0;
for (const run of spec.runs) {
  if (done.has(run.key)) continue;
  if (since >= (spec.reloadEvery ?? 40)) { await load(); since = 0; }
  since += 1;
  const started = Date.now();
  const result = await evalJs(`(async () => { __clipRun.man(${JSON.stringify(run.entry)}); const r = __clipRun.sample(${spec.count ?? 6}, ${spec.every ?? 15}, ${JSON.stringify(spec.options ?? {})}); return r; })()`);
  appendFileSync(out, JSON.stringify({ key: run.key, entry: run.entry, ms: Date.now() - started, ...(result?.error ? { error: result.error } : result) }) + '\n');
  console.log(run.key, result?.error ? 'ERR ' + result.error : `rest ${result?.rest?.poke} mean ${result?.meanPoke} max ${result?.maxPoke}`, Date.now() - started, 'ms');
}
await fetch(`http://localhost:${PORT}/json/close/${tab.id}`);
ws.close();
