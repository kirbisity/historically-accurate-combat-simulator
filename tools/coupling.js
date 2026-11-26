// Port groundwork (a native port later, the user's call, 2026-11-26): where the simulation and the drawing touch. Every module
// under src/ is read as text (no import is run): its imports, and the lines that reach for the browser or the clock (three.js,
// the DOM, window, storage, audio, workers, timers, performance.now and Date) or draw randomness from Math.random. A module is
// in the simulation when the headless fight reaches it by its imports from the sim roots (physics.js, ai.js, scenarios.js and
// the story battles: what tools/fingerprint.js runs); among those, any such line is a coupling, a place the sim would not carry
// into another engine as it stands. Outside the sim, a module that writes fields of a fighter or the world is the other way
// round: the drawing reaching into the sim's state. Not part of the game.
// Classes: sim, mixed (in the sim, with browser or clock lines), pulled (in the sim's graph only through DATA_PULLS),
// presentation (not reached, uses the browser), presentation-pure (not reached, plain code: drawing maths, audio data, level and
// story logic run by main.js).
// Usage: node tools/coupling.js [--json FILE] [--lines]   (--lines: every flagged line, not just the counts)

import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');

// What a line can reach for that another engine has no copy of. (`THREE.` is a global in the bundle; the sim imports no three.)
const REACHES = {
  three: /\bTHREE\./,
  dom: /\bdocument\.|\bHTMLElement\b|\bgetElementById\b|\bquerySelector\b|\bclassList\b/,
  window: /\bwindow\.|\bglobalThis\.(?!structuredClone)/,
  storage: /\blocalStorage\b|\bsessionStorage\b|\bindexedDB\b/,
  audio: /\bAudioContext\b|\bwebkitAudioContext\b/,
  worker: /\bnew Worker\b|\bpostMessage\b/,
  timers: /\brequestAnimationFrame\b|\bsetTimeout\b|\bsetInterval\b|\bqueueMicrotask\b/,
  clock: /\bperformance\.now\b|\bDate\.now\b|\bnew Date\b/,
  random: /\bMath\.random\b/,
};

// A write into the sim's state from outside it: `fighter.x = ...`, `world.view = ...` (not `==`, not a local named so).
const SIM_WRITE = /\b(fighter|world|state\.world|opponent|man|him|player\(\))\.[A-Za-z_$][\w$]*(?:\[[^\]]*\])?\s*(?:=(?!=)|\+=|-=|\?\?=|\|\|=)/;

// The sim's imports that fetch only a table or a plan out of a module whose purpose is drawing: [from, to, what is fetched].
// Everything reached only through these is presentation dragged into the sim's import graph ('pulled'): it loads in Node
// because its three.js and DOM code sits in functions the fight never calls. A port needs the table, not the module.
export const DATA_PULLS = [
  // (ARMOR_KINDS and pieceMaterial now live in armourkinds.js, SUBWAY_ARENA in props/arenasize.js: data modules, 2026-11-26.)
  ['scenarios.js', 'places/pyongyang.js', 'pyongyangTownTerrain: the town fight\'s solids'],
  ['custombattle.js', 'places/pyongyang.js', 'pyongyangPlan: the wall and field of the Pyongyang ground'],
  ['custombattle.js', 'places/canaltown.js', 'CANAL_TOWN, canalTownPlan: the canal town\'s court'],
  ['story/battles/03-pyongyang.js', 'places/pyongyang.js', 'pyongyangPlan'],
  ['wind.js', 'levelmode/stagelooks.js', 'stageLookOf: the wind of a stage\'s weather look'],
];

/** Every .js file under a directory. */
function walk(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? walk(path) : name.endsWith('.js') ? [path] : [];
  });
}

/** The lines that are code: line comments and block comments blanked. */
function codeLines(text) {
  const out = [];
  let inBlock = false;
  for (const raw of text.split('\n')) {
    let line = raw;
    if (inBlock) {
      const end = line.indexOf('*/');
      if (end < 0) { out.push(''); continue; }
      line = line.slice(end + 2);
      inBlock = false;
    }
    line = line.replace(/\/\*.*?\*\//g, '');
    const open = line.indexOf('/*');
    if (open >= 0) { line = line.slice(0, open); inBlock = true; }
    const comment = line.search(/(^|[^:'"`\\])\/\/(?![^'"`]*['"`]\s*[,;)])/);
    if (comment >= 0) line = line.slice(0, comment + 1);
    out.push(line);
  }
  return out;
}

function imports(path, text) {
  const found = new Set();
  for (const match of text.matchAll(/(?:^|\n)\s*(?:import|export)\s[^;]*?from\s+['"](\.[^'"]+)['"]/g)) found.add(resolve(dirname(path), match[1]));
  for (const match of text.matchAll(/(?:^|\n)\s*import\s+['"](\.[^'"]+)['"]/g)) found.add(resolve(dirname(path), match[1]));
  for (const match of text.matchAll(/\bimport\(\s*['"](\.[^'"]+)['"]\s*\)/g)) found.add(resolve(dirname(path), match[1]));
  return [...found].filter((file) => file.startsWith(SRC));
}

export function scan() {
  const files = walk(SRC);
  const modules = new Map();
  for (const path of files) {
    const text = readFileSync(path, 'utf8');
    const lines = codeLines(text);
    const hits = {};
    const writes = [];
    lines.forEach((line, index) => {
      // (Quoted strings blanked: a blurb that mentions a window is no reach for one.)
      const bare = line.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, "''");
      for (const [kind, pattern] of Object.entries(REACHES)) if (pattern.test(bare)) (hits[kind] ??= []).push(index + 1);
      if (SIM_WRITE.test(line)) writes.push(index + 1);
    });
    // Module-level mutable state: a top-level `let` (a world's state kept outside the world, shared by two worlds in one process).
    const topLets = lines.map((line, index) => (/^let\s/.test(line) ? index + 1 : 0)).filter(Boolean);
    // A data table: most of the file is a literal (lines that are only keys, numbers, strings and brackets).
    const literal = lines.filter((line) => /^\s*(?:[\w'"$-]+\s*:\s*)?(?:[-\d.e]+|'[^']*'|"[^"]*"|true|false|null|[[\]{}(),]|\{|\[)[\s,{}[\]\d.e'"-:]*$/.test(line) && line.trim()).length;
    const code = lines.filter((line) => line.trim()).length;
    modules.set(path, { path, rel: relative(SRC, path), lines: text.split('\n').length, code, literalShare: code ? literal / code : 0, imports: imports(path, text), hits, writes, topLets });
  }
  const resolveFile = (file) => (modules.has(file) ? file : modules.has(`${file}.js`) ? `${file}.js` : null);
  for (const module of modules.values()) module.imports = module.imports.map(resolveFile).filter(Boolean);
  // The sim: what the headless fight reaches (tools/fingerprint.js, tools/tableduel.js and the tests import these).
  const roots = ['physics.js', 'ai.js', 'scenarios.js', 'tableduel.js', 'ratings.js', 'command.js', 'control.js', 'finisher.js', 'battleend.js', 'battletally.js', 'lastgate.js', 'custombattle.js', 'levelmode/level.js', 'levelmode/stage.js', 'levelmode/awareness.js', 'story/runner.js']
    .concat([...modules.values()].filter((module) => /^story\/battles\//.test(module.rel)).map((module) => module.rel))
    .map((rel) => join(SRC, rel)).filter((file) => modules.has(file));
  const sim = new Set();
  const queue = [...roots];
  while (queue.length) {
    const file = queue.pop();
    if (sim.has(file)) continue;
    sim.add(file);
    queue.push(...modules.get(file).imports);
  }
  // The core: what the sim reaches without the imports that only fetch a table or a plan out of a drawing module (DATA_PULLS).
  const pulled = new Set(DATA_PULLS.map(([from, to]) => `${join(SRC, from)}>${join(SRC, to)}`));
  const core = new Set();
  const coreQueue = [...roots];
  while (coreQueue.length) {
    const file = coreQueue.pop();
    if (core.has(file)) continue;
    core.add(file);
    coreQueue.push(...modules.get(file).imports.filter((to) => !pulled.has(`${file}>${to}`)));
  }
  for (const module of modules.values()) {
    const browser = ['three', 'dom', 'window', 'storage', 'audio', 'worker', 'timers'].some((kind) => module.hits[kind]);
    module.inSim = sim.has(module.path);
    module.class = module.inSim
      ? (browser || module.hits.clock ? 'mixed' : 'sim')
      : (browser ? 'presentation' : 'presentation-pure');
    // (Reached only through a data pull: a drawing module the headless fight loads for one table; see DATA_PULLS.)
    if (module.inSim && !core.has(module.path)) module.class = 'pulled';
    if (module.inSim && module.literalShare > 0.6) module.data = true;
  }
  return { roots: roots.map((file) => relative(SRC, file)), modules: [...modules.values()].sort((a, b) => a.rel.localeCompare(b.rel)) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const { roots, modules } = scan();
  const jsonAt = process.argv.indexOf('--json');
  const showLines = process.argv.includes('--lines');
  const count = (kind) => modules.filter((module) => module.class === kind);
  const lines = (kind) => count(kind).reduce((sum, module) => sum + module.lines, 0);
  console.log(`roots: ${roots.length}; modules ${modules.length}: ${['sim', 'mixed', 'pulled', 'presentation', 'presentation-pure'].map((kind) => `${kind} ${count(kind).length} (${lines(kind)} lines)`).join(', ')}`);
  console.log('(sim: reached by the headless fight, nothing of the browser or the clock; mixed: reached, with such lines; pulled: reached only through DATA_PULLS; presentation: not reached, uses the browser; presentation-pure: not reached, plain code)');
  for (const module of modules.filter((m) => m.inSim)) {
    const flagged = Object.entries(module.hits).map(([kind, at]) => `${kind}:${showLines ? at.join(',') : at.length}`).join(' ');
    if (flagged || module.topLets.length) console.log(`${module.class.padEnd(6)} ${module.rel.padEnd(32)} ${String(module.lines).padStart(6)} ${flagged}${module.topLets.length ? ` toplet:${showLines ? module.topLets.join(',') : module.topLets.length}` : ''}`);
  }
  console.log('-- presentation modules writing sim fields (fighter.*/world.* =) --');
  for (const module of modules.filter((m) => !m.inSim && m.writes.length)) console.log(`${module.rel.padEnd(32)} ${showLines ? module.writes.join(',') : module.writes.length}`);
  if (jsonAt > 0) writeFileSync(process.argv[jsonAt + 1], JSON.stringify(modules.map(({ path, ...rest }) => ({ ...rest, imports: rest.imports.map((file) => relative(SRC, file)) })), null, 1));
}
