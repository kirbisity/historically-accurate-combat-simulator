// Port groundwork (a native port later, the user's call, 2026-11-26): the same fights in two JavaScript engines, V8 (this node)
// and JavaScriptCore (Safari's and the iPhone's engine: macOS ships its shell, jsc), hashed every 60 steps as tools/determinism.js
// hashes a step. Where they part, float results differ between the engines: their Math.sin, exp, pow, atan2, hypot... are not
// the same library (measured 2026-11-26: every transcendental differs in its last bits on some inputs; + - * / and sqrt agree).
// The fights are bundled with esbuild (the devDependency) into one module both engines can load; structuredClone is a JSON copy
// in both (the jsc shell has none). Not part of the game.
// Usage: node tools/crossengine.js [--jsc PATH] [--steps-scale 1]   (ESBUILD=path: an esbuild other than the one in node_modules)

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const jscAt = args.indexOf('--jsc');
const JSC = jscAt >= 0 ? args[jscAt + 1] : '/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc';
const scaleAt = args.indexOf('--steps-scale');
const scale = scaleAt >= 0 ? Number(args[scaleAt + 1]) : 1;

const ENTRY = `
const out = typeof print === 'function' ? print : console.log;
import { thinkAll } from ${JSON.stringify(join(ROOT, 'src/ai.js'))};
import { step } from ${JSON.stringify(join(ROOT, 'src/physics.js'))};
import * as cases from ${JSON.stringify(join(ROOT, 'tools/simcases.js'))};
const bits = new Float64Array(1);
const words = new Uint32Array(bits.buffer);
// (tools/determinism.js hashWorld without the draws: that module imports node's own.)
function hashWorld(world) {
  let value = 2166136261;
  const word = (n) => { value ^= n >>> 0; value = Math.imul(value, 16777619) >>> 0; };
  const float = (n) => { bits[0] = n; word(words[0]); word(words[1]); };
  for (const fighter of world.fighters) {
    for (const c of fighter.x) float(c);
    for (const c of fighter.prev) float(c);
    for (const ch of String(fighter.state)) word(ch.charCodeAt(0));
    float(fighter.health ?? 0);
  }
  word(world.events.length);
  word(0);
  return value;
}
const RUNS = { duel: [() => cases.duel('plate', 'tosei', 7), ${Math.round(3600 * scale)}], '2v2': [() => cases.team(['plate', 'footSpear'], ['tosei', 'mingDao'], 7), ${Math.round(2400 * scale)}], battle60: [() => cases.scaledBattle('sarhu', 60, 7), ${Math.round(900 * scale)}] };
for (const [name, [make, steps]] of Object.entries(RUNS)) {
  const world = make();
  const marks = [];
  for (let index = 1; index <= steps; index += 1) {
    thinkAll(world, 1 / 60);
    step(world, 1 / 60);
    if (index % 60 === 0) marks.push(hashWorld(world).toString(16).padStart(8, '0'));
  }
  out(name + ' ' + marks.join(' '));
}
`;

const dir = mkdtempSync(join(tmpdir(), 'hacs-crossengine-'));
writeFileSync(join(dir, 'entry.mjs'), ENTRY);
const esbuild = process.env.ESBUILD ?? join(ROOT, 'node_modules/.bin/esbuild');
if (!existsSync(esbuild)) throw new Error('esbuild not installed: npm install first');
const banner = "globalThis.structuredClone = (v) => JSON.parse(JSON.stringify(v)); if (typeof globalThis.performance === 'undefined') globalThis.performance = { now: () => Date.now() };";
execFileSync(esbuild, [join(dir, 'entry.mjs'), '--bundle', '--format=esm', '--platform=neutral', `--outfile=${join(dir, 'bundle.mjs')}`, '--log-level=warning', `--banner:js=${banner}`]);
const read = (text) => Object.fromEntries(text.trim().split('\n').map((line) => line.split(' ')).map(([name, ...marks]) => [name, marks]));
const v8 = read(execFileSync(process.execPath, [join(dir, 'bundle.mjs')], { maxBuffer: 1 << 26 }).toString());
if (!existsSync(JSC)) {
  console.log(`no jsc at ${JSC}: V8 only`, Object.fromEntries(Object.entries(v8).map(([name, marks]) => [name, marks.at(-1)])));
} else {
  const jsc = read(execFileSync(JSC, ['-m', join(dir, 'bundle.mjs')], { maxBuffer: 1 << 26 }).toString());
  for (const name of Object.keys(v8)) {
    const apart = v8[name].findIndex((mark, index) => mark !== jsc[name]?.[index]);
    console.log(`${name.padEnd(9)} V8 ${v8[name].at(-1)} JSC ${jsc[name]?.at(-1)}: ${apart < 0 ? 'identical' : `apart by second ${apart + 1} of ${v8[name].length}`}`);
  }
}
