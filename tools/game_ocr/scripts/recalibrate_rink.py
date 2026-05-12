"""Manually recalibrate the Action Tracker rink_pixel_box from user-measured landmarks.

You provide pixel coordinates for known NHL landmarks (centre ice, blue lines,
faceoff dots, goal lines, side boards). The script computes the rink_pixel_box
that best fits your measurements, prints the resulting calibration, and (with
--apply) writes it back to the config JSON.

WORKFLOW:
  1. Open a 1920x1080 Action Tracker screenshot in any image viewer (e.g. GIMP,
     Photoshop, Windows Photos, IrfanView, Preview). Find a representative
     frame where the rink art is fully visible and unobstructed.
  2. Identify the pixel position (x, y) of as many of these NHL landmarks as
     you can. The more you give, the better the fit. Minimum: centre ice + one
     additional landmark per axis.
       - centre              → hockey (0, 0)        (the centre red dot)
       - bl-left             → hockey (-25, 0)      (middle of left blue line)
       - bl-right            → hockey (+25, 0)      (middle of right blue line)
       - goal-left           → hockey (-89, 0)      (centre of left goal line)
       - goal-right          → hockey (+89, 0)      (centre of right goal line)
       - board-left          → hockey (-100, 0)     (innermost point of left boards)
       - board-right         → hockey (+100, 0)     (innermost point of right boards)
       - board-top           → hockey (0, +42.5)    (innermost point of top boards)
       - board-bottom        → hockey (0, -42.5)    (innermost point of bottom boards)
       - ez-fo-top-left      → hockey (-69, +22)    (faceoff dot, top-left zone)
       - ez-fo-bot-left      → hockey (-69, -22)
       - ez-fo-top-right     → hockey (+69, +22)
       - ez-fo-bot-right     → hockey (+69, -22)
       - nz-fo-top-left      → hockey (-20, +22)
       - nz-fo-bot-left      → hockey (-20, -22)
       - nz-fo-top-right     → hockey (+20, +22)
       - nz-fo-bot-right     → hockey (+20, -22)
  3. Run this script with your measurements (see USAGE below).
  4. Review the overlay it generates. If the magenta crosses now sit ON the
     actual features, run again with --apply to write the new calibration.

USAGE:
  python3 tools/game_ocr/scripts/recalibrate_rink.py \\
    --image research/OCR-SS/Action-Tracker/3rd-Period-Events/vlcsnap-….png \\
    --landmark centre=1372,586 \\
    --landmark bl-right=1480,586 \\
    --landmark bl-left=1272,586 \\
    --landmark ez-fo-top-right=1665,432 \\
    --landmark ez-fo-bot-left=1080,742 \\
    --output /tmp/rink-calibrated.png

Apply when satisfied:
    add --apply
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import cv2

REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
CALIB_PATH = REPO_ROOT / 'tools/game_ocr/game_ocr/configs/rink/post_game_action_tracker.json'

# Landmark name → (hockey_x, hockey_y).
LANDMARKS = {
    'centre':           ( 0.0,    0.0),
    'bl-left':          (-25.0,   0.0),
    'bl-right':         ( 25.0,   0.0),
    'goal-left':        (-89.0,   0.0),
    'goal-right':       ( 89.0,   0.0),
    'board-left':       (-100.0,  0.0),
    'board-right':      ( 100.0,  0.0),
    'board-top':        ( 0.0,   42.5),
    'board-bottom':     ( 0.0,  -42.5),
    'ez-fo-top-left':   (-69.0,  22.0),
    'ez-fo-bot-left':   (-69.0, -22.0),
    'ez-fo-top-right':  ( 69.0,  22.0),
    'ez-fo-bot-right':  ( 69.0, -22.0),
    'nz-fo-top-left':   (-20.0,  22.0),
    'nz-fo-bot-left':   (-20.0, -22.0),
    'nz-fo-top-right':  ( 20.0,  22.0),
    'nz-fo-bot-right':  ( 20.0, -22.0),
}


def parse_landmark(arg: str) -> tuple[str, float, float]:
    if '=' not in arg:
        raise argparse.ArgumentTypeError(f'expected NAME=PX,PY, got {arg!r}')
    name, rest = arg.split('=', 1)
    name = name.strip().lower()
    if name not in LANDMARKS:
        raise argparse.ArgumentTypeError(
            f'unknown landmark {name!r}. Valid: {sorted(LANDMARKS)}'
        )
    if ',' not in rest:
        raise argparse.ArgumentTypeError(f'expected PX,PY for {name}, got {rest!r}')
    px_s, py_s = rest.split(',', 1)
    return name, float(px_s.strip()), float(py_s.strip())


def fit(landmarks: list[tuple[str, float, float]]) -> dict:
    """Least-squares fit of (cx, cy, half_w_px, half_h_px) to measurements.

    Per-axis linear model:
      px = cx + (xh / 100) * half_w_px
      py = cy - (yh / 42.5) * half_h_px

    With ≥2 landmarks varying x_h, solve for (cx, half_w). With ≥2 varying
    y_h, solve for (cy, half_h). Fall back gracefully when an axis has only
    one measurement.
    """
    # Aggregate per-axis observations.
    xs: list[tuple[float, float]] = []  # (xh, px)
    ys: list[tuple[float, float]] = []  # (yh, py)
    for name, px, py in landmarks:
        xh, yh = LANDMARKS[name]
        xs.append((xh, px))
        ys.append((yh, py))

    def solve_linear(pairs: list[tuple[float, float]], scale: float) -> tuple[float, float]:
        """pairs is (hockey_value, pixel_value). scale = 100 for x, 42.5 for y.

        Model: pixel = c + (hockey / scale) * half. For y we want pixel = c -
        (hockey / scale) * half, so the caller pre-flips the sign as needed.
        """
        # Build A @ [c, half]^T = b.
        # Each row: [1, hockey/scale]
        a = [[1.0, h / scale] for (h, _) in pairs]
        b = [p for (_, p) in pairs]
        # Normal equations: (AᵀA) x = Aᵀb (2x2 invert by hand).
        a11 = sum(r[0] * r[0] for r in a)
        a12 = sum(r[0] * r[1] for r in a)
        a22 = sum(r[1] * r[1] for r in a)
        b1 = sum(r[0] * bv for r, bv in zip(a, b))
        b2 = sum(r[1] * bv for r, bv in zip(a, b))
        det = a11 * a22 - a12 * a12
        if abs(det) < 1e-9:
            raise ValueError('Singular axis: provide at least two landmarks with different hockey coordinates')
        c = (a22 * b1 - a12 * b2) / det
        half = (a11 * b2 - a12 * b1) / det
        return c, half

    # x-axis: include only landmarks where hockey x is informative (xh ≠ 0
    # rows still help solve cx, but we need spread). All rows fine.
    cx, half_w = solve_linear(xs, 100.0)

    # y-axis: the model is pixel_y = cy - (yh / 42.5) * half_h. Equivalently,
    # pre-flip yh and solve same form.
    ys_flipped = [(-yh, py) for (yh, py) in ys]
    cy, half_h = solve_linear(ys_flipped, 42.5)

    return {
        'cx': cx,
        'cy': cy,
        'half_w': half_w,
        'half_h': half_h,
    }


def main() -> int:
    p = argparse.ArgumentParser(formatter_class=argparse.RawDescriptionHelpFormatter,
                                description=__doc__)
    p.add_argument('--image', required=True, help='Sample screenshot to overlay (1920x1080 ideal)')
    p.add_argument('--landmark', '-l', action='append', type=parse_landmark, required=True,
                   help='NAME=PX,PY pair. Repeatable. Min 2 landmarks per axis.')
    p.add_argument('--output', default='/tmp/rink-recalibrated.png',
                   help='Where to write the overlay PNG')
    p.add_argument('--apply', action='store_true',
                   help='Write the fitted box to the calibration JSON (otherwise dry-run)')
    p.add_argument('--crop', action='store_true',
                   help='Crop the overlay output to the rink area')
    args = p.parse_args()

    img_path = Path(args.image)
    img = cv2.imread(str(img_path))
    if img is None:
        print(f'Failed to load {img_path}', file=sys.stderr)
        return 1

    fit_res = fit(args.landmark)
    cx, cy = fit_res['cx'], fit_res['cy']
    hw, hh = fit_res['half_w'], fit_res['half_h']
    new_box = {
        'x1': int(round(cx - hw)),
        'y1': int(round(cy - hh)),
        'x2': int(round(cx + hw)),
        'y2': int(round(cy + hh)),
    }
    print(f'Fitted calibration:')
    print(f'  centre_px  : ({cx:.1f}, {cy:.1f})')
    print(f'  half_w_px  : {hw:.1f}  → {hw / 100:.3f} px/ft  (x scale)')
    print(f'  half_h_px  : {hh:.1f}  → {hh / 42.5:.3f} px/ft (y scale)')
    print(f'  rink_pixel_box: ({new_box["x1"]}, {new_box["y1"]}) → ({new_box["x2"]}, {new_box["y2"]})')

    # Sanity: per-axis residuals.
    print(f'\nLandmark residuals (px):')
    for name, px, py in args.landmark:
        xh, yh = LANDMARKS[name]
        pred_x = cx + (xh / 100) * hw
        pred_y = cy - (yh / 42.5) * hh
        rx = px - pred_x
        ry = py - pred_y
        print(f'  {name:20s}  given=({px:.1f}, {py:.1f})  predicted=({pred_x:.1f}, {pred_y:.1f})  Δ=({rx:+.1f}, {ry:+.1f})')

    # Draw overlay
    overlay = img.copy()
    YELLOW = (0, 255, 255)
    MAGENTA = (255, 0, 255)
    GREEN = (0, 255, 0)
    RED = (0, 0, 255)
    cv2.rectangle(overlay, (new_box['x1'], new_box['y1']),
                  (new_box['x2'], new_box['y2']), YELLOW, 2)

    # Predicted NHL landmarks (magenta crosses)
    for name, (xh, yh) in LANDMARKS.items():
        pred_x = int(cx + (xh / 100) * hw)
        pred_y = int(cy - (yh / 42.5) * hh)
        cv2.drawMarker(overlay, (pred_x, pred_y), MAGENTA, cv2.MARKER_CROSS, 16, 2)
        cv2.putText(overlay, name, (pred_x + 8, pred_y - 4),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.4, MAGENTA, 1, cv2.LINE_AA)

    # User-given measurements (green circles)
    for name, px, py in args.landmark:
        cv2.circle(overlay, (int(px), int(py)), 10, GREEN, 2)
        cv2.putText(overlay, f'⊕ {name}', (int(px) + 12, int(py) + 4),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.45, GREEN, 1, cv2.LINE_AA)

    if args.crop:
        margin = 40
        h, w = overlay.shape[:2]
        cx1 = max(0, new_box['x1'] - margin)
        cy1 = max(0, new_box['y1'] - margin)
        cx2 = min(w, new_box['x2'] + margin)
        cy2 = min(h, new_box['y2'] + margin)
        overlay = overlay[cy1:cy2, cx1:cx2]
        # 2x upscale for legibility
        overlay = cv2.resize(overlay,
                             (overlay.shape[1] * 2, overlay.shape[0] * 2),
                             interpolation=cv2.INTER_LANCZOS4)

    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(out), overlay)
    print(f'\nWrote overlay: {out}')

    if args.apply:
        calib = json.loads(CALIB_PATH.read_text())
        prev_box = calib.get('rink_pixel_box', {})
        calib['rink_pixel_box'] = new_box
        # Also refresh reference_points to be derived from the new box.
        calib['reference_points'] = {
            'center_ice': {'x': int(round(cx)), 'y': int(round(cy))},
            'blue_line_left': {'x': int(round(cx - 0.25 * hw)), 'y': int(round(cy))},
            'blue_line_right': {'x': int(round(cx + 0.25 * hw)), 'y': int(round(cy))},
        }
        CALIB_PATH.write_text(json.dumps(calib, indent=2) + '\n')
        print(f'\nApplied to {CALIB_PATH}')
        print(f'  prev box: {prev_box}')
        print(f'  new box : {new_box}')
    else:
        print('\nDRY RUN — pass --apply to write to the calibration JSON.')

    return 0


if __name__ == '__main__':
    sys.exit(main())
