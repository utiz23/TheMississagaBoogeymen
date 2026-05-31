"""Visual Prefilter Phase 3 integration tests for pass2_extract.

Stubs `_ffmpeg_extract` to write real (tiny) BGR PNGs so the prefilter's
signal computation has valid input — `cv2.imread`-able files. Stubs the
typed-v1 extractors to avoid pulling in RapidOCR.

Covers:
  - prefilter is None → no wrapping, no sidecar, telemetry fields None,
    pass2_manifest entries omit prefilter values
  - prefilter enabled but the segment's screen_type has no budget → same
    as disabled for that segment
  - legacy (non-typed-v1) screen with prefilter enabled → `selected_frames.json`
    is written into seg_dir with the correct subset of PNG basenames; the
    manifest carries per-segment telemetry; frame_count reflects the selected
    count
  - typed-v1 screen with prefilter enabled (artifact_mode=True so the
    PngFrameProvider path is taken without PyAV/video) → no sidecar; the
    typed-v1 extractor's frame_provider yields only the selected subset;
    manifest carries telemetry
"""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

import cv2
import numpy as np

import video_ingest.pass2_extract as pass2_module
from game_ocr.extractor import SELECTED_FRAMES_SIDECAR_NAME
from video_ingest.pass1_classify import Segment
from video_ingest.pass2_extract import (
    Pass2Config,
    VisualPrefilterPass2Config,
    extract_segments,
    load_pass2_manifest,
    PASS2_MANIFEST_FILENAME,
)


# ---------------------------------------------------------------------------
# Fixture helpers
# ---------------------------------------------------------------------------


def _distinct_png(index: int) -> np.ndarray:
    """Build an 8x9 BGR image whose dHash is distinct from other indices.

    Each row's "is the left pixel brighter than its right neighbour?" pattern
    depends on `index`, so distinct indices produce distinct 64-bit hashes
    and the prefilter's dHash dedup won't collapse them.
    """
    img = np.zeros((8, 9, 3), dtype=np.uint8)
    for row in range(8):
        for col in range(9):
            # Stripe pattern keyed off (index, row, col) so the
            # left-vs-right inequality flips across columns and rows.
            val = ((index * 7 + row * 3 + col) * 31) % 256
            img[row, col] = (val, val, val)
    return img


def _duplicate_png(*, base_index: int) -> np.ndarray:
    """Image whose dHash matches `_distinct_png(base_index)` exactly so the
    dedup rule (Hamming < threshold) collapses them."""
    return _distinct_png(base_index)


def _make_fake_ffmpeg(*, n_frames: int, duplicate_indices: set[int] | None = None):
    """Stub for `_ffmpeg_extract` that writes `n_frames` real BGR PNGs into
    `out_dir` named `00001.png` ... `0000N.png`. Indices in
    `duplicate_indices` produce the same content as frame 1 so the dedup
    rule has something to collapse."""
    duplicate_indices = duplicate_indices or set()

    def _fake(video_path, out_dir, start_seconds, end_seconds, fps):
        out_dir.mkdir(parents=True, exist_ok=True)
        for i in range(1, n_frames + 1):
            if i in duplicate_indices:
                img = _duplicate_png(base_index=1)
            else:
                img = _distinct_png(i)
            cv2.imwrite(str(out_dir / f"{i:05d}.png"), img)
        return n_frames

    return _fake


def _make_segment(screen_type: str) -> Segment:
    return Segment(
        start_index=0,
        end_index=4,
        start_seconds=5.0,
        end_seconds=10.0,
        screen_type=screen_type,
        frame_count=5,
        mean_color_score=0.85,
    )


class _PassthroughExtractor:
    """Stub typed-v1 extractor that materialises the provider, returns the
    observed count, and records the FrameRecord list it saw for assertions.

    Lives at module level so tests can install it on
    `pass2_module.extract_loadout_evidence` / `extract_lobby_evidence`.
    """

    def __init__(self) -> None:
        self.last_records = None  # type: ignore[var-annotated]

    def __call__(self, *, frame_provider, segment_index):
        from game_ocr.loadout_evidence import FieldEvidenceRecord  # for typing only

        records = list(frame_provider.iter_frames())
        self.last_records = records
        return [], len(records)


def _patch_ffmpeg(fake):
    orig = pass2_module._ffmpeg_extract
    pass2_module._ffmpeg_extract = fake
    return orig


def _unpatch_ffmpeg(orig):
    pass2_module._ffmpeg_extract = orig


# ---------------------------------------------------------------------------
# 1. Disabled prefilter — no behaviour change
# ---------------------------------------------------------------------------


class TestPrefilterDisabled(unittest.TestCase):
    """When `prefilter=None` (or `enabled=False`), no sidecar appears and
    `Pass2Result` telemetry fields stay None — byte-for-byte parity with
    pre-Phase-3 runs."""

    def setUp(self) -> None:
        self._orig = _patch_ffmpeg(_make_fake_ffmpeg(n_frames=4))

    def tearDown(self) -> None:
        _unpatch_ffmpeg(self._orig)

    def _run(self, prefilter):
        with tempfile.TemporaryDirectory() as tmp:
            pass2_root = Path(tmp) / "pass2"
            cfg = Pass2Config(
                window_padding_seconds=0.0,
                sample_rates={"post_game_box_score_goals": 1.0},
                extract_screens={"post_game_box_score_goals"},
                artifact_mode=True,  # PngFrameProvider path
            )
            results = extract_segments(
                video_path=Path("/fake/video.mkv"),
                segments=[_make_segment("post_game_box_score_goals")],
                config=cfg,
                pass2_root=pass2_root,
                video_duration_seconds=30.0,
                version="nhl26",
                segments_hash="sha256:test",
                prefilter=prefilter,
            )
            seg_dir = results[0].directory
            sidecar_exists = (seg_dir / SELECTED_FRAMES_SIDECAR_NAME).exists()
            return results, sidecar_exists

    def test_prefilter_none_no_sidecar(self) -> None:
        results, sidecar_exists = self._run(prefilter=None)
        self.assertFalse(sidecar_exists)
        self.assertIsNone(results[0].prefilter_frames_scanned)
        self.assertIsNone(results[0].prefilter_frames_selected)
        self.assertIsNone(results[0].prefilter_selection_ms)
        self.assertEqual(results[0].frame_count, 4)

    def test_prefilter_disabled_no_sidecar(self) -> None:
        results, sidecar_exists = self._run(
            prefilter=VisualPrefilterPass2Config(
                enabled=False,
                frame_budget={"post_game_box_score_goals": 1},
            )
        )
        self.assertFalse(sidecar_exists)
        self.assertIsNone(results[0].prefilter_frames_scanned)
        self.assertEqual(results[0].frame_count, 4)

    def test_prefilter_enabled_but_no_budget_for_screen(self) -> None:
        """Enabled flag but `frame_budget` lacks this screen → segment is
        not subject to selection (silent passthrough)."""
        results, sidecar_exists = self._run(
            prefilter=VisualPrefilterPass2Config(
                enabled=True,
                frame_budget={"post_game_action_tracker": 5},  # different screen
            )
        )
        self.assertFalse(sidecar_exists)
        self.assertIsNone(results[0].prefilter_frames_scanned)
        self.assertEqual(results[0].frame_count, 4)


# ---------------------------------------------------------------------------
# 2. Legacy path (non-typed-v1 screen) — sidecar + telemetry
# ---------------------------------------------------------------------------


class TestLegacyPathSidecar(unittest.TestCase):
    """A legacy-path screen with prefilter enabled writes
    `selected_frames.json` listing the chosen basenames and records
    per-segment telemetry on the Pass2Result."""

    def setUp(self) -> None:
        # 4 PNGs: frame 2 is a duplicate of frame 1 → dedup collapses them.
        # Budget of 3 still leaves room so the budget cap doesn't trigger.
        self._orig = _patch_ffmpeg(
            _make_fake_ffmpeg(n_frames=4, duplicate_indices={2})
        )

    def tearDown(self) -> None:
        _unpatch_ffmpeg(self._orig)

    def test_legacy_sidecar_written_with_expected_basenames(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            pass2_root = Path(tmp) / "pass2"
            cfg = Pass2Config(
                window_padding_seconds=0.0,
                sample_rates={"post_game_box_score_goals": 1.0},
                extract_screens={"post_game_box_score_goals"},
                artifact_mode=True,
            )
            prefilter = VisualPrefilterPass2Config(
                enabled=True,
                frame_budget={"post_game_box_score_goals": 5},
                dedup_dhash_distance={"post_game_box_score_goals": 4},
            )
            results = extract_segments(
                video_path=Path("/fake/video.mkv"),
                segments=[_make_segment("post_game_box_score_goals")],
                config=cfg,
                pass2_root=pass2_root,
                video_duration_seconds=30.0,
                version="nhl26",
                segments_hash="sha256:test",
                prefilter=prefilter,
            )
            seg_dir = results[0].directory
            sidecar = seg_dir / SELECTED_FRAMES_SIDECAR_NAME
            self.assertTrue(sidecar.exists())
            selected = json.loads(sidecar.read_text())
            # Frame 2 duplicates frame 1; dHash dedup drops it. The
            # remaining 3 frames pass through (budget=5 > 3 survivors).
            self.assertEqual(set(selected), {"00001.png", "00003.png", "00004.png"})
            # Telemetry recorded; frame_count reflects the selected subset.
            self.assertEqual(results[0].prefilter_frames_scanned, 4)
            self.assertEqual(results[0].prefilter_frames_selected, 3)
            self.assertIsNotNone(results[0].prefilter_selection_ms)
            self.assertGreaterEqual(results[0].prefilter_selection_ms, 0.0)
            self.assertEqual(results[0].frame_count, 3)

    def test_manifest_cache_key_includes_prefilter_fingerprint(self) -> None:
        """Regression: a real-video A/B with --no-prefilter vs --prefilter
        was producing identical manifest cache_keys because
        `extract_segments` re-computed `compute_pass2_cache_key` without
        threading the `prefilter` kwarg through to `write_pass2_manifest`.
        That would trip CacheMismatch on every subsequent run after enabling
        the feature.

        This test runs `extract_segments` twice with the same Pass2Config
        and same output dirs, once with prefilter=None and once with
        prefilter enabled, then asserts the manifests' cache_keys differ.
        Locks the orchestrator/extract_segments cache-key parity contract.
        """
        # Use different pass2_roots so neither run sees the other's PNGs.
        cfg = Pass2Config(
            window_padding_seconds=0.0,
            sample_rates={"post_game_box_score_goals": 1.0},
            extract_screens={"post_game_box_score_goals"},
            artifact_mode=True,
        )
        prefilter_on = VisualPrefilterPass2Config(
            enabled=True,
            frame_budget={"post_game_box_score_goals": 5},
            dedup_dhash_distance={"post_game_box_score_goals": 4},
        )

        def _run(prefilter, root_name) -> str:
            with tempfile.TemporaryDirectory() as tmp:
                pass2_root = Path(tmp) / root_name
                extract_segments(
                    video_path=Path("/fake/video.mkv"),
                    segments=[_make_segment("post_game_box_score_goals")],
                    config=cfg,
                    pass2_root=pass2_root,
                    video_duration_seconds=30.0,
                    version="nhl26",
                    segments_hash="sha256:test",
                    prefilter=prefilter,
                )
                manifest = json.loads(
                    (pass2_root.parent / PASS2_MANIFEST_FILENAME).read_text()
                )
                return manifest["pass2_cache_key"]

        key_off = _run(prefilter=None, root_name="off")
        key_on = _run(prefilter=prefilter_on, root_name="on")
        self.assertNotEqual(
            key_off,
            key_on,
            "extract_segments must thread the `prefilter` kwarg into "
            "write_pass2_manifest's compute_pass2_cache_key call; otherwise "
            "an enabled-prefilter run writes a stale prefilter=off cache_key "
            "and any subsequent run will CacheMismatch on its own manifest.",
        )

    def test_legacy_manifest_carries_prefilter_fields(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            pass2_root = Path(tmp) / "pass2"
            cfg = Pass2Config(
                window_padding_seconds=0.0,
                sample_rates={"post_game_box_score_goals": 1.0},
                extract_screens={"post_game_box_score_goals"},
                artifact_mode=True,
            )
            prefilter = VisualPrefilterPass2Config(
                enabled=True,
                frame_budget={"post_game_box_score_goals": 5},
                dedup_dhash_distance={"post_game_box_score_goals": 4},
            )
            extract_segments(
                video_path=Path("/fake/video.mkv"),
                segments=[_make_segment("post_game_box_score_goals")],
                config=cfg,
                pass2_root=pass2_root,
                video_duration_seconds=30.0,
                version="nhl26",
                segments_hash="sha256:test",
                prefilter=prefilter,
            )
            manifest = json.loads(
                (pass2_root.parent / PASS2_MANIFEST_FILENAME).read_text()
            )
            entry = manifest["entries"][0]
            self.assertEqual(entry["prefilter_frames_scanned"], 4)
            self.assertEqual(entry["prefilter_frames_selected"], 3)
            self.assertIn("prefilter_selection_ms", entry)
            # Round-trip load also yields the values.
            loaded = load_pass2_manifest(
                pass2_root.parent / PASS2_MANIFEST_FILENAME,
                [_make_segment("post_game_box_score_goals")],
            )
            self.assertEqual(loaded.results[0].prefilter_frames_scanned, 4)
            self.assertEqual(loaded.results[0].prefilter_frames_selected, 3)


# ---------------------------------------------------------------------------
# 3. Typed-v1 path — provider wrapped, no sidecar, telemetry on result
# ---------------------------------------------------------------------------


class TestTypedV1PathWrapping(unittest.TestCase):
    """When the segment is typed-v1 (loadout / lobby) and the prefilter is
    enabled, the typed-v1 extractor's frame_provider is wrapped in
    `FilteredFrameProvider` and yields only the selected subset. No
    `selected_frames.json` sidecar is written in this mode (the typed-v1
    extractor consumes the provider directly; the worker subprocess + its
    sidecar honour is the legacy contract)."""

    def setUp(self) -> None:
        # 5 PNGs; frames 2 and 4 are duplicates of frame 1 → dedup drops 2 of 5.
        self._orig_ffmpeg = _patch_ffmpeg(
            _make_fake_ffmpeg(n_frames=5, duplicate_indices={2, 4})
        )
        self._spy = _PassthroughExtractor()
        self._orig_extract = pass2_module.extract_loadout_evidence
        pass2_module.extract_loadout_evidence = self._spy

    def tearDown(self) -> None:
        _unpatch_ffmpeg(self._orig_ffmpeg)
        pass2_module.extract_loadout_evidence = self._orig_extract

    def test_loadout_extractor_sees_wrapped_provider(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            pass2_root = Path(tmp) / "pass2"
            cfg = Pass2Config(
                window_padding_seconds=0.0,
                sample_rates={"player_loadout_view": 1.0},
                extract_screens={"player_loadout_view"},
                loadout_engine="typed_v1",
                artifact_mode=True,  # forces PngFrameProvider — no PyAV needed
            )
            prefilter = VisualPrefilterPass2Config(
                enabled=True,
                frame_budget={"player_loadout_view": 5},
                dedup_dhash_distance={"player_loadout_view": 4},
            )
            results = extract_segments(
                video_path=Path("/fake/video.mkv"),
                segments=[_make_segment("player_loadout_view")],
                config=cfg,
                pass2_root=pass2_root,
                video_duration_seconds=30.0,
                version="nhl26",
                segments_hash="sha256:test",
                prefilter=prefilter,
            )
            seg_dir = results[0].directory
            # No sidecar written for typed-v1 — the wrapper is what filters.
            self.assertFalse((seg_dir / SELECTED_FRAMES_SIDECAR_NAME).exists())
            # Spy saw exactly the selected subset (5 scanned → 3 survive dedup).
            self.assertIsNotNone(self._spy.last_records)
            self.assertEqual(len(self._spy.last_records), 3)
            self.assertEqual(results[0].prefilter_frames_scanned, 5)
            self.assertEqual(results[0].prefilter_frames_selected, 3)
            self.assertGreaterEqual(results[0].prefilter_selection_ms, 0.0)

    def test_loadout_extractor_disabled_sees_unwrapped_provider(self) -> None:
        """When the prefilter is off, the typed-v1 extractor sees the
        original provider (no wrapping)."""
        with tempfile.TemporaryDirectory() as tmp:
            pass2_root = Path(tmp) / "pass2"
            cfg = Pass2Config(
                window_padding_seconds=0.0,
                sample_rates={"player_loadout_view": 1.0},
                extract_screens={"player_loadout_view"},
                loadout_engine="typed_v1",
                artifact_mode=True,
            )
            results = extract_segments(
                video_path=Path("/fake/video.mkv"),
                segments=[_make_segment("player_loadout_view")],
                config=cfg,
                pass2_root=pass2_root,
                video_duration_seconds=30.0,
                version="nhl26",
                segments_hash="sha256:test",
                prefilter=None,
            )
            # Spy saw all 5 frames (no filtering).
            self.assertEqual(len(self._spy.last_records), 5)
            self.assertIsNone(results[0].prefilter_frames_scanned)


if __name__ == "__main__":
    unittest.main()
