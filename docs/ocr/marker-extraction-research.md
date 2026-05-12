# Event-Map Marker Extraction — Research Dossier

Status: **SHIPPED (2026-05-13)** — `tps_neighbors_k=6 + hull gate` is live
in `spatial.py:pixel_to_hockey` as of commit `a951ec7`. The remaining open
items are downstream: surfacing the `confidence` flag in `match_events`
(needs migration + worker write + web rendering), reprocessing existing
match events under the new calibration, and adding 4 more landmarks to
lift hull coverage from 59% to ~85%+. See "Round-3 internal spike
findings" below for the empirical evidence and "Next-pass priorities"
for what remains. Last updated 2026-05-13.

This doc consolidates everything we know about extracting hockey-event markers
from EA NHL Action Tracker screenshots, derived from a fresh round of internal
codebase research plus an external web research pass. Used as the briefing for
the next implementation pass.

---

## Problem statement

The Action Tracker screen in EA NHL shows a 2D rink illustration with every
event of the period plotted as a small icon at its on-ice position. We want
to extract:

- **Every marker** on the rink (not just the currently-selected one)
- For each: **event type** (Hit/Shot/Penalty/Goal), **team side** (BGM/opp),
  **pixel position**, and ultimately **hockey-standard coordinates**
- Tied back to specific `match_events` rows so the web shot map can render
  per-event tooltips

### Visual encoding of markers

| signal | how it's rendered | resolves |
|---|---|---|
| **shape** | Hit = box, Shot = circle, Penalty = diamond, Goal = hexagon | event type |
| **fill style** | Home = solid team color + white letter. Away = white interior with team-color outer ring + black letter | team side |
| **letter** | tiny `H` / `S` / `G` / `P` inside the marker | event type (redundant with shape) |
| **yellow glow** | overlaid on exactly one marker per frame | which event is currently highlighted |

### Calibration challenge

The in-game rink art is **stylized**, not a linear scaling of an NHL rink. From
12 manually-measured Photoshop landmarks, implied `px/ft` ratios on x are:

| feature | implied px/ft on x |
|---|---|
| blue lines (±25 ft) | 5.20 |
| end-zone faceoff dots (±69 ft) | 4.42 |
| goal lines (±89 ft) | 4.65 |
| end walls (±100 ft) | 4.73 |

No single linear scaling makes every feature align. Current single-anchor
calibration (4.74 px/ft, anchored to boards) leaves a 3-5 ft horizontal
squeeze on offensive-zone events.

---

## Current state (what works, what doesn't)

### Working (don't reinvent)

- **`rink_pixel_box` calibration** + manual landmark measurement workflow
  ([recalibrate_rink.py](../../tools/game_ocr/scripts/recalibrate_rink.py))
- **HSV color masking infrastructure** in [spatial.py](../../tools/game_ocr/game_ocr/spatial.py)
  (`_color_mask`, `_morphological_clean`)
- **Yellow-selected-marker detection** (`find_selected_marker`)
- **White-border-row detector** in the events list panel
  (`detect_selected_row_index`) — identifies which event is currently highlighted
- **Parsed events list** per capture (clock, actor, type, target stored as JSONB)
- **CVAT-based human labeling pipeline** (kept as fallback / QC tool)
- **`pixel_to_hockey` linear conversion** — works, but precision-limited

### Gaps (what's missing)

1. **Shape classification** — can't tell a hexagon from a circle from a box
   from a diamond. Current detector treats every blob as just "a marker."
2. **Fill-style classification** — no solid-vs-outlined discriminator.
3. **Full-frame inventory** — currently extracts one yellow marker per frame;
   never enumerates the dozens of static markers also on the rink.
4. **Non-linear calibration** — single linear scaling can't honor every
   landmark simultaneously. ±3-5 ft horizontal squeeze on offensive-zone
   events.
5. **Marker overlap / cluster disambiguation** — when multiple events stack
   at the same on-ice location, contour detection merges them.
6. **Automatic team-color resolution** — BGM is always red, but opp color
   varies per match (currently treated as "black" which is wrong for some
   opponents).
7. **End-to-end test harness** for calibration accuracy.

---

## Recommended architecture (from synthesis of internal + external research)

### Layer 1 — Calibration: replace linear with **Thin Plate Spline (TPS)**

**Updated recommendation (Round 2):** prefer **scikit-image's
`ThinPlateSplineTransform`** as the primary; fall back to **SciPy's
`RBFInterpolator(kernel="thin_plate_spline")`** if you need smoothing /
neighbor-limited evaluation. scikit-image gives a proper transform object
with a built-in `inverse` property; SciPy needs a second interpolator on
swapped landmarks (workable but less clean). Avoid OpenCV's TPS — two
known Python-binding regressions (long-open `applyTransformation` bug + a
4.10 wheel that dropped `createThinPlateSplineShapeTransformer()` for
some users). Avoid the `thin-plate-spline` PyPI package as a default —
current but classified Beta and single-maintainer.

**Why TPS and not the alternatives:**

| approach | why | why not |
|---|---|---|
| Single linear (current) | simple | leaves 3-5 ft error on stylized rink |
| Affine / projective baseline | safe extrapolation, well-understood | cannot absorb local bends from stylized art |
| Piecewise linear (per-region) | exact at every landmark | discontinuities at region edges; awkward to inverse |
| **Thin Plate Spline (recommended)** | exact at every landmark, smooth interpolation, closed-form, no tuning parameters | exact-fit can amplify noisy landmarks → regularize |
| Piecewise affine (Delaunay triangulation) | exact at landmarks, deterministic local control | requires corner points for full coverage; less smooth between landmarks |
| B-spline registration (ITK / SimpleITK) | mature registration framework | heavyweight for 10-20 landmarks |
| Moving Least Squares | smooth | Python ecosystem less standardized than SciPy/skimage |
| Homography (8-param) | well-known | wrong tool — assumes 3D camera projection, not stylized 2D art |
| Deep-learning grid-fitting | overkill | not needed for 12 landmark pairs |

**Implementation sketch** (≤30 lines):

```python
# pip install scikit-image>=0.26
import numpy as np
from skimage.transform import ThinPlateSplineTransform

# Landmarks: (pixel_x, pixel_y) → (hockey_x, hockey_y)
LANDMARKS = [
    # (px, py, xh, yh)
    (1310, 608,   0.0,   0.0),    # centre ice
    (1180, 608, -25.0,   0.0),    # blue line L
    (1440, 608, +25.0,   0.0),    # blue line R
    ( 895, 608, -89.0,   0.0),    # goal line L
    (1722, 608, +89.0,   0.0),    # goal line R
    ( 835, 608, -100.0,  0.0),    # end wall L
    (1782, 608, +100.0,  0.0),    # end wall R
    (1004, 510, -69.0, +22.0),    # ez-fo top-left
    (1004, 703, -69.0, -22.0),    # ez-fo bot-left
    (1615, 510, +69.0, +22.0),    # ez-fo top-right
    (1615, 703, +69.0, -22.0),    # ez-fo bot-right
    (1310, 402,   0.0, +42.5),    # board top
    (1310, 811,   0.0, -42.5),    # board bottom
]
src = np.array([(p[0], p[1]) for p in LANDMARKS], dtype=np.float64)
dst = np.array([(p[2], p[3]) for p in LANDMARKS], dtype=np.float64)

# Forward: pixel → hockey
forward = ThinPlateSplineTransform()
forward.estimate(src, dst)
# Inverse: hockey → pixel (for overlays)
inverse = ThinPlateSplineTransform()
inverse.estimate(dst, src)

# Usage
hockey_xy = forward(np.array([[1200, 700]]))  # → array([[hx, hy]])
```

scikit-image 0.26+ ships `ThinPlateSplineTransform`; deterministic,
closed-form, ergonomic. If we later need smoothing/regularization to handle
noisy landmark clicks, swap to:

```python
from scipy.interpolate import RBFInterpolator
forward = RBFInterpolator(src, dst, kernel="thin_plate_spline", smoothing=0.5)
# Inverse needs a second instance on swapped landmarks.
```

### Layer 2 — Full-frame marker detection (replaces current "yellow-only" approach)

For each capture:

1. Crop the rink region using the calibrated `rink_pixel_box`.
2. Build per-color HSV masks (BGM-red, opp-color, white). Auto-resolve
   opp-color from a known UI region or via K-means on the marker pixels.
3. `findContours` on each mask. Filter by area band (markers are ~30×30 px).
4. For each contour, classify shape with **`cv2.approxPolyDP`** + circularity:
   - High circularity + many vertices → **shot** (circle)
   - 6 vertices with regular spacing → **goal** (hexagon)
   - 4 vertices, axis-aligned bounding rect → **hit** (square)
   - 4 vertices, ~45° rotated → **penalty** (diamond)
5. Classify fill style with **centroid-vs-annulus pixel sampling**:
   - Sample mean color in a small disc at the centroid (always white text/letter)
   - Sample mean color in a thin annulus between centroid and edge
   - Solid home: annulus reads team-color (high S, on-hue)
   - Outlined away: annulus reads near-white
6. Optionally verify by reading the letter inside (tiny CNN or template
   matching on `H` / `S` / `G` / `P` templates). Defer until shape+fill
   classification proves insufficient.

### Layer 3 — Marker-to-event matching

Use two reinforcing signals:

- **Yellow-chain (already implemented)**: per-frame, the highlighted marker's
  position belongs to the event the user clicked, identified via the parsed
  events list + `selected_event_index`. Gives 1:1 mapping for highlighted
  events.
- **Inventory consensus (new)**: detect every marker every frame. Markers
  that appear consistently across many frames are real. (type, side)
  cardinality must match the events list for that period. When yellow-chain
  fills in identity for highlighted events, the remaining unidentified
  markers in the inventory are events that were never highlighted — assign
  them by position-clustering against the events list's expected counts.

### Layer 4 — Open: pipeline-level architectural pattern

Detection-then-matching (most common in CV literature) is the natural fit.
Joint optimization (e.g., bipartite matching between detected markers and
events list) could improve on stacked/overlapping cases. Defer until
inventory consensus proves insufficient.

### Layer 5 — Overlap handling (watershed + bipartite assignment)

When multiple markers stack at the same on-ice location, contour detection
returns a single merged blob. Hybrid two-branch strategy:

1. **Easy case (single-blob connected components):** classify directly via
   Layer 2's shape/fill/color pipeline.
2. **Ambiguity branch (merged blob detected):** run **distance-transform-
   driven watershed** ([OpenCV tutorial](https://docs.opencv.org/4.x/d3/db4/tutorial_py_watershed.html))
   to split the blob into candidate sub-instances. Score each candidate
   against expected `(shape, fill, color)` templates from the events list.
3. **Assignment:** solve as a bipartite-matching problem via SciPy
   `scipy.optimize.linear_sum_assignment` over a cost matrix of
   (candidate_sub_instance × expected_event). Cost = shape-mismatch +
   fill-mismatch + position-distance.

Merge-detection trigger: contour area substantially above the typical
single-marker area band, or aspect ratio diverging from any single-class
prior.

Iterative "detect best template, subtract, repeat" is a simpler backup
but accumulates error fast with poor masks — reserve as a last resort.

This addresses internal gap #5 (marker overlap / cluster disambiguation).

---

## Internal research findings (recap)

### What exists in the codebase

- [`spatial.py:detect_rink_markers`](../../tools/game_ocr/game_ocr/spatial.py) —
  HSV-based contour detection by color, no shape classification. Returns
  `DetectedMarker(pixel_x, pixel_y, color, area_px, bbox)`.
- [`spatial.py:find_selected_marker`](../../tools/game_ocr/game_ocr/spatial.py) —
  yellow-blob picker, largest-yellow heuristic.
- [`spatial.py:detect_selected_row_index`](../../tools/game_ocr/game_ocr/spatial.py) —
  white-border peak detector on the events list panel. Validated 6/6 on
  ground-truth captures.
- [`spatial.py:pixel_to_hockey`](../../tools/game_ocr/game_ocr/spatial.py) —
  linear, single-anchor.
- [`spatial.py:detect_bgm_attack_direction`](../../tools/game_ocr/game_ocr/spatial.py) —
  end-zone-bar color sampling. Validated 3/3 periods.
- [`recalibrate_rink.py`](../../tools/game_ocr/scripts/recalibrate_rink.py) —
  least-squares fit from landmark inputs. Working.
- [Marker SVG references](../../apps/web/src/components/branding/event-markers.tsx) —
  authoritative reference for shape geometry.

### Reusable for the redesign

- Calibration math + `rink_pixel_box`
- HSV mask building (`_color_mask`)
- Contour detection scaffolding
- Parsed events list per capture
- White-border-row detector
- CVAT integration (as optional QC tool)

### Needs new code

- TPS-based `pixel_to_hockey` and `hockey_to_pixel`
- Shape classifier (`approxPolyDP` + circularity branch)
- Fill-style classifier (centroid-vs-annulus pixel sampling)
- Auto opp-color resolution (currently hard-coded as "non-red")
- Marker-to-event matcher beyond the yellow-chain
- Calibration-accuracy test harness

---

## External research findings (web research, May 2026)

### What the sports CV field is doing (and how it maps to us)

Most sports CV work is about **broadcast footage** — recovering 2D rink
coordinates from a moving 3D camera angle via homography. That's the wrong
problem family for our fixed 2D game UI. The closer analog is **video game
minimap detection** (e.g., League of Legends champion-detection projects),
which use template matching for fixed-icon recognition.

Hockey-specific projects that exist (sieve-data/hockey-vision-analytics,
ccweaver1/bsi_vision, HockeyAI dataset) all target broadcast footage and
don't apply directly. No public project extracts event data from an EASHL
or NHL game's post-game UI — our problem is genuinely novel.

### Non-rigid 2D coordinate mapping — recommended primary tool: Thin Plate Spline

TPS is the standard in CV literature for non-rigid 2D-to-2D mapping with
sparse landmarks. Closed-form, infinitely differentiable, no parameters to
tune. SciPy's `RBFInterpolator(kernel="thin_plate_spline")` is the
recommended Python implementation in 2026 (active maintenance, stable API).
OpenCV's `cv2.createThinPlateSplineShapeTransformer` has flaky Python
bindings — avoid.

Piecewise affine via Delaunay triangulation
([scikit-image PiecewiseAffineTransform](https://scikit-image.org/docs/stable/auto_examples/transform/plot_piecewise_affine.html))
is a simpler alternative: lands each landmark exactly, requires corner
points for full coverage, less smooth than TPS between landmarks.

### Shape classification — `approxPolyDP` + circularity is the field consensus

For 4 well-separated shape classes (hexagon / circle / box / diamond),
`approxPolyDP` with `epsilon ≈ 2-3% of perimeter` followed by vertex count
and circularity is the standard approach. Template matching is brittle to
scale; deep learning is overkill for 4 classes.

For distinguishing box (Hit) from diamond (Penalty), both yield 4 vertices —
discriminate by angle of edges vs axis-aligned (axis-aligned box has edges
parallel to x/y; diamond's edges are at ~45°). `cv2.minAreaRect` returns a
rotation angle that handles this cleanly.

### Tiny letter classification — defer as a fallback

A LeNet-5-style CNN trained on `H`/`S`/`G`/`P` 28×28 patches would work for
the redundant letter-recognition signal. ~100-500 training samples should
suffice for 4 classes. But shape + fill classification alone should be
sufficient first cut; the CNN is a fallback for ambiguous cases.

### Open external research questions (for the next round)

Areas where my web research didn't find authoritative answers, captured in
the Deep Research prompt at the end of this doc:

- **TPS vs Moving Least Squares vs B-spline** for sparse 2D landmarks — is
  TPS definitively the best, or are there edge cases where another method
  beats it?
- **Hu moments vs `approxPolyDP`** for shape classification under occlusion
  / compression artifacts.
- **Overlapping-marker disambiguation** state-of-the-art (watershed,
  Hungarian matching, iterative removal).
- **Color robustness under H.264/HEVC compression artifacts** — practical
  techniques beyond pure HSV thresholding.
- **EASHL community priors** — does anyone in the Pro Clubs / ChelHead /
  modding community already extract structured data from these screens?
- **Pipeline architecture patterns** for "detect all + match to known list"
  problems.

The full Deep Research prompt is in
[event-map-extraction-deep-research-prompt.md](./event-map-extraction-deep-research-prompt.md)
(parked alongside this doc).

---

## Concrete next-pass plan (when resumed)

In priority order:

1. **Implement TPS calibration** — replace `pixel_to_hockey` with scikit-
   image's `ThinPlateSplineTransform` driven by the existing 12 measured
   landmarks. Add an inverse `hockey_to_pixel` for overlay rendering.
   Validate with the four-step gate:
   - **In-sample landmark RMSE** as a quick sanity check (do not treat as
     accuracy proxy).
   - **Leave-one-landmark-out TRE** (Target Registration Error) for every
     control point. This is the actual quantity-of-interest per the
     SimpleITK registration-error guidance (FRE is NOT a TRE proxy).
   - **Edge / exterior probe TRE** at boundary anchor points (e.g., goal
     creases, end-zone faceoff dots near boards) to catch poor
     extrapolation outside the convex hull of the landmark set.
   - **Warp sanity** — no triangle flips, no foldovers, no extreme
     displacement outside the convex hull. Grid overlay visualisation
     for human review.
   - **Outlier-screen pass** — refit while omitting each landmark once.
     If any omission dramatically reduces TRE, demote that landmark
     (treat as mis-clicked) or reduce model flexibility.

   (~30 lines of production code + ~80 lines of test harness.)
2. **Re-derive match-250 coords under TPS** and diff against current
   single-linear placements. Confirm the 3-5 ft squeeze in offensive zone
   resolves.
3. **Build a full-frame marker detector**: HSV mask → contours → shape
   classifier → fill classifier. Validate against a few captures (manual
   inspection) before integrating.
4. **Auto opp-color resolution** — sample the end-zone-bar pixel at the
   side opposite BGM to learn opp team color per match.
5. **Integrate inventory-consensus matcher** to fill in events that were
   never highlighted in any capture.
6. **End-to-end test**: run the new pipeline against match 250 and compare
   placements to the manually-curated ground truth from the previous
   implementation pass. Per-event drift should be ≤ 1-2 ft.
7. **Defer**: CNN letter classifier, YOLO, deep learning, template matching.

### What stays as-is

- `rink_pixel_box` measurement / `recalibrate_rink.py` workflow
- HSV masking infrastructure
- `detect_selected_row_index` (the white-border detector)
- `detect_bgm_attack_direction` (the bar-color detector)
- Parsed events list per capture
- CVAT pipeline (kept as optional QC / override tool)

### What gets retired or repurposed

- `find_selected_marker` — kept for the highlighted-event identity signal,
  but no longer the only marker we extract.
- Single-anchor linear `pixel_to_hockey` — replaced by TPS.
- Manual override SQL recipes — should become rarer once full-inventory
  detection is in place; keep as a fallback.

---

## Sources

### Internal references

- [docs/ocr/event-map-implementation-report.md](./event-map-implementation-report.md)
- [tools/game_ocr/game_ocr/spatial.py](../../tools/game_ocr/game_ocr/spatial.py)
- [tools/game_ocr/scripts/recalibrate_rink.py](../../tools/game_ocr/scripts/recalibrate_rink.py)
- [tools/game_ocr/game_ocr/configs/rink/post_game_action_tracker.json](../../tools/game_ocr/game_ocr/configs/rink/post_game_action_tracker.json)
- [apps/web/src/components/branding/event-markers.tsx](../../apps/web/src/components/branding/event-markers.tsx)
- [apps/web/src/components/matches/shot-map.tsx](../../apps/web/src/components/matches/shot-map.tsx)

### External (May 2026 web research — Round 1)

- [Thin plate spline (Wikipedia)](https://en.wikipedia.org/wiki/Thin_plate_spline)
- [OpenCV ThinPlateSplineShapeTransformer (3.4 docs)](https://docs.opencv.org/3.4/dc/d18/classcv_1_1ThinPlateSplineShapeTransformer.html)
- [scikit-image PiecewiseAffineTransform example](https://scikit-image.org/docs/stable/auto_examples/transform/plot_piecewise_affine.html)
- [Homography.js — piecewise affine via triangulation](https://github.com/Eric-Canas/Homography.js/)
- [PnLCalib: Sports field registration via points and lines](https://www.sciencedirect.com/science/article/pii/S1077314226000792)
- [Improving Robustness of Homography for Ice Rink Registration](https://uwspace.uwaterloo.ca/items/95a2a33c-f681-4c5d-9982-e217a002e8be)
- [Camera Calibration in Sports with Keypoints (Roboflow)](https://blog.roboflow.com/camera-calibration-sports-computer-vision/)
- [OpenCV Shape Detection (PyImageSearch)](https://pyimagesearch.com/2016/02/08/opencv-shape-detection/)
- [HockeyAI dataset](https://dl.acm.org/doi/10.1145/3712676.3718335)
- [sieve-data/hockey-vision-analytics](https://github.com/sieve-data/hockey-vision-analytics)
- [ccweaver1/bsi_vision](https://github.com/ccweaver1/bsi_vision)
- [UIED — UI element detection](https://github.com/MulongXie/UIED)
- [LeagueAI — Minimap detection via template matching](https://github.com/Oleffa/LeagueAI)
- [TPS-Warp reference implementation](https://github.com/AlanLuSun/TPS-Warp)

---

## Calibration spike findings (May 2026)

Empirical measurement spike with user-measured landmark data committed
at [match250_landmarks.json](../../tools/game_ocr/game_ocr/configs/rink/match250_landmarks.json),
run via [calibration_spike.py](../../tools/game_ocr/scripts/calibration_spike.py).
13 full-2D landmarks + 12 single-axis observations on frame
`vlcsnap-2026-05-10-02h01m59s349.png`.

### Stylization confirmed — and shaped weirder than expected

**X-axis implied px/ft per feature** (centre = pixel 1310, hockey 0):

| feature | hockey x (ft) | implied px/ft |
|---|---|---|
| **blue lines** | **±25** | **5.18 — 5.23** |
| faceoff circle inner edge | ±54 | 4.36 — 4.38 |
| faceoff hashmark inner | ±67 | 4.41 — 4.43 |
| faceoff dots | ±69 | 4.43 |
| faceoff hashmark outer | ±71 | 4.43 — 4.44 |
| faceoff circle outer edge | ±84 | 4.46 |
| goal lines | ±89 | 4.64 — 4.66 |
| boards | ±100 | 4.73 — 4.74 |

**Y-axis implied px/ft per feature** (centre = pixel 608):

| feature | hockey y (ft) | implied px/ft |
|---|---|---|
| ez faceoff L-marks (inner) | ±20 | 4.64 — 4.67 |
| ez faceoff dots | ±22 | 4.35 — 4.42 |
| ez faceoff L-marks (outer) | ±24 | 4.11 — 4.18 |
| boards | ±42.5 | 4.79 — 4.83 |

### Key insight: the stylization is not smooth

The art has **two distinct scaling regimes** on the x-axis:

1. **Blue lines (±25 ft) live in their own coordinate frame** at 5.20 px/ft.
   They're drawn ~17% further apart than NHL-proportional. This is the
   designer's deliberate "make the neutral zone visually wider" choice.
2. **Everything from ±54 to ±100 ft sits on a smooth ramp** from 4.36 to
   4.74 px/ft — a ~9% gradual stretch toward the boards. Continuous, no
   discontinuity.

There's a **discontinuity between the ±25 blue-line zone and the ±54+
faceoff zone** that no single smooth interpolant can absorb without
artefacts.

### TPS in-sample vs linear in-sample

Linear best-fit (least-squares on 13 landmarks): centre (1309, 607),
half_w 461.6 px (4.62 px/ft global x), half_h 198.2 px (4.66 px/ft global y).
**Mean in-sample residual = 9.98 px (2.15 ft).** Worst residuals:
- blue lines: ±14-15 px (linear can't honor the 5.20 px/ft of blue lines AND the 4.4 ramp simultaneously)
- ez faceoff dots: ±13 px on x AND ±5-7 px on y
- boards: ±11-13 px on x

TPS in-sample residual is **exactly 0** at every landmark (by
construction — exact interpolant).

### LOOCV-TRE — the surprising result

|  | linear LOOCV-TRE | TPS LOOCV-TRE |
|---|---|---|
| **mean** | **12.45 px (2.68 ft)** | **13.67 px (2.95 ft)** |
| blue lines | 15-17 px | **19-20 px (worse)** |
| ez faceoff dots | 17 px | **24-25 px (worse)** |
| goal lines | 2-5 px | **0.6-1.1 px (better)** |
| boards (left/right) | 14-17 px | **6-7 px (much better)** |
| boards (top/bottom) | 9-12 px | 13-14 px |

**TPS does NOT uniformly beat linear on out-of-sample prediction.** Mean
LOOCV-TRE is 10% WORSE under TPS. The breakdown:

- TPS wins decisively on **boundary features** (boards, goal lines) —
  exactly the failure mode that motivated the entire calibration effort.
  Event 39 mapping to off-rink hockey-x = -103 would be cleanly fixed:
  TPS LOOCV-TRE on board-left is 6.19 px vs linear's 17.18 px.
- TPS loses on **inner-zone features held out** (faceoff dots, blue
  lines). When you remove one faceoff-dot landmark, TPS extrapolates
  the blue-line scaling (5.20 px/ft) inward into the faceoff zone
  (4.4 px/ft), overshooting by ~24 px.

The cause is the blue-line discontinuity. TPS treats the 4 blue-line
points and the 4 faceoff-dot points as evidence that hockey x ∈
[-69, +69] is wildly non-linear, when in reality the only weird thing
is the blue lines themselves.

### Axis-only observations (TPS sanity check)

When TPS is fitted with all 13 landmarks (NOT leave-one-out), it nails
the hashmark and circle positions with sub-pixel error:

| feature | linear-Δ | TPS-Δ |
|---|---|---|
| hashmark outer | ±13 px | -0.3 / -0.6 px |
| hashmark inner | ±14 px | +0.7 / +0.2 px |
| circle inner edge | ±13 px | +5.3 / -4.8 px |
| circle outer edge | ±13 px | +8.1 / -7.2 px |

So **within the convex hull of landmarks, TPS is excellent.** The
LOOCV pathology is purely about extrapolating ACROSS the blue-line
discontinuity.

### Outlier screen — counterintuitive

When we remove each landmark and re-measure mean LOOCV-TRE on the rest:

- Removing **goal-right** worsens TPS LOOCV-TRE by 4.94 px (goal lines
  are anchoring TPS to the right boundary behavior — they're critical).
- Removing **board-left/right** worsens TPS by 3-3.2 px.
- Removing **faceoff dots** *helps* the linear fit by ~0.6-1.0 px
  (they're the dots that drag the linear fit toward 4.4 px/ft, then
  blue lines pull it back toward 5.2).

No landmark is a "mis-click" — all are structurally consistent with the
rink art. The disagreement is real stylization, not measurement noise.

### Implications for next implementation pass

Linear and TPS both have failure modes. The right answer is probably
one of:

1. **Regularized TPS** (SciPy `RBFInterpolator(smoothing=k)` for some
   k > 0). Trade exact-fit for smoother extrapolation; the blue-line
   bump becomes "approximately fit" instead of "exactly fit with
   overshoot." Empirically tune `k` to minimize mean LOOCV-TRE.
2. **Exclude blue lines from the fit**, handle them as a per-feature
   correction. Treat the rest of the rink as a smooth piecewise fit.
3. **Piecewise affine** via Delaunay triangulation on the 13 landmarks
   — each triangle gets its own affine, no extrapolation issues
   inside the convex hull.
4. **Add neutral-zone landmarks** (NZ faceoff dots at ±20 ft, ±22 ft)
   so TPS has more inner-zone evidence and won't extrapolate the blue
   line bump into the empty space between blue line (±25) and EZ
   faceoff dot (±69).

Overlay artifact: `/tmp/calibration-spike-overlay.png` (regenerable via
`python3 tools/game_ocr/scripts/calibration_spike.py`).

### What this means for events 39, 43, 48

- **Event 39** (BGM shot at pixel (~830, ~545), reported as hockey x =
  -103.4): under TPS this would clamp inside the rink. Confirmed
  benefit. Linear LOOCV-TRE at board-left = 17 px ≈ 3.7 ft → linear
  pushes near-board events out past the boards. TPS LOOCV-TRE = 6 px
  ≈ 1.3 ft → markers stay on-rink.
- **Event 48** (opp goal at pixel ~1680, reported as hockey x = +78):
  near goal-line zone, both models converge — TPS marginally better.
- **Event 43** (opp shot at ~1450, hockey x = +27): right next to the
  blue line, in the discontinuity zone. Both models will have ~3-5 ft
  error here regardless of fit choice.

---

## Round-2 Deep Research findings (May 2026)

Ingested from ChatGPT Deep Research's marker-extraction report. Source
artifact: `deep-research-report_1.md` (citation tokens were rendered as
unusable `îurlî…îturn…î` markers — keys/titles preserved in prose, raw
file not committed).

### Top-level summary

1. **Switch primary TPS library to scikit-image.** OpenCV's TPS has two
   documented Python-binding regressions (long-open `applyTransformation`
   bug; 4.10 wheel that lost `createThinPlateSplineShapeTransformer()`
   for some users). SciPy `RBFInterpolator` is a strong fallback when we
   want smoothing or non-TPS kernels. scikit-image gives a real transform
   object with `inverse` built in.
2. **Validate by TRE, not FRE.** SimpleITK registration-error guidance is
   explicit: Target Registration Error is the quantity of interest;
   Fiducial Registration Error (in-sample fit) should NOT be used as a
   proxy. Practical rubric: in-sample RMSE only as sanity check, then
   LOOCV-TRE per landmark, edge/exterior probes, warp-grid visualisation,
   foldover check.
3. **Outlier-screen via per-landmark omission.** If omitting one landmark
   dramatically reduces TRE, that landmark is likely a mis-click. Demote
   or remove. Cheap and catches the most common landmark-noise failure
   mode.
4. **Overlap → watershed + Hungarian assignment.** Distance-transform-
   driven watershed for splitting merged blobs; `scipy.optimize.linear_
   sum_assignment` for matching candidate sub-instances to expected
   events list. Hybrid: only invoke the overlap branch when single-blob
   detection fails the area/aspect-ratio sanity check.
5. **Color stabilisation upgrade.** Apply gray-world white balance
   (`cv2.xphoto.createGrayworldWB`) before HSV sampling. Sample eroded
   interior rather than edges (JPEG/antialiasing corrupt edges
   disproportionately). Maintain colour prototypes in LAB / LCh space and
   classify by nearest prototype rather than hard HSV thresholds.

### Detailed findings adopted

| Domain | Adopted | Source rationale |
|---|---|---|
| Library swap | `skimage.transform.ThinPlateSplineTransform` primary, `scipy.interpolate.RBFInterpolator` fallback | scikit-image gives transform-object with `inverse`; OpenCV Python bindings unstable. |
| Failure cascade | affine/projective → regularised TPS → piecewise-affine → no-warp | Gated at each stage by LOOCV-TRE threshold + warp-sanity checks. |
| Validation | LOOCV-TRE + edge probe + foldover check | SimpleITK guidance; QGIS georeferencer residual reporting. |
| Outlier screen | Per-landmark omission diff | Standard registration-literature outlier-screen. |
| Overlap handling | Watershed + `linear_sum_assignment` | Hybrid easy-case / ambiguity-case split. |
| Color | Gray-world WB + LAB prototypes + eroded interior sampling | Color-recognition-under-challenging-lighting literature. |

### Detailed findings rejected / unchanged

- **Shape classification** — Deep Research re-derived our existing
  approach (`approxPolyDP` + circularity + `minAreaRect` angle for
  square-vs-diamond). No new signal; our doc already had this.
- **CNN classifier** — confirmed as last-resort fallback, not first
  weapon. ~1k-5k augmented samples needed for a tiny LeNet-style net.
  Defer until rule-based geometry+fill+color proves insufficient.
- **Public prior art** — confirmed no direct comparator; closest analogues
  are League-of-Legends minimap detectors (already in our Round-1 sources).

### Gaps the Deep Research did NOT address

These remain open questions worth a focused next-round query:

1. **Stylized-rink-art is not noise.** Our 12-landmark px/ft table
   (5.20 at blue lines vs 4.42 at faceoff dots vs 4.65 at goal lines vs
   4.73 at boards) shows non-uniform per-feature scaling. Deep Research
   treated all landmarks as equally trustworthy and the disagreement as
   "noisy landmarks." TPS still resolves it (lands every landmark exactly),
   but the methodology for *diagnosing* per-feature scale disagreement
   independently of TPS LOOCV-TRE is not addressed.
2. **Our overlap data shape.** Watershed splits silhouettes; our overlap
   is usually two markers at adjacent but separable pixel positions where
   contour detection succeeds but identity attribution to events is
   ambiguous. Different problem than what the report solves.
3. **ONNX / Node deployment.** Python-only scope; deployment story still
   open.
4. **Empirical TRE budgets for our specific stylized rink.** What's an
   acceptable LOOCV-TRE for our use case? No numeric answer.
5. **Stylized vs orthographic art classification.** No literature on
   recognising when in-game rink art is or is not a faithful 2D
   projection of the real rink, which affects whether TPS even has the
   right form factor for the problem.

### Round-2 caveats

- Deep Research source had mangled citation tokens (`îurlî…îturn…î`);
  raw file not committed to the repo.
- "Public artifacts" table padded with API-based EASHL trackers
  (ChelHead, Chelstats, Proclubs.io). Not relevant comparators —
  ignored.
- Three mentions of the `thin-plate-spline` PyPI package straddle
  recommendation; we treat it as ineligible (Beta + single maintainer).

### Adopted library/package additions to consider

| Package | Version (2026) | Role |
|---|---|---|
| `scikit-image` | 0.26+ | Primary TPS via `ThinPlateSplineTransform`; piecewise-affine fallback via `PiecewiseAffineTransform` |
| `scipy` | 1.17+ | Fallback TPS with smoothing via `RBFInterpolator`; `linear_sum_assignment` for overlap matching |
| `opencv-contrib-python` | 4.13+ | Watershed (`cv2.watershed`), gray-world WB (`cv2.xphoto.createGrayworldWB`); avoid `cv2.createThinPlateSplineShapeTransformer` |
| `SimpleITK` | 2.5+ | NOT adopting — registration-error notebook used as methodology reference only |

---

## Round-3 internal spike findings (2026-05-13)

Empirical follow-up to the Round-2 Deep Research's four prioritized spikes,
run via [calibration_spike_v2.py](../../tools/game_ocr/scripts/calibration_spike_v2.py).
Same 13 landmarks as v1. Full results in
`/tmp/calibration-spike-v2-results.md` (regenerable; not committed).

### Methods evaluated

| Spike | Method | Library |
|---|---|---|
| A | Regularized TPS (smoothing sweep k ∈ {0, 0.1, 0.5, 1, 2, 5, 10, 20, 50, 100}) | `scipy.interpolate.RBFInterpolator(kernel="thin_plate_spline", smoothing=k)` |
| B | Neighbors=k localization (k ∈ {4, 6, 8, 10, 13}) | `RBFInterpolator(neighbors=k)` |
| C | Piecewise-affine (Delaunay) | `skimage.transform.PiecewiseAffineTransform` |
| D | Convex-hull confidence gate | `scipy.spatial.Delaunay.find_simplex` |
| (baselines) | linear, plain TPS (skimage) | — |

### Headline results (LOOCV-TRE on 13 landmarks)

| method | coverage | mean (px) | mean (ft) | boundary (px) | inner (px) |
|---|---:|---:|---:|---:|---:|
| **linear** (current production) | 13/13 | **12.45** | 2.68 | 10.03 | 14.53 |
| plain TPS (skimage) | 13/13 | 13.67 | 2.95 | 6.90 | 19.48 |
| **tps_neighbors_k=6** | 13/13 | **12.72** | 2.74 | **4.52** | 19.74 |
| tps_neighbors_k=4 | 13/13 | 30.42 | 6.56 | 37.22 | 24.59 |
| tps_neighbors_k=8 | 13/13 | 13.91 | 3.00 | 6.98 | 19.84 |
| pwa | **5/13** | 8.02¹ | 1.73¹ | 0.72¹ | 12.88¹ |

¹ PWA coverage is restricted because held-out boundary landmarks fall
outside the remaining-landmarks hull — skimage returns the `(-1, -1)`
out-of-hull sentinel. PWA means are over the predictable 5 landmarks
(`centre, bl-left, bl-right, goal-left, goal-right`) only and are **not
comparable** to the 13-landmark means. On the same 5-landmark shared
subset, PWA = 8.02 px and linear = 8.02 px (tied). Plain TPS = 8.17 px.

**Regularized TPS sweep (Spike A) — null result.** Every nonzero
smoothing value produced strictly worse mean LOOCV-TRE than `smoothing=0`
(plain TPS). The blue-line discontinuity is the underlying issue, and
smoothing the spline doesn't fix it — it just makes the boundary fit
slightly worse while not helping the inner fit. Smoothing degrades
monotonically from 13.67 (k=0) to 14.33 (k=100).

**Neighbors=k sweep (Spike B) — k=6 is the sweet spot.** k=4 catastrophic
(30 px), k=6 best (12.72 mean, 4.52 boundary — better boundary than any
other full-coverage method), k≥8 converges back to plain TPS as the
neighbor limit becomes irrelevant. The mechanism: with 6 nearest
landmarks, each prediction is anchored by local geometry and the
blue-line-vs-faceoff scale disagreement no longer propagates into
inner-zone holdouts as severely.

**PWA (Spike C) — interior-only, but tight where it works.** PWA cannot
extrapolate past the landmark hull, so 8 of 13 LOOCV holdouts return the
out-of-hull sentinel. On the 5 landmarks it can predict, mean TRE is
8.02 px — exactly tied with linear. The 0 foldovers in a 21×11 dense
hockey grid (after fixing the sign-convention bug in the foldover check)
indicates the triangulation is geometrically sound. PWA is **not viable
as a sole production method** but could be a high-accuracy interior
predictor with a non-PWA fallback for out-of-hull positions.

### Spike D — hull statistics

- Hull area in pixel space: **216,335 px²**
- Linear-fit rink box area: **365,937 px²**
- **Hull coverage: 59.1% of the rink-art area.**
- Production rule: **40.9% of the rink is outside the landmark hull** and
  predictions there should emit a `confidence='extrapolated'` flag. The
  uncovered regions are the four corners (where the rink art's
  trapezoidal end-zones are) and the strips behind each goal line.

### Visual sanity — warp grid

Warp-grid renders for both winners:
- `tps_neighbors_k=6`: visible non-linear warp; the green grid lines
  at hockey ±25 land on the rink art's blue lines (slightly wider than
  proportional). No foldovers. Inner grid spacing smoothly transitions
  to the wider boundary spacing.
- linear: perfectly uniform grid; visible misalignment with the rink
  art's blue lines.

Artifacts (regenerable, not committed):
- `/tmp/calibration-spike-v2-overlay.png`,
  `/tmp/calibration-spike-v2-overlay-boundary.png`
- `/tmp/calibration-spike-v2-warp-grid.png`,
  `/tmp/calibration-spike-v2-warp-grid-boundary.png`

### Production recommendation

**Adopt `tps_neighbors_k=6` as the primary calibration method, with the
convex-hull gate applied unconditionally.**

Rationale:
1. **Best boundary fidelity** (4.52 px / 0.97 ft) of any full-coverage
   method. Boundary accuracy is what we actually care about — boards,
   goal lines, and end-zones are where most shot-map-significant events
   occur. Sub-foot boundary accuracy on the LOOCV stress test is a real
   improvement over the current single-anchor linear (10.03 px / 2.16 ft
   boundary).
2. **Full coverage** — predicts every input position, unlike PWA.
3. **Robust to the blue-line discontinuity** that plain TPS over-fits.
   Limiting each prediction to 6 nearest landmarks blocks the
   inner-zone extrapolation pathology empirically.
4. **Library trade-off accepted**: requires `scipy.interpolate.RBFInterpolator`
   instead of scikit-image's `ThinPlateSplineTransform`, because skimage
   doesn't expose a neighbor-limit parameter. Round-2 marked SciPy's
   RBF as a "fallback"; here we elevate it to primary because the
   neighbor-limit feature is decisive.

Production sketch:

```python
import numpy as np
from scipy.interpolate import RBFInterpolator
from scipy.spatial import Delaunay

# Build the calibration once at startup from the 13 landmark pairs.
LANDMARK_PX_HOCKEY = [
    ((1310, 608),   (0.0,   0.0)),    # centre
    ((1180, 608),   (-25.0, 0.0)),    # bl-left
    ((1440, 608),   (25.0,  0.0)),    # bl-right
    # … 10 more …
]
pixel_pts  = np.array([p for p, _ in LANDMARK_PX_HOCKEY], dtype=np.float64)
hockey_pts = np.array([h for _, h in LANDMARK_PX_HOCKEY], dtype=np.float64)

# Forward: pixel → hockey, one RBF per output axis.
rbf_x = RBFInterpolator(pixel_pts, hockey_pts[:, 0],
                        kernel="thin_plate_spline", neighbors=6)
rbf_y = RBFInterpolator(pixel_pts, hockey_pts[:, 1],
                        kernel="thin_plate_spline", neighbors=6)

# Hull gate — Delaunay over the landmark pixel positions.
hull = Delaunay(pixel_pts)

def pixel_to_hockey(px: float, py: float) -> tuple[float, float, str]:
    query = np.array([[px, py]], dtype=np.float64)
    hx = float(rbf_x(query)[0])
    hy = float(rbf_y(query)[0])
    confidence = "interpolated" if hull.find_simplex(query)[0] >= 0 else "extrapolated"
    return hx, hy, confidence
```

`RinkCoordinate` gets a new `confidence: Literal['interpolated', 'extrapolated']`
field. Web rendering should treat extrapolated markers as low-confidence
(e.g., dotted outline) — these are the ~41% of events whose pixel
positions fall outside the landmark hull and have unbounded TRE.

### Next-pass priorities (calibration track)

1. **Ship `tps_neighbors_k=6` + hull gate** as production `pixel_to_hockey`.
   Replace the single-anchor linear in `spatial.py`.
2. **Add 4 more landmarks** to expand the hull. The current 59% coverage
   is the binding constraint on production accuracy. Candidate
   additions:
   - Top and bottom of each goalie crease (4 points, near the goal
     lines)
   - The 4 corners of the end-zone trapezoids
   - Either set would lift hull coverage substantially.
3. **Re-run the spike with the expanded landmark set**; expect both
   mean LOOCV-TRE and hull coverage to improve materially. If hull
   coverage reaches ~85%+, the `extrapolated` flag becomes a rare-edge
   signal instead of "40% of events."
4. **Regression-test against match-250 ground truth in the DB**: re-derive
   coords for the 8 known events (39, 43, 48, etc.) under the new
   pipeline and verify the 3-5 ft squeeze in offensive zones resolves.

### Spikes that did NOT find improvements

For completeness — Round-3 closed two of the four open lines:

- **Spike A (regularized TPS)**: closed as a null result. No smoothing
  value beats plain TPS on this data. The blue-line discontinuity is the
  underlying issue and smoothing doesn't address it.
- **Spike C (PWA)**: closed as not-primary-viable. Could be a niche
  high-accuracy interior predictor, but the hull-coverage cost makes it
  inferior to a hull-gated `neighbors=k` approach.

Spikes B (`neighbors=k`) and D (hull gate) both produce real recommendations.

---

## Picking this back up

When you resume:

1. Re-read this doc top-to-bottom.
2. If the Round-3 spike findings (above) haven't been shipped yet, start
   at "Production recommendation": replace `spatial.py:pixel_to_hockey`
   with the `tps_neighbors_k=6 + hull gate` implementation.
3. Otherwise, work on the "Next-pass priorities" list — adding landmarks
   is the highest-leverage next step.
4. Match-250 ground truth from the previous implementation pass is in the
   DB — use it for regression-testing the new pipeline.
