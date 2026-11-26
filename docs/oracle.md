# The behaviour oracle

A port of the simulation (another engine, another language) cannot match this one hash for hash. Float maths differs
between engines (see the determinism notes), so the fights part within a second. What it can match is the
*behaviour*: who wins which matchups and how fast, the wounds weapons make through which armour, the disarms, deflects
and half-sword entries, and the casualties of a battle. The oracle fights a fixed corpus of reference fights over several
seeds and writes those distributions to `oracle/baseline.json`. Any implementation that fights the same corpus and writes
the same schema can be judged against it by `tools/oraclecheck.js`.

```
node tools/oracle.js                        # the baseline: oracle/baseline.json (about 5 minutes on 8 workers)
node tools/oracle.js --quick                # a smoke run: 3 seeds, battles 2 seeds and 20 s (oracle/quick.json)
node tools/oraclecheck.js candidate.json    # PASS or FAIL against oracle/baseline.json, failing metrics listed
```

Options for `oracle.js`:

| option | default | what it does |
|---|---|---|
| `--workers N` | 8 | processes fighting in parallel |
| `--seeds N` | 8 | bouts per matrix cell and per pair |
| `--seed-base S` | 1 | first seed (`--seed-base 101` gives an independent run, to check the tolerances) |
| `--battle-seeds N` | 3 | seeds per battle |
| `--only duel,reference,battle` | all | which parts of the corpus to fight |
| `--rebuild FILE` | | derive the metrics again from the fights kept in FILE, without fighting |
| `--perturb 'weapons.js:PUNCTURE.joules*0.7'` | | scale one number of a sim table first: a control run, to measure what the oracle can tell apart |

Options for `oraclecheck.js`:

| option | default | what it does |
|---|---|---|
| `--baseline FILE` | `oracle/baseline.json` | the baseline to judge against |
| `--z Z` | 3 | standard errors allowed |
| `--allow N` | 1% of the checked metrics, at least 1 | failures allowed |
| `--group-limit L` | 3.5 | the most a group's mean squared z may be |
| `--only PREFIX` | | check only metrics whose key starts with PREFIX |
| `--all` | | list every metric, not only failing ones |
| `--json FILE` | | write the result |

## The corpus

All fights run at 1/60 s steps: think (the AI), then step. Bouts run in whole seconds until `boutWinner` or the limit.
Each fight is fought in a fresh process. The sim keeps some state between worlds in its modules: `TABLE_DUEL.enabled`,
and physics/polegrip.js's grip cache, which makes a staff's grip depend on who held a staff first. So a fight's record must
not depend on what its process fought before. A port should fight each job from a clean state too. Run twice, in any
order and on any number of workers, the same jobs give identical records (`--reverse` checks it).

1. **Weapon x armour matrix** (`corpus.matrix`).
   - In each cell both men are the same reference body: the roster's `plate` warrior (178 cm, trained), with only
     `style` and `outfit.kind` replaced. Both wear the column's armour (`commoner`, `footman`, `samurai`, `knight`).
   - The row's man wields the row's weapon (style `longsword`, `katana`, `warhammer`, `spear`, `zweihander`, `staff`);
     the other wields the reference `longsword`.
   - The row's man takes red on odd seeds and blue on even ones. 60 s limit.
2. **Reference pairs** (`corpus.pairs`): roster warriors from the tests' reference cases. 90 s limit, the first named
   being "me", red on odd seeds:
   - doppelsoeldner against plate, against halberdier and against footSpear (test/zweihander.test.js);
   - plate against plate (the long sword's half-sword);
   - tosei against plate and hammer against plate (test/gaps.test.js);
   - shaolin against plate (the staff).
3. **The staff's smash** (`corpus.staffSmash`, as test/staffflex.test.js sets it):
   - the shaolin monk and the plate knight, placed 1.5 or 2.1 m apart, settled 0.3 s;
   - with the knight standing (no thinking, both cooled down) or parrying (thinking, the monk not);
   - the monk throws `staffSmash` at the head, and the next 1.4 s are read.
4. **Battles** (`corpus.battles`):
   - each battle's own cast, each side grown to half the men (its men repeated in order), the floor and the rows scaled
     by sqrt(men / 60), the last red man played (`world.perceiver`);
   - `sarhu600` and `wokou400` with the table on (src/tableduel.js `TABLE_DUEL.enabled`), as tools/tableduel.js and the
     crowd benchmark fight them; `sarhu60` in full physics;
   - read at 10, 20 and 30 s.

The exact set-up is `tools/simcases.js` (`kitDuel`, `duel`, `scaledBattle`) and `tools/oracle.js` (`runJob`). A port
needs the same roster entries, styles, outfits and battle casts: they are data tables (see the coupling audit).

## Reading a fight

From the bout's event log (`world.events`), "me" being the row's or the first-named man:

| record field | from |
|---|---|
| `result` | `win`, `loss` or `draw` (no winner at the limit) |
| `seconds` | world time when the bout was decided (null for a draw) |
| `end` | the kind of the first `killed`, `knockout` or `bledOut` event; `other` if decided without one; `none` for a draw |
| `landed`, `landedOn` | `landed` events with a `target` that are not a finisher's (`punch !== 'execute'`), by me on the foe, and by the foe on me |
| `wounds.<kind>` | my landed blows whose `effects` (joined with '; ') match the kind's pattern (below); a blow counts once in each kind it matches |
| `disarmedMe`, `disarmedFoe` | `disarmed` events by `fighter` |
| `deflectsBy` | `deflect` events whose `fighter` (the man who turned the blow) is me |
| `halfSwordMe`, `halfSwordFoe` | `halfSword` events by `fighter` |
| `severed` | `severed` events on the foe |
| `weaponBroke` | `weaponBroke` events of mine |

Wound kinds (`corpus.woundKinds`, regular expressions over the effect texts):

| kind | pattern |
|---|---|
| glance | `glance` |
| cut | `\bcut\b\|cut opened\|cut off\|severed\|the bone cut` |
| stab | `stabbed\|run through\|through the (?:heart\|brain\|chest\|head\|arm)\|driven through` |
| gap | `into a gap in the armour` |
| fracture | `fracture\|broken\|shattered` |
| concussion | `knock\|dazed\|stunned\|reels\|knockdown` |

A port that names its effects differently maps its own wound outcomes onto these kinds. The kinds are the contract, not
the English.

A staff smash reads:

- `thrown`: `throwPunch` took it;
- `landed`: a `landed` event of the monk's `staffSmash`;
- `speed`: the fastest such landing's `speed`, m/s;
- `clash`: the highest `energy` of a `clash` the monk was in, J;
- `broke`: a `weaponBroke` of the monk's.

A battle reads each side's men whose `state` is not `up` (down, out, crawling, dead) at each 10 s.

## The schema (`hacs-oracle/1`)

```json
{
  "schema": "hacs-oracle/1",
  "producer": { "engine": "hacs-js", "commit": "abc1234", "node": "v22.2.0", "date": "...", "seeds": 8, "seedBase": 1, "battleSeeds": 3, "jobs": 273, "wallSeconds": 300 },
  "tolerance": { "z": 3, "floor": 0.1, "floorAbs": { "rate": 0.05, "mean": 0.25 } },
  "corpus": { "matrix": {...}, "pairs": [...], "pairSeconds": 90, "staffSmash": {...}, "battles": [...], "woundKinds": {...} },
  "metrics": {
    "duel/warhammer/knight/win": { "kind": "rate", "value": 0.625, "n": 8, "describes": "...", "tolerance": 0.6 },
    "duel/warhammer/knight/secondsToDecide": { "kind": "mean", "value": 26.8, "n": 6, "sd": 16.1, "unit": "s", "describes": "...", "tolerance": 20.1 }
  },
  "fights": [ { "job": { "type": "matrix", "weapon": "warhammer", "armour": "knight", "seed": 1 }, "out": { "result": "draw", ... } } ]
}
```

A candidate needs only `schema`, `producer` (any `engine` name) and `metrics`. Each metric it gives must carry the
following (the rest is optional):

- `kind`: `rate` (the share of samples that are 1) or `mean` (the mean of samples);
- `value`: a number, or null when it has no samples;
- `n`: the number of samples;
- for a mean, `sd`: the sample standard deviation, n - 1 in the denominator.

`fights` is optional, but useful: the per-fight records let distributions be compared in other ways later.

### Metric keys

`<group>/<case>/<metric>`, all of them built by `metricsFrom` in tools/oracle.js:

- **duel matrix.** Each cell is `duel/<weapon>/<armour>/...`; the row pooled over armours is `duel/<weapon>/any/...`,
  and the column pooled over weapons is `duel/any/<armour>/...`. Each has:
  - `win`, `draw` (rates);
  - `secondsToDecide` (mean over decided bouts);
  - `end/killed`, `end/knockout`, `end/bledOut` (rates over all bouts);
  - `landed`, `landedOn` (means per bout);
  - `wounds/glance|cut|stab|gap|fracture|concussion` (means per bout);
  - `disarmedSelf`, `disarmedFoe`, `deflects`, `halfSwordSelf`, `halfSwordFoe`, `severed`, `weaponBroke` (means per bout).
- **reference pairs**: `pair/<a>/<b>/...`, the same metrics with `a` as "me".
- **staff smash**: `staff/smash/<standing|parrying>/<1.5|2.1>m/thrown|landed|broke` (rates), and `speed` (m/s) and
  `clashJoules` (J) (means).
- **battles**: `battle/<key>/down/<red|blue>/<10|20|30>s` (means over seeds, men).

## Tolerances and the verdict

A metric passes when |candidate - baseline| <= max(z x SE, floorAbs[kind]), where SE = sqrt(s_b^2 / n_b + s_c^2 / n_c),
the standard error of the difference of two independent estimates:

- a **rate**'s s is the binomial's sqrt(p(1 - p)) at p smoothed by one success and one failure, (k + 1) / (n + 2), so a
  rate of 0 or 1 still has room;
- a **mean**'s s is its sample sd (the spread from seed to seed), but never under 10% of the value (`floor`) or 0.25
  (`floorAbs.mean`). The battles have three seeds each, so their sd is only a rough guess;
- the candidate's own `n` and `sd` are used where it gives them, and the baseline's spread at the candidate's `n` where it
  does not. A candidate that fights more seeds is judged more tightly.

`tolerance` in the baseline file is that bound for a candidate of the same `n` and value, for reading only. A rate's
spread uses each side's own rate, so a candidate whose rate has moved toward 0 or 1 gets a slightly tighter bound.

The verdict is PASS when three things hold:

- no metric is missing;
- at most `--allow` metrics fail. By default that is 1% of the metrics checked, and at least one. At z = 3 about 0.3% of
  the metrics would fail by chance alone if they were independent normal estimates; with small n and heavy tails it is a
  little more;
- no group of metrics has drifted together. A group is a weapon's row, an armour's column, a pair, a battle, or the staff's
  set piece. Its mean squared z must stay within `--group-limit` (default 3.5, `GROUP_LIMIT` in tools/oraclecheck.js).
  Under no change a metric's z is about standard normal. The metrics of a group are correlated, though (one long bout moves
  its landed count, wounds and time together), so a group's mean wanders more than a chi-square's would.

A metric with no samples on either side (a mean over decided bouts when none was decided) is skipped. The draw rate
carries that difference.

### What the oracle can tell apart (measured 2026-11-26)

They are wide for one cell: 8 bouts give a win rate to about ±0.25 either way, so a cell's tolerance is about 0.6. The
pooled rows and columns (32 and 48 bouts) are about twice as tight. The measurements, against the baseline (seeds 1 to 8):

| candidate | failed (allowed) | worst group, mean z² | verdict |
|---|---|---|---|
| the same sim, independent seeds (101 to 108), whole corpus | 4 (8) | pair hammer/plate 2.79; Sarhu 600 1.54 | PASS |
| `WEAPONS.warhammer.mass` x 2, seeds 101 on, duels | 3 (7) | row warhammer 0.67 | PASS: not detected |
| `PUNCTURE.joules` x 0.7, seeds 1 on, duels | 0 (7) | column samurai 0.64 | PASS: not detected |
| `PUNCTURE.joules` x 0.3, seeds 101 on, duels | 10 (7) | column samurai 3.72 | FAIL |

So at 8 seeds the oracle catches a gross change (a port that gets armour's puncture badly wrong, units, or a broken
mechanism). It does not catch a change of the size a tuning pass makes: twice the hammer's mass moved its cells' win rates
by 0.25 to 0.4, inside a cell's ±0.6. Fight more seeds on both sides for a stricter judge (the tolerance shrinks as
1/sqrt(n): 32 seeds halves it, at four times the cost, about 20 minutes on 8 workers). The group limit is calibrated on
one independent run only. Recalibrate it when the corpus or the seeds change.

## Changing the corpus

Changing the corpus or how a fight is read changes the metric keys or values. Regenerate the baseline and say so in the
commit. A change that only adds metrics can reuse the kept fights (`--rebuild oracle/baseline.json`). A change to the
sim itself (a physics or AI change) moves the baseline on purpose. Regenerate it, and check the change against the old
one first (`node tools/oraclecheck.js new.json --baseline old.json`): the failing metrics are what the change moved.
