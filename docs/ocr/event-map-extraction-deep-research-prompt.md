# Deep Research Prompt — Event-Map Marker Extraction (Round 2)

This is the verbatim prompt to paste into ChatGPT Deep Research (or
equivalent) when picking up the marker-extraction redesign.

**Status:** Round 1 (May 2026) is captured in
[marker-extraction-research.md](./marker-extraction-research.md) under
"External (May 2026 web research — Round 1)" and "Round-2 Deep Research
findings (May 2026)." An **empirical calibration spike** was then run
with user-measured landmarks
([match250_landmarks.json](../../tools/game_ocr/game_ocr/configs/rink/match250_landmarks.json),
[calibration_spike.py](../../tools/game_ocr/scripts/calibration_spike.py));
its findings are also in the dossier under "Calibration spike findings
(May 2026)."

This round is the deeper, citation-heavy follow-up that builds on **both**
the Round-1 findings AND the spike data. The prompt is self-contained —
Deep Research won't see our conversation history.

Sister doc: the event-list Round-2 prompt
([event-list-extraction-deep-research-prompt.md](./event-list-extraction-deep-research-prompt.md)).

---

```
# Deep Research Request: Stylized 2D Sports-UI Marker Extraction (Round 2)

## Background (context, do not re-research)

I'm building a computer-vision pipeline that extracts hockey-event markers
from post-game screenshots of EA NHL's Action Tracker screen — a fixed
1920×1080 UI showing a flat, stylized 2D rink illustration with small icons
plotted at each event's on-ice position. Each marker encodes event type via
SHAPE (hit = box, shot = circle, penalty = diamond, goal = hexagon), team
side via FILL STYLE (home = solid team color, away = white interior with
colored ring), and selection via a YELLOW glow overlay on one marker per
frame.

The pipeline needs to extract markers from the screenshot and map their
pixel positions to NHL-standard hockey-rink coordinates (x ∈ [-100, +100]
ft, y ∈ [-42.5, +42.5] ft). The rink art is STYLIZED — designer-chosen
non-uniform scaling, not a faithful orthographic projection of an NHL rink.

## What Round 1 ALREADY established (do not re-research)

### Library choice for non-rigid warping
- **scikit-image's `ThinPlateSplineTransform`** is the cleanest Python TPS
  API in 2026 (transform-object with built-in inverse). SciPy's
  `RBFInterpolator(kernel="thin_plate_spline")` is the recommended fallback
  when smoothing/regularization is needed. OpenCV's TPS Python binding has
  documented regressions (`applyTransformation` bug, missing factory in
  the 4.10 wheel) — AVOID.

### Validation methodology
- **TRE (Target Registration Error) is the quantity of interest, NOT FRE
  (Fiducial Registration Error / in-sample fit).** Validation should use
  leave-one-landmark-out TRE, edge/exterior probes, warp-grid sanity
  checks, and foldover detection.
- Outlier screen via per-landmark omission: refit without each landmark;
  if its omission dramatically reduces TRE, it's likely a mis-click.

### Shape classification
- `cv2.approxPolyDP` + circularity + `minAreaRect` angle for the 4-class
  problem (box / circle / hexagon / diamond). Hu moments and Zernike
  moments are useful backup descriptors but not first-line.
- Tiny CNN is a last-resort fallback, not the starting point.

### Overlap handling
- Hybrid: connected-component classification for easy cases, watershed +
  `scipy.optimize.linear_sum_assignment` for merged blobs. The Hungarian
  assignment matches candidate sub-instances to expected events.

### Color stabilisation
- Gray-world white balance (`cv2.xphoto.createGrayworldWB`) before HSV
  sampling. Sample eroded interior (NOT edges — JPEG / antialiasing
  corrupt edges). Maintain colour prototypes in LAB/LCh space, classify
  by nearest prototype.

## What the calibration spike ALREADY revealed (do not re-research)

A measurement spike with 13 user-measured full-2D landmarks + 12 single-
axis observations on a representative capture frame showed:

### Stylization shape
The rink art has **TWO distinct x-axis scaling regimes**:
1. **Blue lines (±25 ft) sit in their own coordinate frame** at 5.20 px/ft
   — drawn ~17% further apart than NHL-proportional. Designer's deliberate
   "wider neutral zone" choice.
2. **Everything from ±54 to ±100 ft on a smooth ramp** from 4.36 to
   4.74 px/ft. ~9% gradual stretch toward boards.
3. There's a **discontinuity** between the ±25 (blue) zone and the ±54+
   (faceoff/board) zone that no single smooth interpolant can absorb
   without artefacts.

### LOOCV-TRE result — surprising
On 13 landmarks: **mean linear LOOCV-TRE = 12.45 px (2.68 ft); mean TPS
LOOCV-TRE = 13.67 px (2.95 ft) — TPS is 10% WORSE on average**, despite
fitting perfectly in-sample.

Breakdown:
- **TPS wins decisively on boundary features**: boards (LOOCV-TRE 6 vs 17
  px), goal lines (1 vs 5 px). This is the entire reason TPS was
  proposed — the original "event 39 maps to off-rink x = -103" failure
  mode.
- **TPS loses on inner-zone features held out**: blue lines (LOOCV-TRE
  19-20 vs 15-17 px), ez faceoff dots (24-25 vs 17 px). When TPS doesn't
  have the held-out faceoff-dot landmark, it extrapolates the blue-line
  scaling (5.20 px/ft) into the faceoff zone (4.4 px/ft), overshooting
  by ~24 px.

### Within-convex-hull, TPS is excellent
Sub-pixel error on hashmark predictions (linear: ±13 px; TPS: -0.3 to +0.7
px). The LOOCV pathology is specifically about extrapolating ACROSS the
blue-line discontinuity.

### Outlier screen
No landmark is a mis-click. Removing goal-right worsens TPS LOOCV-TRE by
+4.94 px (goal lines anchor TPS at the boundary). Removing faceoff dots
actually *helps* linear by ~0.7 px (they were pulling linear away from
the blue-line zone). The disagreement is real stylization, not noise.

## What I need YOU to research (Round-2 gaps)

Don't repeat Round-1 or spike findings. Focus on calibration-method
operational depth, deployment patterns, and questions Round 1 left open.

### A. Calibration models for stylized art with localized discontinuities

1. **Regularized TPS as a smoothness-vs-accuracy tradeoff.** SciPy
   `RBFInterpolator` accepts a `smoothing` parameter that interpolates
   from exact-fit (smoothing=0) to a polynomial least-squares fit
   (smoothing → ∞). For a stylized rink where ONE landmark cluster
   (blue lines) sits at a fundamentally different scale than the rest,
   what's the principled way to choose the smoothing parameter?
   Cross-validation? L-curve? GCV (Generalized Cross-Validation)?
   Concrete papers + code.

2. **Alternative RBF kernels for our problem.** Thin-plate spline is the
   default but it has global support (every landmark influences every
   point). Locally-supported kernels (Wendland, compactly-supported
   RBFs, Gaussian with tight bandwidth) might prevent the blue-line bump
   from polluting the faceoff zone. What's the literature say about
   kernel choice when:
   - landmarks are sparse (~10-15)
   - the underlying deformation has localized features
   - we want bounded extrapolation behavior
   Cite specific Python implementations (scipy.interpolate, scikit-learn
   GaussianProcessRegressor with custom kernel, others).

3. **Piecewise affine via Delaunay triangulation vs TPS in this regime.**
   `skimage.transform.PiecewiseAffineTransform` lands each landmark
   exactly and uses linear interpolation within each triangle. This
   should completely sidestep the blue-line-discontinuity extrapolation
   problem (each triangle has its own affine). But:
   - Is leave-one-out cross-validation even well-defined when removing
     a landmark restructures the triangulation?
   - How does PWA behave on points OUTSIDE the convex hull of landmarks?
   - With only 13 landmarks, the triangulation will be coarse — does
     that introduce visible kinks in event positioning?
   Concrete comparison vs TPS for our 13-landmark spike data shape.

4. **Hybrid: per-feature anchoring + smooth interpolation elsewhere.**
   For sports overlays, what's the literature on "use feature X for
   events near feature X, smooth fit elsewhere"? Practical examples
   from sports broadcasting, GIS, medical imaging. Specifically: if
   blue lines are at 5.20 px/ft and the rest is on a smooth ramp,
   maybe the right model is "snap events within 5 ft of the blue line
   to a blue-line-anchored projection, then smooth fit elsewhere."

5. **Empirical TRE budgets.** What LOOCV-TRE is "good enough" for sports
   event-position visualisation in published systems? My current
   linear has 2.68 ft mean TRE. Is sub-2-ft achievable on a stylized
   rink? Is 1 ft? What's the literature say about acceptable error
   budgets for similar applications?

### B. Stylization detection and classification

6. **Is there a name for what we're seeing?** The in-game rink isn't a
   linear projection, isn't a perspective projection, isn't a fisheye —
   it's a designer-perturbed 2D illustration where specific features
   are dilated for visual clarity. Does the graphics / GIS / sports
   broadcast literature have a name for this kind of "anchored
   stylization" or "feature-emphasized distortion"? Existing techniques
   for detecting it from sparse landmark observations?

7. **Stylization stability over time.** Does the literature address
   "how do you know when an in-game UI's rink art changed?" This
   becomes a problem when EA pushes a UI update. Is there an automated
   way to detect stylization drift from observed marker positions
   without re-measuring landmarks?

### C. Marker detection & overlap (deeper)

8. **Our overlap is positional, not silhouette-merged.** Round 1
   recommended watershed for splitting merged blobs. But in our data,
   "overlap" usually means two distinct markers at adjacent pixel
   positions where contour detection succeeds (returns two contours)
   but matching contours to specific events is ambiguous. Different
   problem than watershed solves. What's the literature on multi-object
   tracking-style identity resolution applied to static screenshots?
   Specifically: when we know event types/sides/expected positions from
   a parallel data stream (the events list), how do we ASSIGN detected
   markers to events when multiple candidates exist nearby?

9. **Yellow-glow contamination.** The selected marker has a yellow halo
   that visually merges with adjacent markers' outlines. Practical
   techniques for "deselecting" the glow in image space — yellow-channel
   subtraction? Morphological operations? Multi-frame consensus where
   one frame has the marker selected and another doesn't?

### D. Production deployment (Python ↔ Node ergonomics)

10. **ONNX export and Node-side inference for a tiny shape/fill
    classifier.** Our worker is Node.js; the CV pipeline is Python.
    Round 1 mentioned ONNX Runtime Node binding as the cleanest path.
    Concrete 2026 benchmark: ONNX Runtime Node bindings vs PyODBC-style
    subprocess vs a tiny Python FastAPI sidecar. Latency, memory,
    deployment ergonomics for a single-host Docker setup.

11. **OpenCV-in-Node landscape (2026).** Are there mature OpenCV
    bindings for Node.js that can host the marker detection without
    a Python sidecar? `opencv4nodejs` was the option historically;
    what's the state in 2026? Any newer alternatives (opencv-wasm,
    onnx-mediapipe)?

### E. Validation & monitoring

12. **Per-event regression-test architecture.** Match 250 has 72
    manually-placed non-faceoff events as ground truth. How do
    practitioners structure CV-pipeline regression tests where the
    output is a list of `(event_id, pixel_x, pixel_y, hockey_x,
    hockey_y, event_type)` tuples and you want to catch
    BOTH false-positives (markers detected that don't correspond to
    real events) AND positional drift?

13. **Drift detection in production.** EA pushes UI updates. How do
    practitioners auto-detect that the pipeline's calibration has gone
    stale (e.g., the rink art moved 5 px or got slightly recoloured)?
    Champion-challenger setup? Confidence-distribution shift? Specific
    monitoring tools (Weights & Biases, MLflow, custom dashboards).

### F. Specifically open questions

14. **What is the minimum landmark set for stable TPS LOOCV-TRE?**
    With 13 landmarks we see 2.95 ft mean LOOCV-TRE. With 20?
    With 30? Is there a paper that establishes a curve of "TRE vs
    landmark count" for sparse 2D registration?

15. **In-paint extrapolation outside the convex hull.** A marker at
    pixel (820, 600) is outside the convex hull of our 13 landmarks
    (board-left is at pixel 835). All warp methods extrapolate poorly
    here. What's the safe pattern — clamp at convex hull boundary?
    Mark as "extrapolated, low confidence"? Drop entirely?

## Output format requirements

Return findings as a markdown section titled "Round-2 Deep Research
findings (marker-extraction)" intended for appending to an existing
dossier. Use:

# Round-2 Deep Research Findings (Marker Extraction)

## Top-level summary (≤200 words)

Opinionated: 3-5 most actionable additions beyond Round 1 + the spike.

## Detailed findings

Organize by sections A-F. For each question:

### Question #N: <one-line restatement>

**Finding:** <2-4 sentences>

**Evidence:** <bulleted citations, markdown links with 1-line captions>

**Confidence:** high | medium | low — and why (1 sentence)

**Applicability to our problem:** high | medium | low — and why (1 sentence)

**Code/library pointers:** <specific package versions, function names,
gotchas, code if directly answering the question> or "N/A" if non-software.

## Comparison tables

Where 2+ approaches compete (regularized TPS vs PWA vs hybrid; ONNX-Node
vs subprocess vs sidecar; etc.).

## Concrete code snippets

≤30 lines, Python 3.11+, well-maintained libraries (scipy, scikit-image,
opencv-contrib-python, scikit-learn, numpy, onnxruntime). Each runnable
as-is. Use # NOTE comments for quirky behaviour.

## Open questions surfaced during research

Bullet list of NEW gaps for a hypothetical Round 3.

## Constraints

- DO NOT repeat Round-1 or spike findings (frame them as established
  context only when needed).
- Cite 2024-2026 sources strongly preferred; older OK for foundational
  techniques.
- Note library maintainership status in 2026 (active, in maintenance,
  abandoned).
- Don't propose deep-learning solutions unless the question invites it;
  classical CV/algorithms preferred.
- Mark anything unverifiable with "(unverified)" rather than asserting.
- If literature is genuinely silent, say so explicitly and recommend an
  empirical follow-up spike rather than fabricating answers.
```
