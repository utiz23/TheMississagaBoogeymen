"""Calibration spike: TPS vs linear, with LOOCV-TRE.

Reads `tools/game_ocr/game_ocr/configs/rink/match250_landmarks.json`, fits both
a linear (centre + half-width) model and a TPS (Thin Plate Spline) model,
then reports:

  - per-landmark in-sample residuals under each model
  - LOOCV TRE (Target Registration Error) per landmark for each model
  - implied px/ft per feature (the stylization diagnostic)
  - outlier-screen pass: which landmark, when omitted, most reduces TRE
  - single-axis residual checks against unfitted observations
  - overlay PNG showing measured vs predicted positions for each model

Usage:
  python3 tools/game_ocr/scripts/calibration_spike.py
  python3 tools/game_ocr/scripts/calibration_spike.py --output /tmp/spike-overlay.png
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import cv2
import numpy as np
from scipy.interpolate import RBFInterpolator
from skimage.transform import ThinPlateSplineTransform

REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
LANDMARKS_JSON = REPO_ROOT / 'tools/game_ocr/game_ocr/configs/rink/match250_landmarks.json'

# Mirror recalibrate_rink.py's landmark name → hockey (x, y) table.
LANDMARK_HOCKEY = {
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
}


def fit_linear(landmarks):
    """Same model as recalibrate_rink.py: px = cx + (xh/100) * hw; py = cy - (yh/42.5) * hh."""
    xs = []  # (xh, px)
    ys = []  # (yh, py)
    for name, px, py in landmarks:
        xh, yh = LANDMARK_HOCKEY[name]
        xs.append((xh, px))
        ys.append((yh, py))

    def solve(pairs, scale):
        a11 = sum(1.0 * 1.0 for _ in pairs)
        a12 = sum(1.0 * (h / scale) for (h, _) in pairs)
        a22 = sum((h / scale) ** 2 for (h, _) in pairs)
        b1 = sum(p for (_, p) in pairs)
        b2 = sum((h / scale) * p for (h, p) in pairs)
        det = a11 * a22 - a12 * a12
        if abs(det) < 1e-9:
            raise ValueError('Singular axis: need landmarks spanning the axis')
        c = (a22 * b1 - a12 * b2) / det
        half = (a11 * b2 - a12 * b1) / det
        return c, half

    cx, hw = solve(xs, 100.0)
    ys_flipped = [(-yh, py) for (yh, py) in ys]
    cy, hh = solve(ys_flipped, 42.5)
    return cx, cy, hw, hh


def linear_predict(model, hx, hy):
    cx, cy, hw, hh = model
    return cx + (hx / 100.0) * hw, cy - (hy / 42.5) * hh


def fit_tps_hockey_to_pixel(landmarks):
    """Returns a callable hockey(2D) -> pixel(2D)."""
    src = np.array([LANDMARK_HOCKEY[n] for (n, _, _) in landmarks], dtype=np.float64)
    dst = np.array([(px, py) for (_, px, py) in landmarks], dtype=np.float64)
    tps = ThinPlateSplineTransform()
    tps.estimate(src, dst)
    return tps


def per_landmark_residuals(landmarks, predict):
    rows = []
    for name, px, py in landmarks:
        hx, hy = LANDMARK_HOCKEY[name]
        ppx, ppy = predict(hx, hy)
        dx, dy = px - ppx, py - ppy
        rows.append((name, px, py, ppx, ppy, dx, dy, math.hypot(dx, dy)))
    return rows


def loocv_tre(landmarks, mode):
    """Leave-one-out TRE for each landmark.

    For each landmark L: refit the model on the OTHER landmarks; predict L's
    pixel position; report distance from measured.
    """
    rows = []
    for i, (name, px, py) in enumerate(landmarks):
        rest = [l for j, l in enumerate(landmarks) if j != i]
        if mode == 'linear':
            try:
                model = fit_linear(rest)
            except ValueError as e:
                rows.append((name, None, str(e)))
                continue
            hx, hy = LANDMARK_HOCKEY[name]
            ppx, ppy = linear_predict(model, hx, hy)
        elif mode == 'tps':
            if len(rest) < 4:
                rows.append((name, None, 'need >=4 landmarks for TPS'))
                continue
            tps = fit_tps_hockey_to_pixel(rest)
            hx, hy = LANDMARK_HOCKEY[name]
            ppx, ppy = tps(np.array([[hx, hy]]))[0]
        else:
            raise ValueError(mode)
        tre = math.hypot(px - ppx, py - ppy)
        rows.append((name, tre, None))
    return rows


def implied_pxft_table(landmarks, axis_obs, model_linear):
    """For each landmark + axis observation, compute implied px/ft on its axis."""
    cx, cy, _hw, _hh = model_linear
    rows = []
    for name, px, py in landmarks:
        hx, hy = LANDMARK_HOCKEY[name]
        if abs(hx) > 1e-6:
            rows.append((name, 'x', hx, (px - cx) / hx))
        if abs(hy) > 1e-6:
            # NOTE flipped sign on y because py increases downward
            rows.append((name, 'y', hy, -(py - cy) / hy))
    for obs in axis_obs:
        n = obs['name']
        if 'hockey_x' in obs and obs.get('hockey_x') is not None:
            rows.append((n, 'x', obs['hockey_x'], (obs['pixel_x'] - cx) / obs['hockey_x']))
        if 'hockey_y' in obs and obs.get('hockey_y') is not None:
            rows.append((n, 'y', obs['hockey_y'], -(obs['pixel_y'] - cy) / obs['hockey_y']))
    return rows


def axis_residuals(axis_obs, model_linear, tps):
    """For single-axis observations, project the constrained axis through both models."""
    cx, cy, hw, hh = model_linear
    out = []
    for obs in axis_obs:
        n = obs['name']
        if 'hockey_x' in obs and obs.get('hockey_x') is not None:
            hx = obs['hockey_x']
            measured_px = obs['pixel_x']
            lin_px = cx + (hx / 100.0) * hw
            # TPS expects 2D — assume y=0 (centre line) for x-only obs; for L-marks at faceoff dot,
            # use the dot's y instead. Simplification: most x-only obs are along y=22 (faceoff row).
            assumed_hy = 22.0 if 'fo' in n else 0.0
            tps_px, _ = tps(np.array([[hx, assumed_hy]]))[0]
            out.append((n, 'x', hx, measured_px, lin_px, tps_px))
        if 'hockey_y' in obs and obs.get('hockey_y') is not None:
            hy = obs['hockey_y']
            measured_py = obs['pixel_y']
            lin_py = cy - (hy / 42.5) * hh
            assumed_hx = -69.0 if 'left' in n else 69.0
            _, tps_py = tps(np.array([[assumed_hx, hy]]))[0]
            out.append((n, 'y', hy, measured_py, lin_py, tps_py))
    return out


def outlier_screen(landmarks):
    """For each landmark, refit linear and TPS with it removed; report change in mean TRE on the rest."""
    base_linear = mean_tre(loocv_tre(landmarks, 'linear'))
    base_tps = mean_tre(loocv_tre(landmarks, 'tps'))
    out = []
    for i, (name, _, _) in enumerate(landmarks):
        rest = [l for j, l in enumerate(landmarks) if j != i]
        if len(rest) < 5:
            continue
        lin_mean = mean_tre(loocv_tre(rest, 'linear'))
        tps_mean = mean_tre(loocv_tre(rest, 'tps'))
        out.append((name, base_linear - lin_mean, base_tps - tps_mean))
    return out, base_linear, base_tps


def mean_tre(rows):
    vals = [r[1] for r in rows if r[1] is not None]
    return sum(vals) / len(vals) if vals else float('nan')


def render_overlay(frame_path, landmarks, axis_obs, model_linear, tps, out_path):
    img = cv2.imread(str(frame_path))
    if img is None:
        print(f'WARN: could not read {frame_path}; skipping overlay', file=sys.stderr)
        return
    overlay = img.copy()
    GREEN = (0, 255, 0)
    BLUE_LIN = (255, 80, 0)
    RED_TPS = (60, 60, 255)
    YELLOW = (0, 255, 255)
    # Measured (green circles)
    for name, px, py in landmarks:
        cv2.circle(overlay, (int(px), int(py)), 8, GREEN, 2)
        cv2.putText(overlay, name, (int(px) + 10, int(py) - 6),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.38, GREEN, 1, cv2.LINE_AA)
    # Linear predictions (blue crosses)
    for name, _, _ in landmarks:
        hx, hy = LANDMARK_HOCKEY[name]
        ppx, ppy = linear_predict(model_linear, hx, hy)
        cv2.drawMarker(overlay, (int(ppx), int(ppy)), BLUE_LIN, cv2.MARKER_CROSS, 14, 2)
    # TPS predictions (red crosses) — these should be exact under in-sample fit
    for name, _, _ in landmarks:
        hx, hy = LANDMARK_HOCKEY[name]
        ppx, ppy = tps(np.array([[hx, hy]]))[0]
        cv2.drawMarker(overlay, (int(ppx), int(ppy)), RED_TPS, cv2.MARKER_DIAMOND, 12, 2)
    # Axis observations (yellow ticks)
    cx, cy, hw, hh = model_linear
    for obs in axis_obs:
        if obs.get('pixel_x') is not None:
            cv2.line(overlay, (int(obs['pixel_x']), int(cy - 6)),
                     (int(obs['pixel_x']), int(cy + 6)), YELLOW, 1)
        if obs.get('pixel_y') is not None:
            cv2.line(overlay, (int(cx - 6), int(obs['pixel_y'])),
                     (int(cx + 6), int(obs['pixel_y'])), YELLOW, 1)
    # Legend
    cv2.putText(overlay, 'GREEN=measured  BLUE+=linear  RED<>=TPS  YELLOW|=axis-only',
                (10, overlay.shape[0] - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1, cv2.LINE_AA)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(out_path), overlay)
    print(f'Wrote overlay: {out_path}')


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--landmarks-json', default=str(LANDMARKS_JSON))
    p.add_argument('--output', default='/tmp/calibration-spike-overlay.png')
    args = p.parse_args()

    cfg = json.loads(Path(args.landmarks_json).read_text())
    raw = cfg['landmarks']
    landmarks = [(n, p[0], p[1]) for n, p in raw.items() if p is not None]
    axis_obs = cfg.get('axis_observations', [])

    print(f'Loaded {len(landmarks)} full-2D landmarks, {len(axis_obs)} axis-only observations')
    print(f'Frame: {cfg["frame"]}\n')

    # === Linear fit ===
    model_lin = fit_linear(landmarks)
    cx, cy, hw, hh = model_lin
    print(f'== LINEAR FIT ==')
    print(f'  centre_px        = ({cx:.1f}, {cy:.1f})')
    print(f'  half_w_px        = {hw:.2f}   → {hw/100:.3f} px/ft (x global)')
    print(f'  half_h_px        = {hh:.2f}   → {hh/42.5:.3f} px/ft (y global)')
    print(f'  rink_pixel_box   = ({int(round(cx-hw))}, {int(round(cy-hh))}, '
          f'{int(round(cx+hw))}, {int(round(cy+hh))})')

    # === TPS fit ===
    tps = fit_tps_hockey_to_pixel(landmarks)
    print(f'\n== TPS FIT ==')
    print(f'  hockey-to-pixel TPS built on {len(landmarks)} landmarks; in-sample residuals should be 0')

    # === In-sample residuals ===
    print(f'\n== IN-SAMPLE RESIDUALS (LINEAR) ==')
    rows_lin = per_landmark_residuals(landmarks, lambda hx, hy: linear_predict(model_lin, hx, hy))
    print(f'  {"name":22s} {"meas px":>10s} {"meas py":>10s} {"pred px":>10s} {"pred py":>10s} {"dx":>7s} {"dy":>7s} {"|d|":>7s}')
    for r in rows_lin:
        print(f'  {r[0]:22s} {r[1]:10.1f} {r[2]:10.1f} {r[3]:10.1f} {r[4]:10.1f} {r[5]:+7.1f} {r[6]:+7.1f} {r[7]:7.1f}')
    mean_lin_in = sum(r[7] for r in rows_lin) / len(rows_lin)
    print(f'  mean in-sample |d| = {mean_lin_in:.2f} px')

    print(f'\n== IN-SAMPLE RESIDUALS (TPS) ==')
    def tps_pred(hx, hy):
        out = tps(np.array([[hx, hy]]))[0]
        return out[0], out[1]
    rows_tps = per_landmark_residuals(landmarks, tps_pred)
    for r in rows_tps:
        print(f'  {r[0]:22s} {r[1]:10.1f} {r[2]:10.1f} {r[3]:10.1f} {r[4]:10.1f} {r[5]:+7.1f} {r[6]:+7.1f} {r[7]:7.1f}')
    mean_tps_in = sum(r[7] for r in rows_tps) / len(rows_tps)
    print(f'  mean in-sample |d| = {mean_tps_in:.2f} px')

    # === LOOCV TRE ===
    print(f'\n== LEAVE-ONE-OUT TRE ==')
    loocv_lin = loocv_tre(landmarks, 'linear')
    loocv_tps_rows = loocv_tre(landmarks, 'tps')
    print(f'  {"name":22s} {"linear TRE px":>15s} {"linear TRE ft":>15s} {"TPS TRE px":>15s} {"TPS TRE ft":>15s}')
    for ll, tt in zip(loocv_lin, loocv_tps_rows):
        n = ll[0]
        lin_px = ll[1] if ll[1] is not None else float('nan')
        tps_px = tt[1] if tt[1] is not None else float('nan')
        # Convert px → ft using the global linear px/ft (rough conversion; differs by axis)
        scale = (hw / 100 + hh / 42.5) / 2
        print(f'  {n:22s} {lin_px:15.2f} {lin_px/scale:15.2f} {tps_px:15.2f} {tps_px/scale:15.2f}')
    m_lin = mean_tre(loocv_lin)
    m_tps = mean_tre(loocv_tps_rows)
    print(f'  mean linear LOOCV TRE = {m_lin:.2f} px ({m_lin/((hw/100+hh/42.5)/2):.2f} ft)')
    print(f'  mean TPS    LOOCV TRE = {m_tps:.2f} px ({m_tps/((hw/100+hh/42.5)/2):.2f} ft)')

    # === Implied px/ft per feature (stylization diagnostic) ===
    print(f'\n== IMPLIED PX/FT PER FEATURE (DIAGNOSTIC) ==')
    rows = implied_pxft_table(landmarks, axis_obs, model_lin)
    rows.sort(key=lambda r: (r[1], abs(r[2])))
    print(f'  {"feature":35s} {"axis":>5s} {"hockey":>8s} {"px/ft":>8s}')
    for r in rows:
        print(f'  {r[0]:35s} {r[1]:>5s} {r[2]:>8.1f} {r[3]:>8.3f}')

    # === Axis-only observation residuals ===
    print(f'\n== AXIS-ONLY OBSERVATION RESIDUALS ==')
    ax_rows = axis_residuals(axis_obs, model_lin, tps)
    print(f'  {"name":32s} {"axis":>5s} {"hockey":>8s} {"meas":>8s} {"lin":>8s} {"lin-Δ":>8s} {"tps":>8s} {"tps-Δ":>8s}')
    for r in ax_rows:
        n, axis, h, meas, lin, tps_v = r
        print(f'  {n:32s} {axis:>5s} {h:>8.1f} {meas:>8.1f} {lin:>8.1f} {meas-lin:>+8.1f} {tps_v:>8.1f} {meas-tps_v:>+8.1f}')

    # === Outlier screening ===
    print(f'\n== OUTLIER SCREEN (Δ mean LOOCV TRE when landmark is removed) ==')
    outlier_rows, base_lin, base_tps = outlier_screen(landmarks)
    outlier_rows.sort(key=lambda r: -max(r[1], r[2]))
    print(f'  Baseline mean LOOCV TRE: linear={base_lin:.2f} px, tps={base_tps:.2f} px')
    print(f'  {"removed":22s} {"Δ linear":>10s} {"Δ tps":>10s}')
    for r in outlier_rows:
        print(f'  {r[0]:22s} {r[1]:>+10.2f} {r[2]:>+10.2f}')
    print(f'  (positive = TRE drops when landmark is removed → that landmark hurts the fit)')

    # === Overlay ===
    frame_path = REPO_ROOT / cfg['frame']
    render_overlay(frame_path, landmarks, axis_obs, model_lin, tps, Path(args.output))
    return 0


if __name__ == '__main__':
    sys.exit(main())
