"""Regression tests for the Pass 2 manifest contract.

Issue 4 (2026-05-16 review): pass2_manifest.json was being overwritten on
cache-hit with un-padded segment bounds, while fresh runs wrote the padded
extraction window. The manifest is now the source of truth — written once
at extraction time, read (not reconstructed) on cache-hit.
"""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from video_ingest.pass1_classify import Segment
from video_ingest.pass2_extract import (
    Pass2Config,
    Pass2Result,
    extract_segments,
    load_pass2_manifest,
    write_pass2_manifest,
)
from video_ingest import pass2_extract as pass2_module


# A valid 10x10 black PNG. Used by the fake ffmpeg stub so the Phase 3b
# PngFrameProvider (which fails closed on cv2.imread == None) can still
# decode the placeholder frames the stub writes.
_VALID_PNG_BYTES = bytes((
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x0a, 0x00, 0x00, 0x00, 0x0a,
    0x08, 0x02, 0x00, 0x00, 0x00, 0x02, 0x50, 0x58, 0xea, 0x00, 0x00, 0x00,
    0x1f, 0x49, 0x44, 0x41, 0x54, 0x18, 0x19, 0x7d, 0xc1, 0x01, 0x01, 0x00,
    0x00, 0x00, 0x40, 0x20, 0xfe, 0x9f, 0xf6, 0x40, 0xc9, 0x92, 0x25, 0x4b,
    0x96, 0x2c, 0x59, 0xb2, 0x64, 0xc9, 0x92, 0x15, 0x07, 0xdf, 0x00, 0x0b,
    0x29, 0xdf, 0x97, 0xe9, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44,
    0xae, 0x42, 0x60, 0x82,
))


def _make_segment(idx_seconds: tuple[float, float], screen: str) -> Segment:
    start_s, end_s = idx_seconds
    return Segment(
        start_index=int(start_s),
        end_index=int(end_s),
        start_seconds=start_s,
        end_seconds=end_s,
        screen_type=screen,
        frame_count=int(end_s - start_s) + 1,
        mean_color_score=0.95,
    )


class ManifestRoundTripTests(unittest.TestCase):
    def test_manifest_round_trip_preserves_padded_windows(self) -> None:
        """write → read must reproduce every field, including the padded
        start/end (which differ from segment bounds)."""
        seg = _make_segment((10.0, 20.0), "post_game_action_tracker")
        # Simulate the padded extraction window the orchestrator writes.
        result = Pass2Result(
            segment_index=3,
            segment=seg,
            directory=Path("/fake/pass2/seg-003-post_game_action_tracker"),
            frame_count=55,
            sample_fps=5.0,
            start_seconds=9.0,   # seg.start - 1.0 padding
            end_seconds=21.0,    # seg.end + 1.0 padding
        )

        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "pass2_manifest.json"
            write_pass2_manifest(
                path,
                [result],
                version="nhl26",
                cache_key="sha256:test",
                segments_hash="sha256:seg",
            )
            loaded = load_pass2_manifest(path, [seg, seg, seg, seg])  # idx 3 expected

        self.assertEqual(loaded.version, "nhl26")
        self.assertEqual(loaded.pass2_cache_key, "sha256:test")
        self.assertEqual(loaded.segments_hash, "sha256:seg")
        self.assertFalse(loaded.is_legacy)
        self.assertEqual(len(loaded.results), 1)
        r = loaded.results[0]
        self.assertEqual(r.segment_index, 3)
        self.assertEqual(r.segment.screen_type, "post_game_action_tracker")
        self.assertEqual(r.frame_count, 55)
        self.assertEqual(r.sample_fps, 5.0)
        self.assertEqual(r.start_seconds, 9.0)
        self.assertEqual(r.end_seconds, 21.0)
        self.assertEqual(r.directory, Path("/fake/pass2/seg-003-post_game_action_tracker"))

    def test_load_missing_manifest_raises(self) -> None:
        """Cache-hit guard depends on FileNotFoundError to detect 'no valid cache'."""
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "pass2_manifest.json"
            with self.assertRaises(FileNotFoundError):
                load_pass2_manifest(path, [])

    def test_manifest_round_trip_preserves_artifact_mode(self) -> None:
        """Phase 3a: artifact_mode is a top-level manifest field. Both
        True and False values survive write → load, and the
        Pass2ManifestLoaded.is_legacy property recognises both as fresh."""
        seg = _make_segment((5.0, 10.0), "player_loadout_view")
        result = Pass2Result(
            segment_index=0,
            segment=seg,
            directory=Path("/fake/pass2/seg-000-player_loadout_view"),
            frame_count=5,
            sample_fps=1.0,
            start_seconds=4.0,
            end_seconds=11.0,
        )
        for mode in (True, False):
            with self.subTest(artifact_mode=mode):
                with tempfile.TemporaryDirectory() as tmp:
                    path = Path(tmp) / "pass2_manifest.json"
                    write_pass2_manifest(
                        path,
                        [result],
                        version="nhl26",
                        cache_key="sha256:test",
                        segments_hash="sha256:seg",
                        artifact_mode=mode,
                    )
                    loaded = load_pass2_manifest(path, [seg])
                self.assertEqual(loaded.artifact_mode, mode)
                self.assertFalse(loaded.is_legacy)

    def test_legacy_manifest_without_artifact_mode_field_is_legacy(self) -> None:
        """Phase 3a: a manifest written before artifact_mode existed must
        load as legacy so the cache-mismatch path forces a fresh extract
        under whatever mode the operator now selects."""
        seg = _make_segment((5.0, 10.0), "player_loadout_view")
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "pass2_manifest.json"
            # Hand-write a pre-Phase-3a manifest: schema is the 4-field
            # header + entries, no artifact_mode key.
            payload = {
                "version": "nhl26",
                "pass2_cache_key": "sha256:test",
                "segments_hash": "sha256:seg",
                "entries": [
                    {
                        "segment_index": 0,
                        "screen_type": "player_loadout_view",
                        "directory": "/fake/dir",
                        "frame_count": 5,
                        "sample_fps": 1.0,
                        "start_seconds": 4.0,
                        "end_seconds": 11.0,
                    }
                ],
            }
            path.write_text(json.dumps(payload))
            loaded = load_pass2_manifest(path, [seg])
        self.assertIsNone(loaded.artifact_mode)
        self.assertTrue(loaded.is_legacy)


class ExtractWritesManifestTests(unittest.TestCase):
    """extract_segments must write the manifest itself, with the padded
    windows it actually passed to ffmpeg — not the raw segment bounds."""

    def setUp(self) -> None:
        # Stub _ffmpeg_extract: write one fake PNG, return frame_count=1.
        # Captures the (start, end) it was called with so we can assert
        # the manifest matches.
        self._calls: list[tuple[float, float]] = []

        def fake_ffmpeg(video_path, out_dir, start_seconds, end_seconds, fps):
            self._calls.append((start_seconds, end_seconds))
            out_dir.mkdir(parents=True, exist_ok=True)
            (out_dir / "00001.png").write_bytes(_VALID_PNG_BYTES)
            return 1

        self._orig_ffmpeg = pass2_module._ffmpeg_extract
        pass2_module._ffmpeg_extract = fake_ffmpeg

    def tearDown(self) -> None:
        pass2_module._ffmpeg_extract = self._orig_ffmpeg

    def test_extract_writes_manifest_with_padded_windows(self) -> None:
        seg = _make_segment((10.0, 20.0), "post_game_action_tracker")
        cfg = Pass2Config(
            window_padding_seconds=1.0,
            sample_rates={"post_game_action_tracker": 5.0},
            extract_screens={"post_game_action_tracker"},
        )
        with tempfile.TemporaryDirectory() as tmp:
            pass2_root = Path(tmp) / "pass2"
            results = extract_segments(
                video_path=Path("/fake/video.mkv"),
                segments=[seg],
                config=cfg,
                pass2_root=pass2_root,
                video_duration_seconds=60.0,
                version="nhl26",
                segments_hash="sha256:fakeseg",
            )
            manifest_path = pass2_root.parent / "pass2_manifest.json"
            self.assertTrue(manifest_path.exists(), "extract_segments did not write pass2_manifest.json")
            payload = json.loads(manifest_path.read_text())

        # ffmpeg was called with padded window
        self.assertEqual(self._calls, [(9.0, 21.0)])
        # In-memory result matches padding
        self.assertEqual(results[0].start_seconds, 9.0)
        self.assertEqual(results[0].end_seconds, 21.0)
        # Manifest on disk records the padded values, NOT the raw segment bounds,
        # and includes the Issue-2 cache identifiers in its header.
        self.assertEqual(payload["version"], "nhl26")
        self.assertEqual(payload["segments_hash"], "sha256:fakeseg")
        self.assertTrue(payload["pass2_cache_key"].startswith("sha256:"))
        entries = payload["entries"]
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0]["start_seconds"], 9.0)
        self.assertEqual(entries[0]["end_seconds"], 21.0)
        self.assertNotEqual(entries[0]["start_seconds"], seg.start_seconds)
        self.assertNotEqual(entries[0]["end_seconds"], seg.end_seconds)

    def test_cache_hit_via_load_matches_fresh_extract(self) -> None:
        """The buggy old path: fresh run wrote padded windows, cache-hit
        rebuilt with raw segment bounds — values diverged. Now they match
        because cache-hit just loads the manifest."""
        seg = _make_segment((10.0, 20.0), "post_game_action_tracker")
        cfg = Pass2Config(
            window_padding_seconds=1.0,
            sample_rates={"post_game_action_tracker": 5.0},
            extract_screens={"post_game_action_tracker"},
        )
        with tempfile.TemporaryDirectory() as tmp:
            pass2_root = Path(tmp) / "pass2"
            fresh = extract_segments(
                video_path=Path("/fake/video.mkv"),
                segments=[seg],
                config=cfg,
                pass2_root=pass2_root,
                video_duration_seconds=60.0,
                version="nhl26",
                segments_hash="sha256:fakeseg",
            )
            manifest_path = pass2_root.parent / "pass2_manifest.json"
            before = manifest_path.read_bytes()
            cached = load_pass2_manifest(manifest_path, [seg])
            # Loading must be read-only — would catch a stray write-on-read
            self.assertEqual(manifest_path.read_bytes(), before)

            self.assertEqual(len(cached.results), len(fresh))
            for f, c in zip(fresh, cached.results):
                self.assertEqual(f.start_seconds, c.start_seconds)
                self.assertEqual(f.end_seconds, c.end_seconds)
                self.assertEqual(f.frame_count, c.frame_count)
                self.assertEqual(f.sample_fps, c.sample_fps)
                self.assertEqual(f.segment_index, c.segment_index)
                self.assertEqual(str(f.directory), str(c.directory))


if __name__ == "__main__":
    unittest.main()
