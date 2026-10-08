# Derives badge-icons-src/Breakaways-solid.svg from the operator's outline Breakaways.svg (2026-10-08).
# Usage (repo root): python3 docs/design/handoffs/2026-10-cards/make-breakaways-solid.py docs/design/handoffs/2026-10-cards/badge-icons-src/Breakaways-solid.svg
import re, sys
sys.path.insert(0, __import__("os").path.dirname(__file__))
from svg_subpaths import subpaths
src = open(__import__('os').path.join(__import__('os').path.dirname(__file__), 'badge-icons-src', 'Breakaways.svg')).read()
black = [d for attrs, d in re.findall(r'<path([^>]*?)d="([^"]+)"', src) if 'cls-1' not in attrs][0]
sps = subpaths(black)
def inside(a, b):
    return a is not b and all([b['bbox'][0] <= a['bbox'][0], b['bbox'][1] <= a['bbox'][1], b['bbox'][2] >= a['bbox'][2], b['bbox'][3] >= a['bbox'][3]])
keep = []
for sp in sps:
    x0, y0, x1, y1 = sp['bbox']; big = (x1 - x0) * (y1 - y0) > 4
    depth = sum(1 for o in sps if inside(sp, o))
    # depth 0: link outer contours and burst lines (solid); depth 2: the slots (holes).
    if big and depth in (0, 2): keep.append(sp['d'])
d = ''.join(keep)
out = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 52 52"><!-- Derived from Breakaways.svg (operator, 2026-10-08): links filled solid, slots kept, tracing specks dropped. --><path fill-rule="evenodd" d="{d}"/></svg>\n'
open(sys.argv[1], 'w').write(out)
print(len(keep), 'subpaths kept')
