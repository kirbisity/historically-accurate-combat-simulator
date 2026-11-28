# python3 rank.py results.jsonl [out.md]: rank kits by poke-through and tally categories
import json, sys, re, collections
rows = [json.loads(l) for l in open(sys.argv[1]) if l.strip()]
rows = [r for r in rows if 'rest' in r]
def kind(label):
    if label == 'skin' or label == 'hair': return label
    if label.startswith('hand'): return 'hand'
    if label.startswith('body#'): return 'cloth'
    return 'rigid'
cat = collections.Counter(); bone = collections.Counter()
for r in rows:
    for res in [r['rest'], r['worst']]:
        for pair, n in res['top']:
            a, rest = pair.split(' > '); b, where = rest.split(' @')
            cat[f"{kind(a)} > {kind(b)}"] += n
            bone[f"{kind(a)} > {kind(b)} @{where}"] += n
rows.sort(key=lambda r: -(r['rest']['poke'] + r['meanPoke']))
out = []
tot = lambda k: sum(r[k] if not isinstance(r[k], dict) else r[k]['poke'] for r in rows)
out.append(f"runs {len(rows)}  total rest {tot('rest'):.0f} cm2  total mean-motion {tot('meanPoke'):.0f} cm2  total max {tot('maxPoke'):.0f} cm2")
out.append('\n| rank | man | rest cm2 | rest deep | motion mean | motion max | worst pairs |\n|---|---|---|---|---|---|---|')
for i, r in enumerate(rows):
    out.append(f"| {i+1} | {r['key']} | {r['rest']['poke']} | {r['rest']['deep']} | {r['meanPoke']} | {r['maxPoke']} | {'; '.join(p for p, n in r['worst']['top'][:3])} |")
out.append('\nCategories (poked vertices in the top pairs, rest + worst frame):')
for k, n in cat.most_common(): out.append(f"- {k}: {n}")
out.append('\nBy bone:')
for k, n in bone.most_common(30): out.append(f"- {k}: {n}")
text = '\n'.join(out)
if len(sys.argv) > 2: open(sys.argv[2], 'w').write(text)
print('\n'.join(out[:3] + out[3:30]))
print('\n'.join(out[-60:]))
