// Port groundwork (a native port later, the user's call, 2026-11-26): judge a candidate's results against the oracle's baseline
// (tools/oracle.js; the schema is docs/oracle.md). The candidate may come from any implementation: a JSON file of the same schema
// whose metrics are keyed as the baseline's. Each metric passes when the candidate's value is within its tolerance of the
// baseline's: TOLERANCE.z standard errors of the difference, from the baseline's spread and count and the candidate's own (or
// the baseline's spread at the candidate's count, where the candidate gives none). A metric the candidate lacks is missing; one
// with no samples on either side (no decided bouts) is skipped. The verdict is a pass when no more than `--allow` of the metrics
// checked fail (by default 1% of them, at least one: at z = 3 about 0.3% fail by chance alone) and none is missing.
// Not part of the game.
// Usage: node tools/oraclecheck.js CANDIDATE.json [--baseline oracle/baseline.json] [--z 3] [--allow N] [--only PREFIX] [--all] [--json FILE]
//        (--all: list every metric, not only those that fail or are missing; exit code 1 on a fail)

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spreadOf, TOLERANCE } from './oracle.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function option(args, name, fallback) {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : fallback;
}

/** The tolerance between a baseline metric and a candidate's: the candidate's spread its own where it gives one (a mean's sd). */
function tolerance(base, candidate, z) {
  const theirs = { ...base, value: candidate.value, n: candidate.n ?? base.n, sd: candidate.sd ?? base.sd };
  const error = Math.sqrt(spreadOf(base) ** 2 / base.n + spreadOf(theirs) ** 2 / theirs.n);
  return Math.max(z * error, TOLERANCE.floorAbs[base.kind] ?? 0);
}

export function check(baseline, candidate, { z = TOLERANCE.z, only = null } = {}) {
  const rows = [];
  for (const [key, base] of Object.entries(baseline.metrics)) {
    if (only && !key.startsWith(only)) continue;
    const theirs = candidate.metrics?.[key];
    if (!base.n || base.value === null) {
      rows.push({ key, status: 'skipped', why: 'no samples in the baseline' });
      continue;
    }
    if (!theirs) {
      rows.push({ key, status: 'missing', base: base.value });
      continue;
    }
    // (A mean over decided bouts only, none decided in the candidate: no samples to compare; the bouts' draw rate says how far apart they are.)
    if (theirs.value === null || theirs.value === undefined || !theirs.n) {
      rows.push({ key, status: 'skipped', why: 'no samples in the candidate' });
      continue;
    }
    const allowed = tolerance(base, theirs, z);
    const difference = theirs.value - base.value;
    rows.push({ key, status: Math.abs(difference) <= allowed ? 'pass' : 'fail', base: base.value, candidate: theirs.value, difference: +difference.toPrecision(4), tolerance: +allowed.toPrecision(4), sigmas: +((Math.abs(difference) / allowed) * z).toFixed(2), n: [base.n, theirs.n] });
  }
  const checked = rows.filter((row) => row.status === 'pass' || row.status === 'fail');
  const failed = rows.filter((row) => row.status === 'fail');
  const missing = rows.filter((row) => row.status === 'missing');
  return { rows, checked: checked.length, passed: checked.length - failed.length, failed: failed.length, missing: missing.length, skipped: rows.length - checked.length - missing.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const valued = new Set(['--baseline', '--z', '--allow', '--only', '--json']);
  const candidatePath = args.find((arg, index) => !arg.startsWith('--') && !valued.has(args[index - 1]));
  if (!candidatePath) {
    console.error('usage: node tools/oraclecheck.js CANDIDATE.json [--baseline oracle/baseline.json] [--z 3] [--allow N] [--only PREFIX] [--all] [--json FILE]');
    process.exit(2);
  }
  const baseline = JSON.parse(readFileSync(resolve(ROOT, option(args, '--baseline', 'oracle/baseline.json')), 'utf8'));
  const candidate = JSON.parse(readFileSync(resolve(candidatePath), 'utf8'));
  if (candidate.schema !== baseline.schema) console.log(`warning: schema ${candidate.schema} against the baseline's ${baseline.schema}`);
  const z = Number(option(args, '--z', TOLERANCE.z));
  const result = check(baseline, candidate, { z, only: option(args, '--only', null) });
  const allow = Number(option(args, '--allow', Math.max(1, Math.floor(result.checked * 0.01))));
  const verdict = result.failed <= allow && result.missing === 0 ? 'PASS' : 'FAIL';
  const shown = args.includes('--all') ? result.rows : result.rows.filter((row) => row.status === 'fail' || row.status === 'missing');
  for (const row of shown.sort((a, b) => (b.sigmas ?? 99) - (a.sigmas ?? 99))) {
    if (row.status === 'missing') console.log(`missing  ${row.key} (baseline ${row.base})`);
    else if (row.status === 'skipped') console.log(`skipped  ${row.key}: ${row.why}`);
    else console.log(`${row.status.padEnd(8)} ${row.key}: ${row.candidate} against ${row.base} (difference ${row.difference}, tolerance ${row.tolerance}, ${row.sigmas} sigma, n ${row.n.join('/')})`);
  }
  console.log(`${verdict}: ${result.passed}/${result.checked} metrics within tolerance (z ${z}), ${result.failed} failed (allowed ${allow}), ${result.missing} missing, ${result.skipped} skipped; candidate ${candidate.producer?.engine ?? '?'} ${candidate.producer?.commit ?? ''}`);
  const jsonAt = args.indexOf('--json');
  if (jsonAt >= 0) writeFileSync(args[jsonAt + 1], JSON.stringify({ verdict, allow, z, ...result }, null, 1));
  if (verdict === 'FAIL') process.exitCode = 1;
}
