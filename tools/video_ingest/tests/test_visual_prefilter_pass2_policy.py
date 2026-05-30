"""Tests for `visual_prefilter.pass2_policy.select_frames`.

Phase 2 selection: two rules — dHash dedup against already-picked frames,
then uniform downsample to frame_budget. Centroid-cosine gating is
deferred.
"""

from __future__ import annotations

import unittest

import numpy as np

from video_ingest.visual_prefilter.pass2_policy import (
    dhash,
    hamming_distance,
    select_frames,
)
from video_ingest.visual_prefilter.signals import VisualSignals


def _signals_with_thumbnail(thumbnail: np.ndarray) -> VisualSignals:
    """Build a minimal VisualSignals carrying only a dhash_thumbnail; other
    fields are unused by select_frames."""
    return VisualSignals(
        hsv_histogram=np.zeros(48, dtype=np.float64),
        brightness=0.0,
        log_blur=0.0,
        edge_density=0.0,
        dhash_thumbnail=thumbnail,
    )


def _gradient_thumbnail(seed: int = 0) -> np.ndarray:
    """Deterministic distinct 9x8 grayscale thumbnail."""
    rng = np.random.default_rng(seed)
    return rng.integers(0, 256, size=(8, 9), dtype=np.uint8)


class TestDHash(unittest.TestCase):
    def test_rejects_wrong_shape(self) -> None:
        with self.assertRaises(ValueError):
            dhash(np.zeros((8, 8), dtype=np.uint8))
        with self.assertRaises(ValueError):
            dhash(np.zeros((9, 9), dtype=np.uint8))

    def test_solid_image_hash_is_zero(self) -> None:
        # All equal → no left > right comparison is true → all bits zero.
        thumb = np.full((8, 9), 128, dtype=np.uint8)
        self.assertEqual(dhash(thumb), 0)

    def test_left_brighter_sets_msb_per_row(self) -> None:
        # Column 0 = 255, columns 1..8 = 0. Each row's first comparison
        # (col 0 > col 1) is True; the other 7 are False (0 > 0 is False).
        thumb = np.zeros((8, 9), dtype=np.uint8)
        thumb[:, 0] = 255
        h = dhash(thumb)
        # MSB of each row's 8-bit group is set. Bit positions per row:
        # row 0 → bit 63, row 1 → bit 55, …, row 7 → bit 7.
        expected = sum(1 << (63 - 8 * r) for r in range(8))
        self.assertEqual(h, expected)

    def test_distinct_thumbnails_yield_distinct_hashes(self) -> None:
        a = dhash(_gradient_thumbnail(seed=1))
        b = dhash(_gradient_thumbnail(seed=2))
        self.assertNotEqual(a, b)


class TestHammingDistance(unittest.TestCase):
    def test_identical_is_zero(self) -> None:
        self.assertEqual(hamming_distance(0xDEADBEEF, 0xDEADBEEF), 0)

    def test_single_bit_diff_is_one(self) -> None:
        self.assertEqual(hamming_distance(0, 1), 1)

    def test_all_bits_diff_is_64(self) -> None:
        self.assertEqual(hamming_distance(0, (1 << 64) - 1), 64)


class TestSelectFramesEmpty(unittest.TestCase):
    def test_empty_signals_returns_empty(self) -> None:
        self.assertEqual(select_frames([], frame_budget=5), [])


class TestSelectFramesDedup(unittest.TestCase):
    def test_identical_frames_collapse_to_one(self) -> None:
        thumb = _gradient_thumbnail(seed=42)
        signals = [_signals_with_thumbnail(thumb) for _ in range(5)]
        # All hashes identical → all later frames within distance 0 of frame 0.
        picked = select_frames(signals, frame_budget=10, dhash_max_distance=1)
        self.assertEqual(picked, [0])

    def test_distinct_frames_all_kept_within_budget(self) -> None:
        signals = [_signals_with_thumbnail(_gradient_thumbnail(seed=i)) for i in range(4)]
        picked = select_frames(signals, frame_budget=10, dhash_max_distance=8)
        self.assertEqual(picked, [0, 1, 2, 3])

    def test_distance_threshold_is_strict_less_than(self) -> None:
        # Construct two thumbnails differing by exactly N bits and verify
        # dhash_max_distance=N keeps both (< is strict).
        thumb_a = np.full((8, 9), 128, dtype=np.uint8)
        thumb_b = thumb_a.copy()
        # Flip enough pixels to change ~3 bits. Setting columns 0..3 of row 0
        # to 255 makes the first 3 horizontal comparisons True for that row.
        thumb_b[0, :4] = 255
        thumb_b[0, 4:] = 0
        # Comparisons in row 0: 255>255 F, 255>255 F, 255>255 F, 255>0 T,
        # 0>0 F, 0>0 F, 0>0 F, 0>0 F → 1 bit changes vs all-zero.
        ha = dhash(_signals_with_thumbnail(thumb_a).dhash_thumbnail)
        hb = dhash(_signals_with_thumbnail(thumb_b).dhash_thumbnail)
        dist = hamming_distance(ha, hb)
        self.assertGreater(dist, 0)
        signals = [_signals_with_thumbnail(thumb_a), _signals_with_thumbnail(thumb_b)]
        # threshold = dist → distance < threshold is False → frame 1 kept.
        picked = select_frames(signals, frame_budget=10, dhash_max_distance=dist)
        self.assertEqual(picked, [0, 1])
        # threshold = dist + 1 → distance < threshold is True → frame 1 dropped.
        picked = select_frames(signals, frame_budget=10, dhash_max_distance=dist + 1)
        self.assertEqual(picked, [0])


class TestSelectFramesBudget(unittest.TestCase):
    def test_zero_budget_means_no_cap(self) -> None:
        signals = [_signals_with_thumbnail(_gradient_thumbnail(seed=i)) for i in range(20)]
        picked = select_frames(signals, frame_budget=0, dhash_max_distance=4)
        # All distinct → all survive dedup → with no cap, all are kept.
        self.assertEqual(picked, list(range(20)))

    def test_budget_downsample_uniform(self) -> None:
        signals = [_signals_with_thumbnail(_gradient_thumbnail(seed=i)) for i in range(10)]
        picked = select_frames(signals, frame_budget=3, dhash_max_distance=4)
        self.assertEqual(len(picked), 3)
        # Uniform: should include endpoints (0 and 9) when downsampling 10 → 3.
        self.assertEqual(picked[0], 0)
        self.assertEqual(picked[-1], 9)

    def test_budget_one_picks_first_unique(self) -> None:
        signals = [_signals_with_thumbnail(_gradient_thumbnail(seed=i)) for i in range(5)]
        picked = select_frames(signals, frame_budget=1, dhash_max_distance=4)
        self.assertEqual(picked, [0])


class TestSelectFramesOrderPreserved(unittest.TestCase):
    def test_returned_indices_are_ascending(self) -> None:
        signals = [_signals_with_thumbnail(_gradient_thumbnail(seed=i)) for i in range(8)]
        picked = select_frames(signals, frame_budget=4, dhash_max_distance=4)
        self.assertEqual(picked, sorted(picked))


if __name__ == "__main__":
    unittest.main()
