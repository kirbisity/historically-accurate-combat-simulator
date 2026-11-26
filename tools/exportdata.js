// The simulation's data tables as versioned JSON, the port's shared data (port groundwork, the user's call, 2026-11-26): weapons,
// armour, materials, moves and styles, bodies, outfits, horses, the world's tuning, the AI's, the units and their ratings,
// the battles as far as they are data. One file per source module in data/, and data/manifest.json naming each file, its
// tables, its hash and what was left out. The format is data/SCHEMA.md. Not part of the game.
//
// Usage: node tools/exportdata.js            write data/*.json
//        node tools/exportdata.js --check    say whether data/ is what the source makes now (exit 1 if not)

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data');

/** The data format's version: bumped when the encoding (not the game's numbers) changes. */
export const DATA_VERSION = 1;

// The tables, by the module that holds them (src/...): the ones the simulation reads.
export const TABLES = {
  'weapons.js': ['WEAPONS', 'SHIELDS', 'MATERIALS', 'BLADES', 'PUNCTURE', 'GUN', 'ARROW', 'THROWABLES', 'NET'],
  'armourkinds.js': ['ARMOR_KINDS'],
  'outfits.js': ['OUTFITS', 'FACTIONS', 'HEADGEAR'],
  'moves.js': ['MOVES', 'STYLES', 'DEFENCES', 'STRATEGIES'],
  'body.js': ['PRESETS', 'FRAMES', 'BODY', 'PARTICLES', 'SEGMENTS'],
  'physics/config.js': ['WORLD'],
  'ai.js': ['AI'],
  'horses.js': ['HORSES', 'BARDING', 'HORSE_LOAD'],
  'maiming.js': ['MAIMING'],
  'riding.js': ['RIDING'],
  'command.js': ['COMMAND'],
  'formation.js': ['DRILL', 'WINGS'],
  'tableduel.js': ['TABLE_DUEL'],
  'control.js': ['CONTROL'],
  'pose.js': ['POSE'],
  'cast.js': ['CAST', 'PERIOD_BUILD'],
  'roster.js': ['WARRIORS'],
  'ratings.js': ['RATINGS'],
  'props/arenasize.js': ['PLACE_ARENAS', 'SUBWAY_ARENA', 'COLOSSEUM'],
  'custombattle.js': ['CUSTOM_BATTLE'],
  'scenarios.js': ['SCENARIOS'],
};

/**
 * A table as JSON-ready data: numbers JSON has not as { "$number": "Infinity" | "-Infinity" | "NaN" }, functions, getters and
 * class instances left out and their paths listed (`omitted`: code, not data, which a port writes as code). A shared object is
 * written where it is met each time (JSON has no references; in the tables a share is only an alias of a constant).
 */
function encodeTable(value, path, omitted, stack = new Set()) {
  if (value === undefined) return undefined;
  if (typeof value === 'function') {
    omitted.push(`${path} (function)`);
    return undefined;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : { $number: String(value) };
  if (value === null || typeof value !== 'object') return value;
  if (stack.has(value)) {
    omitted.push(`${path} (cycle)`);
    return undefined;
  }
  if (value instanceof Set || value instanceof Map || ArrayBuffer.isView(value) || value instanceof RegExp) {
    if (value instanceof Set) return { $set: [...value].map((entry, index) => encodeTable(entry, `${path}{${index}}`, omitted, stack)) };
    if (ArrayBuffer.isView(value)) return Array.from(value);
    omitted.push(`${path} (${value.constructor.name})`);
    return undefined;
  }
  stack.add(value);
  let out;
  if (Array.isArray(value)) out = value.map((entry, index) => encodeTable(entry, `${path}[${index}]`, omitted, stack) ?? null);
  else {
    out = {};
    for (const key of Object.keys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor.get) {
        omitted.push(`${path}.${key} (getter)`);
        continue;
      }
      const entry = encodeTable(value[key], `${path}.${key}`, omitted, stack);
      if (entry !== undefined) out[key] = entry;
    }
  }
  stack.delete(value);
  return out;
}

async function build() {
  const files = {};
  const manifest = { version: DATA_VERSION, files: {} };
  for (const [module, names] of Object.entries(TABLES)) {
    const source = await import(join(ROOT, 'src', module));
    const omitted = [];
    const tables = {};
    for (const name of names) {
      if (!(name in source)) throw new Error(`exportdata: src/${module} exports no ${name}`);
      tables[name] = encodeTable(source[name], name, omitted);
    }
    const file = `${module.replace(/\.js$/, '').replace(/\//g, '-')}.json`;
    const text = `${JSON.stringify({ version: DATA_VERSION, source: `src/${module}`, tables }, null, 1)}\n`;
    files[file] = text;
    const nonFinite = (text.match(/"\$number"/g) ?? []).length;
    manifest.files[file] = { source: `src/${module}`, tables: names, bytes: text.length, sha256: createHash('sha256').update(text).digest('hex').slice(0, 16), nonFinite, omitted: omitted.length, omittedExamples: omitted.slice(0, 12) };
  }
  files['manifest.json'] = `${JSON.stringify(manifest, null, 1)}\n`;
  return files;
}

const files = await build();
if (process.argv.includes('--check')) {
  const stale = Object.entries(files).filter(([file, text]) => !existsSync(join(OUT, file)) || readFileSync(join(OUT, file), 'utf8') !== text).map(([file]) => file);
  console.log(stale.length ? `data/ is stale: ${stale.join(', ')} (node tools/exportdata.js)` : 'data/ is current');
  process.exit(stale.length ? 1 : 0);
}
mkdirSync(OUT, { recursive: true });
for (const [file, text] of Object.entries(files)) writeFileSync(join(OUT, file), text);
const manifest = JSON.parse(files['manifest.json']);
for (const [file, entry] of Object.entries(manifest.files)) console.log(`${file.padEnd(26)} ${String(Math.round(entry.bytes / 1024)).padStart(5)} KB  ${entry.tables.join(', ')}${entry.nonFinite ? `  non-finite ${entry.nonFinite}` : ''}${entry.omitted ? `  omitted ${entry.omitted}` : ''}`);
