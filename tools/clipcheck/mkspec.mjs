// node mkspec.mjs <out.json> [sexes] [builds] [kinds-filter]: the runs for a sweep: every design (not level-only) of every kit.
import { writeFileSync } from 'node:fs';
import { OUTFITS } from '../../src/outfits.js';
import { PRESETS, normaliseInputs } from '../../src/body.js';
const [out, sexArg = 'male', buildArg = 'N', filter = ''] = process.argv.slice(2);
const BUILDS = {
  male: { E: [0.04, 0], N: [0.16, 0], M: [0.1, 0.7], F1: [0.22, 0], F2: [0.3, 0], F3: [0.38, 0], F4: [0.55, 1] },
  female: { E: [0.12, 0], N: [0.3, 0], M: [0.12, 1], F1: [0.38, 0], F2: [0.46, 0], F3: [0.55, 0], F4: [0.55, 1] },
};
const runs = [];
const kinds = Object.keys(OUTFITS).filter((k) => !filter || filter.split(',').includes(k));
for (const kind of kinds) {
  const preset = Object.entries(PRESETS).find(([, p]) => p.outfit?.kind === kind)?.[0] ?? 'contender';
  if (PRESETS[preset]?.build) continue;
  OUTFITS[kind].designs.forEach((design, index) => {
    for (const sex of sexArg.split(',')) for (const build of buildArg.split(',')) {
      if (design.sex && design.sex !== sex) continue;
      const [bodyFat, exercise] = BUILDS[sex][build];
      const { calories: _, ...base } = PRESETS[preset];
      const calories = normaliseInputs({ ...base, sex, bodyFat, exercise }).calories;
      runs.push({ key: `${kind}/${index}/${sex}/${build}`, entry: { preset, sex, calories, exercise, outfit: { kind, design: index } } });
    }
  });
}
writeFileSync(out, JSON.stringify({ runs, count: 6, every: 15, reloadEvery: 40 }));
console.log(runs.length, 'runs');
