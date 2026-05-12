"""Calibration spike v2: regularized TPS, neighbors=k, PWA, hull gate.

Round-3 spike for rink calibration. Extends calibration_spike.py (v1) with
the four prioritized methods from the Round-2 Deep Research:

  A. Regularized TPS    — scipy RBFInterpolator(thin_plate_spline, smoothing=k)
  B. neighbors=k local  — scipy RBFInterpolator(thin_plate_spline, neighbors=k)
  C. Piecewise-affine   — skimage PiecewiseAffineTransform (Delaunay)
  D. Hull gate          — scipy.spatial.Delaunay.find_simplex for in/out

Output:
  - stdout: per-method LOOCV-TRE table + best-config picks per spike
  - /tmp/calibration-spike-v2-results.md: structured findings (markdown)
  - /tmp/calibration-spike-v2-overlay.png: measured vs winner-predicted
  - /tmp/calibration-spike-v2-warp-grid.png: warp-grid sanity check for winner

Usage:
  python3 tools/game_ocr/scripts/calibration_spike_v2.py
  python3 tools/game_ocr/scripts/calibration_spike_v2.py --landmarks-json <path>
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
from scipy.interpolate import RBFInterpolator
from scipy.spatial import ConvexHull, Delaunay
from skimage.transform import PiecewiseAffineTransform, ThinPlateSplineTransform


REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent
LANDMARKS_JSON = REPO_ROOT / "tools/game_ocr/game_ocr/configs/rink/match250_landmarks.json"

# Mirror recalibrate_rink.py's landmark name → hockey (x, y) table.
LANDMARK_HOCKEY: dict[str, tuple[float, float]] = {
    "centre":            (  0.0,   0.0),
    "bl-left":           (-25.0,   0.0),
    "bl-right":          ( 25.0,   0.0),
    "goal-left":         (-89.0,   0.0),
    "goal-right":        ( 89.0,   0.0),
    "board-left":        (-100.0,  0.0),
    "board-right":       ( 100.0,  0.0),
    "board-top":         (  0.0,  42.5),
    "board-bottom":      (  0.0, -42.5),
    "ez-fo-top-left":    (-69.0,  22.0),
    "ez-fo-bot-left":    (-69.0, -22.0),
    "ez-fo-top-right":   ( 69.0,  22.0),
    "ez-fo-bot-right":   ( 69.0, -22.0),
}

# Coarse grouping for the boundary-vs-inner LOOCV split (spike D quality split).
# "boundary" = features at or near the rink edge; "inner" = features deep
# inside the play area.
BOUNDARY_LANDMARKS = {
    "goal-left", "goal-right",
    "board-left", "board-right", "board-top", "board-bottom",
}
INNER_LANDMARKS = {
    "centre", "bl-left", "bl-right",
    "ez-fo-top-left", "ez-fo-bot-left",
    "ez-fo-top-right", "ez-fo-bot-right",
}


# ── Data types ──────────────────────────────────────────────────────────────

@dataclass
class Landmark:
    name: str
    px: float
    py: float

    @property
    def hockey(self) -> tuple[float, float]:
        return LANDMARK_HOCKEY[self.name]


@dataclass
class MethodResult:
    label: str  # short label like "linear", "tps_smooth_k=1.0"
    mean_tre_px: float
    boundary_mean_tre_px: float
    inner_mean_tre_px: float
    per_landmark_tre: dict[str, float]
    coverage: int  # how many of 13 landmarks the method could predict in LOOCV
    notes: str = ""


# ── Method factories — each returns a callable hockey(N×2) → pixel(N×2) ─────

def factory_linear(landmarks: list[Landmark]):
    """Linear single-anchor (current production), least-squares on landmarks."""
    xs = [(l.hockey[0], l.px) for l in landmarks]
    ys = [(l.hockey[1], l.py) for l in landmarks]

    def solve(pairs, scale):
        a11 = sum(1.0 for _ in pairs)
        a12 = sum(h / scale for (h, _) in pairs)
        a22 = sum((h / scale) ** 2 for (h, _) in pairs)
        b1 = sum(p for (_, p) in pairs)
        b2 = sum((h / scale) * p for (h, p) in pairs)
        det = a11 * a22 - a12 * a12
        if abs(det) < 1e-9:
            raise ValueError("Singular axis")
        c = (a22 * b1 - a12 * b2) / det
        half = (a11 * b2 - a12 * b1) / det
        return c, half

    cx, hw = solve(xs, 100.0)
    cy, hh = solve([(-yh, py) for (yh, py) in ys], 42.5)

    def predict(hxy: np.ndarray) -> np.ndarray:
        out = np.empty_like(hxy, dtype=np.float64)
        out[:, 0] = cx + (hxy[:, 0] / 100.0) * hw
        out[:, 1] = cy - (hxy[:, 1] / 42.5) * hh
        return out

    predict.config = {"cx": cx, "cy": cy, "hw": hw, "hh": hh}  # type: ignore[attr-defined]
    return predict


def factory_tps_skimage(landmarks: list[Landmark]):
    """Plain TPS via scikit-image (matches v1)."""
    src = np.array([l.hockey for l in landmarks], dtype=np.float64)
    dst = np.array([(l.px, l.py) for l in landmarks], dtype=np.float64)
    tps = ThinPlateSplineTransform()
    tps.estimate(src, dst)

    def predict(hxy: np.ndarray) -> np.ndarray:
        return np.asarray(tps(hxy))

    return predict


def factory_tps_rbf(landmarks: list[Landmark], *, smoothing: float = 0.0,
                   neighbors: int | None = None):
    """Regularized + neighbor-limited TPS via scipy RBFInterpolator."""
    src = np.array([l.hockey for l in landmarks], dtype=np.float64)
    dst_x = np.array([l.px for l in landmarks], dtype=np.float64)
    dst_y = np.array([l.py for l in landmarks], dtype=np.float64)

    # RBFInterpolator wants a single response, so fit one per axis.
    # Use `neighbors=None` for global TPS; integer limits it to the k nearest.
    kw = {"kernel": "thin_plate_spline", "smoothing": smoothing}
    if neighbors is not None:
        kw["neighbors"] = neighbors
    rbf_x = RBFInterpolator(src, dst_x, **kw)
    rbf_y = RBFInterpolator(src, dst_y, **kw)

    def predict(hxy: np.ndarray) -> np.ndarray:
        out = np.empty_like(hxy, dtype=np.float64)
        out[:, 0] = rbf_x(hxy)
        out[:, 1] = rbf_y(hxy)
        return out

    return predict


def factory_pwa(landmarks: list[Landmark]):
    """Piecewise-affine (Delaunay) via scikit-image.

    skimage returns the sentinel `(-1, -1)` for points outside the convex
    hull of the source landmarks. We convert that to NaN so LOOCV-TRE can
    filter them out cleanly. PWA cannot predict held-out boundary
    landmarks for that reason — interior landmarks only.
    """
    src = np.array([l.hockey for l in landmarks], dtype=np.float64)
    dst = np.array([(l.px, l.py) for l in landmarks], dtype=np.float64)
    pwa = PiecewiseAffineTransform()
    ok = pwa.estimate(src, dst)
    if not ok:
        raise RuntimeError("PiecewiseAffineTransform.estimate failed")

    def predict(hxy: np.ndarray) -> np.ndarray:
        raw = np.asarray(pwa(hxy), dtype=np.float64)
        # Out-of-hull sentinel from skimage → NaN
        outside = np.all(raw == -1, axis=1)
        raw[outside] = np.nan
        return raw

    predict.transform = pwa  # type: ignore[attr-defined]  # for foldover inspection
    return predict


# ── LOOCV evaluation ─────────────────────────────────────────────────────────

def loocv_per_landmark(landmarks: list[Landmark], factory) -> dict[str, float]:
    """For each landmark L: refit on rest; predict L; report pixel distance."""
    out: dict[str, float] = {}
    for i, target in enumerate(landmarks):
        rest = [l for j, l in enumerate(landmarks) if j != i]
        try:
            predict = factory(rest)
        except (ValueError, RuntimeError) as e:
            out[target.name] = float("nan")
            continue
        try:
            pred = predict(np.array([target.hockey], dtype=np.float64))
        except Exception:
            out[target.name] = float("nan")
            continue
        ppx, ppy = float(pred[0, 0]), float(pred[0, 1])
        if math.isnan(ppx) or math.isnan(ppy):
            out[target.name] = float("nan")
            continue
        out[target.name] = math.hypot(target.px - ppx, target.py - ppy)
    return out


def summarize(label: str, per_lm: dict[str, float], note: str = "") -> MethodResult:
    valid = [v for v in per_lm.values() if not math.isnan(v)]
    boundary = [per_lm[k] for k in BOUNDARY_LANDMARKS
                if k in per_lm and not math.isnan(per_lm[k])]
    inner = [per_lm[k] for k in INNER_LANDMARKS
             if k in per_lm and not math.isnan(per_lm[k])]
    mean = sum(valid) / len(valid) if valid else float("nan")
    bm = sum(boundary) / len(boundary) if boundary else float("nan")
    im = sum(inner) / len(inner) if inner else float("nan")
    return MethodResult(
        label=label,
        mean_tre_px=mean,
        boundary_mean_tre_px=bm,
        inner_mean_tre_px=im,
        per_landmark_tre=per_lm,
        coverage=len(valid),
        notes=note,
    )


def shared_landmarks_mean(results: dict[str, MethodResult]) -> tuple[set[str], dict[str, float]]:
    """Return (set of landmarks all methods could predict, per-method mean on that set).

    This is a fair-comparison metric. PWA can only predict a subset of
    landmarks under LOOCV (interior points only); restricting every
    method to the same subset prevents apples-to-oranges comparisons.
    """
    all_lms: set[str] | None = None
    for res in results.values():
        valid = {k for k, v in res.per_landmark_tre.items() if not math.isnan(v)}
        all_lms = valid if all_lms is None else (all_lms & valid)
    shared = all_lms or set()
    per_method: dict[str, float] = {}
    for label, res in results.items():
        vals = [res.per_landmark_tre[k] for k in shared
                if k in res.per_landmark_tre and not math.isnan(res.per_landmark_tre[k])]
        per_method[label] = sum(vals) / len(vals) if vals else float("nan")
    return shared, per_method


# ── Hull gate ────────────────────────────────────────────────────────────────

def hull_in_pixel_space(landmarks: list[Landmark]):
    """Returns (Delaunay, hull_polygon, hull_area_px, rink_box_area_px, in_hull_fn).

    in_hull_fn takes (Nx2 ndarray of pixel positions) → boolean ndarray.
    """
    pts = np.array([(l.px, l.py) for l in landmarks], dtype=np.float64)
    hull = ConvexHull(pts)
    hull_polygon = pts[hull.vertices]
    tri = Delaunay(pts[hull.vertices])

    def in_hull(query: np.ndarray) -> np.ndarray:
        # find_simplex returns -1 for points outside any triangle (= outside hull).
        return tri.find_simplex(query) >= 0

    return tri, hull_polygon, hull.volume, in_hull


# ── Foldover check (PWA-specific) ────────────────────────────────────────────

def pwa_foldover_check(predict_fn, landmarks: list[Landmark]) -> dict:
    """Sample a dense hockey grid through PWA and check for inverted triangles.

    A foldover is detected when the projected grid has a triangle with a
    negative signed area (orientation flipped). We sample a 21x11 grid over
    [-100, 100] × [-42.5, 42.5] and compute signed areas on a Delaunay
    triangulation of the projected points.
    """
    # Build a dense hockey grid (only sample points inside or near the hull).
    hxs = np.linspace(-100, 100, 21)
    hys = np.linspace(-42.5, 42.5, 11)
    HX, HY = np.meshgrid(hxs, hys)
    grid_hockey = np.column_stack([HX.ravel(), HY.ravel()])
    grid_pixel = predict_fn(grid_hockey)

    # Filter NaNs (out-of-hull under PWA)
    valid_mask = ~(np.isnan(grid_pixel[:, 0]) | np.isnan(grid_pixel[:, 1]))
    valid_hockey = grid_hockey[valid_mask]
    valid_pixel = grid_pixel[valid_mask]
    n_valid = int(valid_mask.sum())
    n_total = grid_hockey.shape[0]

    # Triangulate in hockey space; project to pixel; foldover = orientation
    # of the projected triangle disagreeing with the majority orientation.
    # (Note: pixel-y points DOWN while hockey-y points UP, so a faithful
    # transform inverts orientation globally — we measure deviations from
    # the majority sign, not the sign itself.)
    foldover_count = 0
    triangles_total = 0
    if n_valid >= 3:
        tri = Delaunay(valid_hockey)
        signs: list[int] = []
        for simplex in tri.simplices:
            a, b, c = valid_pixel[simplex[0]], valid_pixel[simplex[1]], valid_pixel[simplex[2]]
            signed = 0.5 * ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]))
            signs.append(1 if signed > 0 else (-1 if signed < 0 else 0))
        triangles_total = len(signs)
        # Majority orientation
        pos = sum(1 for s in signs if s > 0)
        neg = sum(1 for s in signs if s < 0)
        majority = 1 if pos >= neg else -1
        foldover_count = sum(1 for s in signs if s != 0 and s != majority)

    return {
        "grid_total": n_total,
        "grid_valid": n_valid,
        "grid_out_of_hull": n_total - n_valid,
        "triangles_total": triangles_total,
        "triangles_flipped": foldover_count,
    }


# ── Visualization ────────────────────────────────────────────────────────────

def render_winner_overlay(frame_path: Path, landmarks: list[Landmark],
                          factories: dict, winner_label: str, out_path: Path):
    """Plot measured (green) + winner-predicted (red diamond) + hull outline."""
    img = cv2.imread(str(frame_path))
    if img is None:
        print(f"WARN: could not read {frame_path}", file=sys.stderr)
        return
    overlay = img.copy()
    GREEN = (0, 255, 0)
    RED = (60, 60, 255)
    CYAN = (255, 255, 0)

    # Hull outline
    pts = np.array([(int(l.px), int(l.py)) for l in landmarks], dtype=np.int32)
    hull = cv2.convexHull(pts)
    cv2.polylines(overlay, [hull], isClosed=True, color=CYAN, thickness=2)

    # Measured (green)
    for l in landmarks:
        cv2.circle(overlay, (int(l.px), int(l.py)), 8, GREEN, 2)
        cv2.putText(overlay, l.name, (int(l.px) + 10, int(l.py) - 6),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.38, GREEN, 1, cv2.LINE_AA)

    # Winner predictions (red diamonds — should be near-exact for in-sample fit)
    predict = factories[winner_label](landmarks)
    hxy = np.array([l.hockey for l in landmarks], dtype=np.float64)
    pred = predict(hxy)
    for (ppx, ppy) in pred:
        if math.isnan(ppx) or math.isnan(ppy):
            continue
        cv2.drawMarker(overlay, (int(ppx), int(ppy)), RED, cv2.MARKER_DIAMOND, 12, 2)

    cv2.putText(overlay, f"GREEN=measured  RED<>={winner_label}  CYAN=hull",
                (10, overlay.shape[0] - 10), cv2.FONT_HERSHEY_SIMPLEX,
                0.5, (255, 255, 255), 1, cv2.LINE_AA)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(out_path), overlay)
    print(f"Wrote overlay: {out_path}")


def render_warp_grid(frame_path: Path, landmarks: list[Landmark],
                     factories: dict, winner_label: str, out_path: Path):
    """Project a regular hockey grid through the winning method onto pixel space.

    Draws a deformed grid over the source frame to visualize what the calibration
    actually does to a uniform input. Foldovers, severe distortion, or out-of-frame
    excursions become visually obvious.
    """
    img = cv2.imread(str(frame_path))
    if img is None:
        print(f"WARN: could not read {frame_path}", file=sys.stderr)
        return
    overlay = img.copy().astype(np.float64)
    # Dim the background so the grid pops
    overlay = overlay * 0.5
    overlay = overlay.astype(np.uint8)

    GREEN = (0, 220, 0)
    YELLOW = (0, 255, 255)
    RED = (60, 60, 255)
    LIGHT = (220, 220, 220)

    # Hockey grid spacing: every 10 ft on x, every 5 ft on y
    hxs = np.arange(-100, 101, 10)
    hys = np.arange(-42.5, 42.5 + 0.01, 5)

    predict = factories[winner_label](landmarks)

    # Project each row (constant hy, varying hx) and each column (constant hx, varying hy)
    def project_polyline(points_hockey: np.ndarray) -> np.ndarray:
        return predict(points_hockey)

    # Sample 41 points per row/col for smoother curves under non-linear warps
    fine_x = np.linspace(-100, 100, 81)
    fine_y = np.linspace(-42.5, 42.5, 41)

    # Horizontal grid lines
    for hy in hys:
        pts = np.column_stack([fine_x, np.full_like(fine_x, hy)])
        proj = project_polyline(pts)
        pts_int = []
        for (ppx, ppy) in proj:
            if math.isnan(ppx) or math.isnan(ppy):
                if pts_int:
                    cv2.polylines(overlay, [np.array(pts_int, dtype=np.int32)],
                                  isClosed=False, color=LIGHT, thickness=1)
                pts_int = []
                continue
            pts_int.append([int(ppx), int(ppy)])
        if pts_int:
            cv2.polylines(overlay, [np.array(pts_int, dtype=np.int32)],
                          isClosed=False, color=LIGHT, thickness=1)

    # Vertical grid lines
    for hx in hxs:
        pts = np.column_stack([np.full_like(fine_y, hx), fine_y])
        proj = project_polyline(pts)
        pts_int = []
        for (ppx, ppy) in proj:
            if math.isnan(ppx) or math.isnan(ppy):
                if pts_int:
                    cv2.polylines(overlay, [np.array(pts_int, dtype=np.int32)],
                                  isClosed=False, color=LIGHT, thickness=1)
                pts_int = []
                continue
            pts_int.append([int(ppx), int(ppy)])
        if pts_int:
            cv2.polylines(overlay, [np.array(pts_int, dtype=np.int32)],
                          isClosed=False, color=LIGHT, thickness=1)

    # Highlight zero-x and zero-y in yellow, blue lines in green
    def project_line(hxs_pts, hy):
        return project_polyline(np.column_stack([hxs_pts, np.full_like(hxs_pts, hy)]))

    def project_vline(hx, hys_pts):
        return project_polyline(np.column_stack([np.full_like(hys_pts, hx), hys_pts]))

    def draw(proj: np.ndarray, color, thickness=2):
        pts_int = []
        for (ppx, ppy) in proj:
            if math.isnan(ppx) or math.isnan(ppy):
                if pts_int:
                    cv2.polylines(overlay, [np.array(pts_int, dtype=np.int32)],
                                  isClosed=False, color=color, thickness=thickness)
                pts_int = []
                continue
            pts_int.append([int(ppx), int(ppy)])
        if pts_int:
            cv2.polylines(overlay, [np.array(pts_int, dtype=np.int32)],
                          isClosed=False, color=color, thickness=thickness)

    draw(project_line(fine_x, 0.0), YELLOW, 2)   # red line (centre)
    draw(project_vline(0.0, fine_y), YELLOW, 2)
    draw(project_vline(-25.0, fine_y), GREEN, 2)  # blue lines
    draw(project_vline(25.0, fine_y), GREEN, 2)
    draw(project_vline(-89.0, fine_y), RED, 2)    # goal lines
    draw(project_vline(89.0, fine_y), RED, 2)

    # Landmark dots on top
    for l in landmarks:
        cv2.circle(overlay, (int(l.px), int(l.py)), 6, (0, 255, 0), -1)

    cv2.putText(overlay,
                f"Warp grid: {winner_label}.  "
                f"YELLOW=x=0,y=0  GREEN=blue lines (+/-25)  RED=goal lines (+/-89)",
                (10, overlay.shape[0] - 10), cv2.FONT_HERSHEY_SIMPLEX,
                0.5, (255, 255, 255), 1, cv2.LINE_AA)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(out_path), overlay)
    print(f"Wrote warp grid: {out_path}")


# ── Main ─────────────────────────────────────────────────────────────────────

def main() -> int:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--landmarks-json", default=str(LANDMARKS_JSON))
    p.add_argument("--results-md", default="/tmp/calibration-spike-v2-results.md")
    p.add_argument("--overlay-png", default="/tmp/calibration-spike-v2-overlay.png")
    p.add_argument("--warp-grid-png", default="/tmp/calibration-spike-v2-warp-grid.png")
    args = p.parse_args()

    cfg = json.loads(Path(args.landmarks_json).read_text())
    landmarks: list[Landmark] = [
        Landmark(name=n, px=float(p[0]), py=float(p[1]))
        for n, p in cfg["landmarks"].items() if p is not None
    ]
    n_lm = len(landmarks)
    print(f"Loaded {n_lm} landmarks from {args.landmarks_json}")
    print(f"Frame: {cfg['frame']}\n")

    # Build the method registry. Each entry: label → factory(landmarks)→predict
    factories: dict[str, callable] = {}
    factories["linear"] = factory_linear
    factories["tps_skimage"] = factory_tps_skimage

    smoothing_grid = [0.0, 0.1, 0.5, 1.0, 2.0, 5.0, 10.0, 20.0, 50.0, 100.0]
    for k in smoothing_grid:
        factories[f"tps_smooth_k={k}"] = (lambda lms, kk=k: factory_tps_rbf(lms, smoothing=kk))

    # neighbors=k: scipy requires neighbors <= n. Cap at n.
    neighbors_grid = [4, 6, 8, 10, n_lm]
    for k in neighbors_grid:
        if k > n_lm:
            continue
        label = f"tps_neighbors_k={k}"
        factories[label] = (lambda lms, kk=k: factory_tps_rbf(lms, smoothing=0.0, neighbors=kk))

    factories["pwa"] = factory_pwa

    # Run LOOCV-TRE on every method
    results: dict[str, MethodResult] = {}
    print("== LOOCV-TRE per method (full set) ==\n")
    print(f"  {'method':32s} {'cov':>4s} {'mean(px)':>10s} {'mean(ft)':>10s} "
          f"{'boundary(px)':>13s} {'inner(px)':>10s} note")
    # Use linear's global px/ft as a rough px→ft scale for display.
    lin_pred = factory_linear(landmarks)
    cfg_lin = lin_pred.config  # type: ignore[attr-defined]
    avg_pxft = (cfg_lin["hw"] / 100.0 + cfg_lin["hh"] / 42.5) / 2.0

    for label, factory in factories.items():
        try:
            per_lm = loocv_per_landmark(landmarks, factory)
            res = summarize(label, per_lm)
        except Exception as e:
            res = MethodResult(label=label, mean_tre_px=float("nan"),
                               boundary_mean_tre_px=float("nan"),
                               inner_mean_tre_px=float("nan"),
                               per_landmark_tre={}, coverage=0, notes=f"ERROR: {e}")
        results[label] = res
        ft = res.mean_tre_px / avg_pxft if not math.isnan(res.mean_tre_px) else float("nan")
        print(f"  {label:32s} {res.coverage:>4d} {res.mean_tre_px:10.2f} {ft:10.2f} "
              f"{res.boundary_mean_tre_px:13.2f} {res.inner_mean_tre_px:10.2f} {res.notes}")

    # Fair-comparison metric: mean LOOCV-TRE restricted to the landmarks
    # ALL methods could predict. PWA collapses to interior-only, so this
    # set is small (~5 landmarks) but apples-to-apples.
    shared_lms, shared_means = shared_landmarks_mean(results)
    print(f"\n== LOOCV-TRE on shared landmarks ({len(shared_lms)} of {n_lm}) ==")
    if shared_lms:
        print(f"  shared: {sorted(shared_lms)}")
    print(f"  {'method':32s} {'shared mean(px)':>16s} {'shared mean(ft)':>16s}")
    for label in factories.keys():
        m = shared_means.get(label, float("nan"))
        ft = m / avg_pxft if not math.isnan(m) else float("nan")
        print(f"  {label:32s} {m:16.2f} {ft:16.2f}")

    # PWA foldover check
    pwa_foldover = pwa_foldover_check(factory_pwa(landmarks), landmarks)
    print(f"\n== PWA foldover check ==")
    print(f"  grid points: {pwa_foldover['grid_valid']}/{pwa_foldover['grid_total']} valid "
          f"(in-hull); {pwa_foldover['triangles_flipped']} flipped triangles "
          f"of {pwa_foldover['triangles_total']}")

    # Winner pick: best mean LOOCV-TRE on FULL set, among methods with
    # full coverage (i.e., able to predict every held-out landmark).
    # PWA is excluded by coverage filter rather than by foldover.
    full_coverage = [(l, r) for l, r in results.items()
                     if r.coverage == n_lm and not math.isnan(r.mean_tre_px)]
    if not full_coverage:
        print("\nERROR: no method achieves full coverage", file=sys.stderr)
        return 1
    winner_label, winner = min(full_coverage, key=lambda kv: kv[1].mean_tre_px)

    # Boundary-specialist runner-up: among full-coverage methods, which has
    # the best boundary mean? (Often a different choice from overall.)
    boundary_best_label, boundary_best = min(
        full_coverage, key=lambda kv: kv[1].boundary_mean_tre_px
    )

    print(f"\n== WINNERS (full coverage only) ==")
    print(f"  Best overall mean: {winner_label}")
    print(f"    mean LOOCV-TRE: {winner.mean_tre_px:.2f} px "
          f"({winner.mean_tre_px / avg_pxft:.2f} ft)")
    print(f"    boundary: {winner.boundary_mean_tre_px:.2f} px, "
          f"inner: {winner.inner_mean_tre_px:.2f} px")
    print(f"  Best boundary mean: {boundary_best_label}")
    print(f"    boundary LOOCV-TRE: {boundary_best.boundary_mean_tre_px:.2f} px "
          f"({boundary_best.boundary_mean_tre_px / avg_pxft:.2f} ft)")
    print(f"    overall mean: {boundary_best.mean_tre_px:.2f} px, "
          f"inner: {boundary_best.inner_mean_tre_px:.2f} px")

    # Hull stats (static analysis — spike D layer 1)
    pts = np.array([(l.px, l.py) for l in landmarks], dtype=np.float64)
    hull = ConvexHull(pts)
    rink_box_w = 100 + 100  # ±100 ft on x
    rink_box_h = 42.5 * 2   # ±42.5 ft on y
    # Approximate rink-art area in pixels using linear's bbox.
    linear_box_area = cfg_lin["hw"] * 2 * cfg_lin["hh"] * 2
    hull_coverage = hull.volume / linear_box_area * 100
    print(f"\n== HULL STATS ==")
    print(f"  hull area: {hull.volume:.0f} px²")
    print(f"  rink box area (linear fit): {linear_box_area:.0f} px²")
    print(f"  hull coverage of rink: {hull_coverage:.1f}%")

    # Render visualizations — one set for the overall winner, one for the
    # boundary specialist (often different).
    frame_path = REPO_ROOT / cfg["frame"]
    render_winner_overlay(frame_path, landmarks, factories, winner_label,
                          Path(args.overlay_png))
    render_warp_grid(frame_path, landmarks, factories, winner_label,
                     Path(args.warp_grid_png))
    if boundary_best_label != winner_label:
        # Append _boundary to the path stems
        overlay_b = Path(str(args.overlay_png).replace(".png", "-boundary.png"))
        warp_b = Path(str(args.warp_grid_png).replace(".png", "-boundary.png"))
        render_winner_overlay(frame_path, landmarks, factories, boundary_best_label,
                              overlay_b)
        render_warp_grid(frame_path, landmarks, factories, boundary_best_label,
                         warp_b)

    # Write structured findings markdown
    write_results_md(Path(args.results_md), results, winner_label,
                     boundary_best_label, shared_lms, shared_means, pwa_foldover,
                     hull_coverage, hull.volume, linear_box_area, avg_pxft,
                     n_lm, cfg["frame"])
    return 0


def write_results_md(out_path: Path, results: dict[str, MethodResult],
                    winner_label: str, boundary_best_label: str,
                    shared_lms: set[str], shared_means: dict[str, float],
                    pwa_foldover: dict, hull_coverage: float,
                    hull_area_px: float, rink_box_area: float, avg_pxft: float,
                    n_lm: int, frame: str):
    lines: list[str] = []
    lines.append("# Calibration spike v2 — results\n")
    lines.append(f"- Landmarks: {n_lm}")
    lines.append(f"- Frame: `{frame}`")
    lines.append(f"- Global px/ft (linear fit avg): {avg_pxft:.3f}\n")

    lines.append("## LOOCV-TRE summary (full set)\n")
    lines.append("Methods with coverage < " + str(n_lm) + " could not predict every "
                 "held-out landmark (PWA: held-out boundary points fall outside the "
                 "remaining-landmarks hull). Means are over predictable landmarks "
                 "only, so they are **not comparable across rows of different coverage**. "
                 "See \"shared-landmarks comparison\" below for an apples-to-apples view.\n")
    lines.append("| method | coverage | mean (px) | mean (ft) | boundary (px) | inner (px) | notes |")
    lines.append("|---|---:|---:|---:|---:|---:|---|")
    for label, res in results.items():
        ft = res.mean_tre_px / avg_pxft if not math.isnan(res.mean_tre_px) else float("nan")
        lines.append(
            f"| `{label}` | {res.coverage}/{n_lm} | {res.mean_tre_px:.2f} | {ft:.2f} | "
            f"{res.boundary_mean_tre_px:.2f} | {res.inner_mean_tre_px:.2f} | {res.notes} |"
        )

    lines.append(f"\n## Shared-landmarks comparison ({len(shared_lms)} landmarks)\n")
    if shared_lms:
        lines.append(f"Shared set: `{sorted(shared_lms)}`")
    lines.append("\n| method | shared mean (px) | shared mean (ft) |")
    lines.append("|---|---:|---:|")
    for label in results.keys():
        m = shared_means.get(label, float("nan"))
        ft = m / avg_pxft if not math.isnan(m) else float("nan")
        lines.append(f"| `{label}` | {m:.2f} | {ft:.2f} |")

    lines.append("\n## PWA foldover\n")
    lines.append(f"- Grid points: {pwa_foldover['grid_valid']}/{pwa_foldover['grid_total']} "
                 f"valid (in-hull)")
    lines.append(f"- Triangles flipped: {pwa_foldover['triangles_flipped']}/"
                 f"{pwa_foldover['triangles_total']}")

    lines.append("\n## Hull stats (spike D static analysis)\n")
    lines.append(f"- Hull area in pixel space: {hull_area_px:.0f} px²")
    lines.append(f"- Linear-fit rink box: {rink_box_area:.0f} px²")
    lines.append(f"- Hull coverage of rink box: {hull_coverage:.1f}%")
    lines.append("- Production rule: predictions outside the hull should emit a "
                 "`confidence='extrapolated'` flag.")

    lines.append("\n## Winners (full-coverage methods only)\n")
    res = results[winner_label]
    lines.append(f"**Best overall mean: `{winner_label}`** — mean LOOCV-TRE "
                 f"{res.mean_tre_px:.2f} px ({res.mean_tre_px / avg_pxft:.2f} ft).")
    lines.append(f"  - boundary mean: {res.boundary_mean_tre_px:.2f} px")
    lines.append(f"  - inner mean: {res.inner_mean_tre_px:.2f} px")
    if boundary_best_label != winner_label:
        b = results[boundary_best_label]
        lines.append(f"\n**Best boundary mean: `{boundary_best_label}`** — boundary "
                     f"LOOCV-TRE {b.boundary_mean_tre_px:.2f} px "
                     f"({b.boundary_mean_tre_px / avg_pxft:.2f} ft).")
        lines.append(f"  - overall mean: {b.mean_tre_px:.2f} px")
        lines.append(f"  - inner mean: {b.inner_mean_tre_px:.2f} px")

    lines.append("\n## Per-landmark LOOCV-TRE (overall winner)\n")
    lines.append("| landmark | TRE (px) |")
    lines.append("|---|---:|")
    for name, tre in sorted(res.per_landmark_tre.items()):
        lines.append(f"| `{name}` | {tre:.2f} |")

    if boundary_best_label != winner_label:
        lines.append("\n## Per-landmark LOOCV-TRE (boundary specialist)\n")
        lines.append("| landmark | TRE (px) |")
        lines.append("|---|---:|")
        b = results[boundary_best_label]
        for name, tre in sorted(b.per_landmark_tre.items()):
            lines.append(f"| `{name}` | {tre:.2f} |")

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text("\n".join(lines) + "\n")
    print(f"Wrote results: {out_path}")


if __name__ == "__main__":
    sys.exit(main())
