# HACS data tables (generated)

The simulation's tables, exported from the JS source by `node tools/exportdata.js` as the native port's shared data. Do not
edit these files: change the source module and export again. `node tools/exportdata.js --check` says whether they are current.

## Files

- One file per source module: `weapons.json` from `src/weapons.js`, `physics-config.json` from `src/physics/config.js` (a `/`
  in the path becomes `-`).
- Each file is `{ "version": 1, "source": "src/<module>.js", "tables": { "<NAME>": <table> } }`. `<NAME>` is the exported name
  in the source (`WEAPONS`, `STYLES`, `WORLD`...).
- `manifest.json` lists every file with its source, its tables, its size, a sha256 prefix of its text, how many non-finite
  numbers it holds, and how many paths were left out (with examples).

## Encoding

- Objects, arrays, strings, booleans and finite numbers are plain JSON. Numbers are written by JavaScript's shortest
  round-trip form, so reading them back as IEEE doubles gives the same bits.
- A number JSON cannot hold is `{ "$number": "Infinity" }`, `"-Infinity"` or `"NaN"`. In version 1 there are 12 of them
  (weapons 7, moves 4, WORLD 1), all `Infinity` meaning "no limit". Read them back as the double, not as a large sentinel.
- A Set is `{ "$set": [ ... ] }`, in insertion order.
- A value `undefined` in the source is left out of its object; in an array it is `null`.
- Code is not data and is left out:
  - functions: the battles' `cast(random)` generators in `SCENARIOS` (25), which draw armies from `cast.js`'s builders over
    `PERIOD_BUILD`, so a port writes them as code over the exported `PERIOD_BUILD`;
  - getters: `CUSTOM_BATTLE.maps.pyongyang` and `.canaltown`, whose ground is built by the places' plans.

  Each left-out path is listed in the manifest.
- An object used in two places in the source (an alias of a shared constant) is written out in full at each. JSON has no
  references, and a table never relies on two entries being the same object.

## Versions

- `version` (here and in the manifest) is the format's version (`DATA_VERSION` in `tools/exportdata.js`). It is bumped when
  the encoding changes, not when the game's numbers change.
- The numbers change with the game. The manifest's hashes say which files did.
