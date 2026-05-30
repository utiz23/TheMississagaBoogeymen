"""Pass-2 frame-selection policy for visual prefiltering.

Phase 2 (this module): two heuristic rules — dHash dedup against
already-picked frames, then uniform downsample to a per-screen frame
budget. Centroid-cosine gating to the segment's screen-type centroid is
intentionally deferred: classifier-YAML centroids live in the legacy
12·4·4 (192-dim) HSV layout while `VisualSignals.hsv_histogram` is the
v2 8·3·2 (48-dim) layout, and reconciling that is its own slice. The
two shipped rules already cut redundant OCR within a segment without
that work.

The function is pure — no I/O, no provider iteration. Callers
(`FilteredFrameProvider`, eventual `pass2_extract` integration) compute
`VisualSignals` per frame and hand them to `select_frames`.
"""

from __future__ import annotations

import numpy as np

from video_ingest.visual_prefilter.signals import VisualSignals


def dhash(thumbnail: np.ndarray) -> int:
    """Compute a 64-bit perceptual hash from a 9×8 grayscale thumbnail.

    Standard dHash: for each row, compare adjacent pixels left-to-right;
    bit i,j = 1 iff pixel[i, j] > pixel[i, j+1]. 8 rows × 8 comparisons
    = 64 bits packed MSB-first.
    """
    h, w = thumbnail.shape[:2]
    if h != 8 or w != 9:
        raise ValueError(f"dhash expects a 9x8 grayscale thumbnail, got {thumbnail.shape}")
    # Vectorized: 8x9 → 8x8 boolean comparison, flatten, pack to int.
    diff = thumbnail[:, :-1] > thumbnail[:, 1:]
    bits = diff.astype(np.uint64).reshape(-1)
    value = np.uint64(0)
    for i, b in enumerate(bits):
        if b:
            value |= np.uint64(1) << np.uint64(63 - i)
    return int(value)


def hamming_distance(a: int, b: int) -> int:
    """Popcount of XOR — number of differing bits between two 64-bit hashes."""
    return int(bin(a ^ b).count("1"))


def select_frames(
    signals: list[VisualSignals],
    *,
    frame_budget: int,
    dhash_max_distance: int = 8,
) -> list[int]:
    """Select indices of frames to OCR from a dense segment's signal sequence.

    Phase 2 rules, applied in order:

      1. Walk frames in their natural order. Skip a frame if its dHash is
         within `dhash_max_distance` Hamming bits of any already-picked
         frame's dHash (near-duplicate dedup).
      2. After dedup, if the survivor count exceeds `frame_budget`, uniformly
         downsample to exactly `frame_budget` indices (preserves coverage
         across the segment).

    `frame_budget <= 0` is treated as "no budget cap"; only dedup applies.
    Empty input returns an empty list.
    """
    if not signals:
        return []

    selected: list[int] = []
    selected_hashes: list[int] = []
    for i, s in enumerate(signals):
        h = dhash(s.dhash_thumbnail)
        if any(hamming_distance(h, prev) < dhash_max_distance for prev in selected_hashes):
            continue
        selected.append(i)
        selected_hashes.append(h)

    if frame_budget > 0 and len(selected) > frame_budget:
        # Uniform downsample: pick frame_budget indices spread across `selected`.
        idxs = np.linspace(0, len(selected) - 1, num=frame_budget, dtype=int)
        selected = [selected[i] for i in idxs]

    return selected
