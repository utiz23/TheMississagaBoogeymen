"""Sample X-Factor icon pixels and check whether tier (Elite/All Star/Specialist)
is recoverable from HSV color statistics.

Three loadout captures with known V2 tiers are sampled at the icon centroid
positions. We dump median H, S, V per icon and visually correlate against tier.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import cv2
import numpy as np

REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent

# Empirically-derived icon centroid coordinates within a 1920x1080 loadout capture.
# Three X-Factor diamond icons sit centered above their name labels at y≈360,
# at x≈580 / 1080 / 1605 for slots 1/2/3 respectively. ±25 px sample radius.
ICON_CENTROIDS = [(500, 340), (1000, 340), (1500, 340)]
SAMPLE_RADIUS = 35

# Known V2 tiers for each capture (slots 1, 2, 3).
KNOWN = {
    'vlcsnap-2026-05-10-01h48m53s424.png': {
        'player': 'MrHomicide (Playmaker, C)',
        'tiers': ['All Star', 'All Star', 'Specialist'],
        'xfactors': ['Wheels', 'One T', 'Tape to Tape'],
    },
    'vlcsnap-2026-05-10-01h48m58s965.png': {
        'player': 'Stick Menace (Tage Thompson - PWF, LW)',
        'tiers': ['Elite', 'Elite', 'Elite'],
        'xfactors': ['Big Rig', 'One T', 'Ankle Breaker'],
    },
    'vlcsnap-2026-05-10-01h49m06s688.png': {
        'player': 'silkyjoker85 (Cole Caufield - SNP, RW)',
        'tiers': ['Elite', 'All Star', 'All Star'],
        'xfactors': ['Quick Release', 'One T', 'Pressure+'],
    },
    'vlcsnap-2026-05-10-01h49m17s363.png': {
        'player': 'HenryTheBobJr (Puck Moving Defenseman, LD)',
        'tiers': ['All Star', 'All Star', 'Specialist'],
        'xfactors': ['Warrior', 'Wheels', 'Quick Release'],
    },
    'vlcsnap-2026-05-10-01h49m20s173.png': {
        'player': 'JoeyFlopfish (Puck Moving Defenseman, RD)',
        'tiers': ['Elite', 'Specialist', 'Specialist'],
        'xfactors': ['Elite Edges', 'Tape to Tape', 'Stick Em Up'],
    },
    'vlcsnap-2026-05-10-01h49m54s735.png': {
        'player': 'MuttButt (Defensive Defenseman, Away LD)',
        'tiers': ['All Star', 'Specialist', 'All Star'],
        'xfactors': ['Quick Pick', 'Elite Edges', 'Rocket'],
    },
    'vlcsnap-2026-05-10-01h50m03s439.png': {
        'player': 'shadowassault20 (Puck Moving Defenseman, Away RD)',
        'tiers': ['Specialist', 'Elite', 'Elite'],
        'xfactors': ['Wheels', 'Warrior', 'Big Rig'],
    },
}


def sample_hsv(image: np.ndarray, cx: int, cy: int, r: int) -> tuple[float, float, float, int]:
    """Aggregate H, S, V over saturated pixels in a patch centered at (cx, cy)."""
    h, w = image.shape[:2]
    x1, x2 = max(0, cx - r), min(w, cx + r)
    y1, y2 = max(0, cy - r), min(h, cy + r)
    patch = image[y1:y2, x1:x2]
    hsv = cv2.cvtColor(patch, cv2.COLOR_BGR2HSV)
    pixels = hsv.reshape(-1, 3)
    # Keep only well-saturated, non-near-black pixels (the icon backdrop).
    mask = (pixels[:, 1] > 100) & (pixels[:, 2] > 60)
    sat = pixels[mask] if mask.any() else pixels
    if not mask.any():
        return (0.0, 0.0, 0.0, 0)
    # Hue wraps; convert to a circular-mean-safe representation.
    hues = sat[:, 0].astype(np.float64)
    # Map [0,180) to a unit circle (OpenCV uses 0-179 for hue).
    angles = hues * (2 * np.pi / 180)
    mean_x = np.mean(np.cos(angles))
    mean_y = np.mean(np.sin(angles))
    mean_h = (np.arctan2(mean_y, mean_x) * 180 / (2 * np.pi)) % 180
    return (float(mean_h), float(np.median(sat[:, 1])), float(np.median(sat[:, 2])), int(mask.sum()))


def classify_tier(h: float, s: float, v: float, count: int) -> str:
    """Classify icon backdrop by hue + saturation."""
    if count < 50:
        return 'no-icon (sample too small)'
    # Red (Elite): H near 0 or near 180 (wrap), with high saturation.
    if (h <= 15 or h >= 165) and s > 150:
        return 'Elite'
    # Yellow/orange (Specialist): H 15-35.
    if 15 < h < 35:
        return 'Specialist'
    # Blue (All Star): H 95-135.
    if 95 <= h <= 135:
        return 'All Star'
    return f'unknown(H={h:.0f},S={s:.0f},V={v:.0f})'


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--captures-dir', default='research/OCR-SS/Pre-Game-Loadouts')
    args = p.parse_args()
    cap_dir = REPO_ROOT / args.captures_dir

    print(f'{"player":50s}  {"slot":4s}  {"H":>5s} {"S":>5s} {"V":>5s}  {"known tier":12s}  classifier says')
    print('-' * 130)
    correct = 0
    total = 0
    for fname, meta in KNOWN.items():
        img = cv2.imread(str(cap_dir / fname))
        if img is None:
            print(f'WARN: missing {fname}', file=sys.stderr)
            continue
        for slot, ((cx, cy), tier, xf) in enumerate(zip(ICON_CENTROIDS, meta['tiers'], meta['xfactors'])):
            h, s, v, count = sample_hsv(img, cx, cy, SAMPLE_RADIUS)
            classified = classify_tier(h, s, v, count)
            total += 1
            if tier.lower() in classified.lower():
                correct += 1
                mark = '✓'
            else:
                mark = '✗'
            label = f'{meta["player"]}  (slot {slot}: {xf})'
            print(f'{label[:55]:55s} {tier:12s}  H={h:5.0f} S={s:5.0f} V={v:5.0f}  {mark} {classified}')
    print('-' * 130)
    print(f'\nclassifier accuracy: {correct}/{total} = {100*correct/max(1,total):.0f}%')
    return 0


if __name__ == '__main__':
    sys.exit(main())
