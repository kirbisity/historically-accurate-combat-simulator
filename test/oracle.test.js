// The oracle's comparator (tools/oraclecheck.js): a baseline passes against itself, a moved metric fails, a candidate's own
// count and spread set its tolerance, and a metric with no samples is skipped rather than failed. Port groundwork; no fight.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { check } from '../tools/oraclecheck.js';
import { toleranceOf } from '../tools/oracle.js';

const baseline = {
  schema: 'hacs-oracle/1',
  metrics: {
    'duel/a/b/win': { kind: 'rate', value: 0.5, n: 32 },
    'duel/a/b/secondsToDecide': { kind: 'mean', value: 20, n: 30, sd: 8 },
    'battle/x/down/red/30s': { kind: 'mean', value: 100, n: 3, sd: 7 },
    'duel/c/d/secondsToDecide': { kind: 'mean', value: null, n: 0, sd: null },
  },
};

test('a baseline passes against itself; a missing metric is missing; no samples is skipped', () => {
  const same = check(baseline, baseline);
  assert.equal(same.failed, 0);
  assert.equal(same.missing, 0);
  assert.equal(same.skipped, 1);
  const { 'duel/a/b/win': _, ...rest } = baseline.metrics;
  assert.equal(check(baseline, { metrics: rest }).missing, 1);
});

test('a rate moved well past three standard errors fails; well within, it passes', () => {
  // (The candidate's own rate sets its share of the spread: a rate moved toward 0 or 1 is the surer, so the bound is not
  // exactly the baseline's own `tolerance`.)
  const tolerance = toleranceOf(baseline.metrics['duel/a/b/win']);
  assert.ok(tolerance > 0.3 && tolerance < 0.4, `tolerance ${tolerance}`);
  const moved = (value) => check(baseline, { metrics: { ...baseline.metrics, 'duel/a/b/win': { kind: 'rate', value, n: 32 } } }).failed;
  assert.equal(moved(0.5 + tolerance * 0.8), 0);
  assert.equal(moved(0.5 + tolerance * 1.2), 1);
});

test('a candidate that fights more seeds is judged more tightly', () => {
  const at = (n) => check(baseline, { metrics: { ...baseline.metrics, 'duel/a/b/secondsToDecide': { kind: 'mean', value: 25, n, sd: 8 } } }).rows.find((row) => row.key === 'duel/a/b/secondsToDecide').tolerance;
  assert.ok(at(300) < at(30), `${at(300)} < ${at(30)}`);
});
