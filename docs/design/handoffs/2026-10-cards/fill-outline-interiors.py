# Adds white fills for the interiors of one outline path in an operator icon, so
# `invert` (import-badge-icons.mjs) reads it as filled. The interiors are that
# path's subpaths except its outer contour (the largest). Operator, 2026-10-08:
# Fights.svg draws the back glove as an outline only (the front glove has fills).
# Usage (repo root):
#   python3 docs/design/handoffs/2026-10-cards/fill-outline-interiors.py SRC DST PATH_INDEX
import os, re, sys
sys.path.insert(0, os.path.dirname(__file__))
from svg_subpaths import subpaths

src_path, dst_path, index = sys.argv[1], sys.argv[2], int(sys.argv[3])
src = open(src_path).read()
paths = list(re.finditer(r'<path([^>]*?)d="([^"]+)"[^>]*/>', src))
target = paths[index]
sps = subpaths(target.group(2))
area = lambda sp: (sp['bbox'][2] - sp['bbox'][0]) * (sp['bbox'][3] - sp['bbox'][1])
outer = max(sps, key=area)
fill = ''.join(sp['d'] for sp in sps if sp is not outer)
insert = f'\n<path fill="#fff" d="{fill}"/>'
out = src[: target.end()] + insert + src[target.end():]
out = out.replace('<svg ', f'<!-- Derived from {os.path.basename(src_path)}: interiors of path {index} filled white. -->\n<svg ', 1) if out.startswith('<svg') else out
open(dst_path, 'w').write(out)
print(f'{len(sps) - 1} interior subpaths filled')
