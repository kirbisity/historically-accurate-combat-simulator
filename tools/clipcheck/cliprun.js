// Runner helpers on top of __clip (evaluated after clipdetect.js).
// __clipRun.man(entry, foe): a duel in the Colosseum with `entry` (fight inputs) as man 0; built, skins finished, merged.
// __clipRun.sample(count, every, { pictures }): frame 0 then `count` more captures `every` frames apart, each analysed
// against frame 0; with pictures, the worst frames' marked pictures (front and back) are kept as data URLs.
window.__clipRun = {
  man(entry, foe = { preset: 'kanabo' }, seed = 1) {
    boxer.fight([entry], [foe], { place: 'colosseum', seed, distance: 2.4 });
    boxer.capture(true);
    boxer.finishBuilding();
    boxer.playFrames(2);
    boxer.finishSkins();
    boxer.playFrames(3);
    return boxer.state.world.fighters.map((fighter) => fighter.inputs?.outfit ?? null);
  },
  sample(count = 24, every = 6, { pictures = 0, picturesAt = null, zoom = 0, probe = 0 } = {}) {
    const ref = window.__clip.capture(0);
    const rest = window.__clip.analyse([ref], { keepPoints: pictures > 0 })[0];
    const shots = [];
    const keep = (result, f) => {
      if (!pictures) return;
      const wanted = picturesAt ? picturesAt.includes(f) : true;
      if (!wanted) return;
      const shot = { frame: f, poke: result.poke, front: window.__clip.picture(result.points, { yaw: 0 }), back: window.__clip.picture(result.points, { yaw: Math.PI }) };
      if (zoom) {
        // Close-ups of the bones with the most poked points, from the side most of them face.
        const byBone = new Map();
        for (const p of result.points) (byBone.get(p[4]) ?? byBone.set(p[4], []).get(p[4])).push(p);
        [...byBone.values()].sort((a, b) => b.length - a.length).slice(0, zoom).forEach((list, i) => {
          const c = [0, 1, 2].map((k) => list.reduce((t, p) => t + p[k], 0) / list.length);
          shot[`zoom${i}a`] = window.__clip.picture(result.points, { yaw: 0, focus: c, distance: 0.55, width: 400, height: 400 });
          shot[`zoom${i}b`] = window.__clip.picture(result.points, { yaw: Math.PI, focus: c, distance: 0.55, width: 400, height: 400 });
        });
      }
      if (probe) {
        // Close-ups looking straight at the outer face at a few poked points (deepest first, one per pair label).
        const seen = new Set();
        const picks = [...result.points].sort((a, b) => b[3] - a[3]).filter((p) => !seen.has(p[6]) && seen.add(p[6])).slice(0, probe);
        shot.probes = picks.map((p) => ({ label: p[6], depth: p[3], bone: p[4], a: window.__clip.picture([p], { focus: p.slice(0, 3), from: p[5], distance: 0.14, width: 300, height: 300, marker: 0.0015 }), b: window.__clip.picture([], { focus: p.slice(0, 3), from: p[5], distance: 0.14, width: 300, height: 300 }) }));
      }
      shots.push(shot);
      shots.sort((a, b) => b.poke - a.poke);
      if (shots.length > pictures) shots.length = pictures;
    };
    keep(rest, 0);
    delete rest.points;
    const motion = [];
    for (let i = 0; i < count; i += 1) {
      boxer.playFrames(every);
      const cur = window.__clip.capture(0);
      const result = window.__clip.analyse([ref, cur], { keepPoints: pictures > 0 })[1];
      result.frame = i + 1;
      keep(result, i + 1);
      delete result.points;
      motion.push(result);
    }
    const mean = (key) => +(motion.reduce((total, r) => total + r[key], 0) / Math.max(1, motion.length)).toFixed(2);
    const worst = motion.reduce((a, b) => (b.poke > a.poke ? b : a), motion[0] ?? rest);
    return { rest, meanPoke: mean('poke'), meanDeep: mean('deep'), maxPoke: worst?.poke ?? 0, worst, motion: motion.map((r) => r.poke), shots };
  },
};
return 'ok';
