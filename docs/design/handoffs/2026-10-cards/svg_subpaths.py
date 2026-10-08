import re, sys, json
NUM = r'[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?'
TOK = re.compile(r'([MmLlHhVvCcSsQqTtAaZz])|(' + NUM + ')')
ARGS = dict(M=2,L=2,H=1,V=1,C=6,S=4,Q=4,T=2,A=7,Z=0)

def subpaths(d):
    toks = [(a, float(b) if b else None) for a, b in TOK.findall(d)]
    out = []; i = 0; cx = cy = sx = sy = 0.0; cur = None; cmd = None
    while i < len(toks):
        c, n = toks[i]
        if c: cmd = c; i += 1
        if cmd in 'Zz':
            if cur: cur['parts'].append('z'); cx, cy = sx, sy
            cmd = None; continue
        k = ARGS[cmd.upper()]; vals = [toks[i + j][1] for j in range(k)]; i += k
        rel = cmd.islower(); U = cmd.upper()
        if U == 'M':
            x, y = (cx + vals[0], cy + vals[1]) if rel else (vals[0], vals[1])
            cur = {'start': (x, y), 'parts': [f'M{x:.3f},{y:.3f}'], 'pts': [(x, y)]}; out.append(cur)
            cx, cy = sx, sy = x, y
            cmd = 'l' if rel else 'L'; continue
        cur['parts'].append(cmd + ','.join(f'{v:g}' for v in vals))
        if U == 'H': nx, ny = (cx + vals[0] if rel else vals[0]), cy
        elif U == 'V': nx, ny = cx, (cy + vals[0] if rel else vals[0])
        else:
            pts = [(vals[j], vals[j + 1]) for j in range(0, k - (5 if U == 'A' else 0), 2)] if U != 'A' else [(vals[5], vals[6])]
            pts = [((cx + px, cy + py) if rel else (px, py)) for px, py in pts]
            cur['pts'].extend(pts); nx, ny = pts[-1]
        cx, cy = nx, ny; cur['pts'].append((cx, cy))
    for sp in out:
        xs = [p[0] for p in sp['pts']]; ys = [p[1] for p in sp['pts']]
        sp['bbox'] = (min(xs), min(ys), max(xs), max(ys)); sp['d'] = ''.join(sp['parts'])
    return out

if __name__ == '__main__':
    src = open(sys.argv[1]).read()
    for attrs, d in re.findall(r'<path([^>]*?)d="([^"]+)"', src):
        sps = subpaths(d)
        def inside(a, b):
            return a is not b and b['bbox'][0] <= a['bbox'][0] and b['bbox'][1] <= a['bbox'][1] and b['bbox'][2] >= a['bbox'][2] and b['bbox'][3] >= a['bbox'][3]
        print('PATH', attrs.strip())
        for idx, sp in enumerate(sps):
            depth = sum(1 for o in sps if inside(sp, o))
            x0, y0, x1, y1 = sp['bbox']
            print(f'  {idx:2d} depth {depth} bbox ({x0:.1f},{y0:.1f})-({x1:.1f},{y1:.1f}) size {x1-x0:.1f}x{y1-y0:.1f}')
