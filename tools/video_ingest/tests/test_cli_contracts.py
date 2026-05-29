"""Regression tests for Issue 3 — CLI subcommand contracts.

`classify-only` runs only Pass 1; `extract-only` runs only Pass 2 and requires
a valid Pass 1 cache. Both respect cache invalidation (Issue 2) and the
manifest authority (Issue 4). Tests use the same orchestrator monkeypatch
pattern as test_cache_invalidation.py — no real ffmpeg / GPU / video file.
"""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from video_ingest.pass1_classify import (
    CacheMismatch,
    MissingPass1Cache,
    Segment,
)
from video_ingest.pass2_extract import PASS2_MANIFEST_FILENAME
from video_ingest import orchestrator as orch_module
from video_ingest import pass2_extract as p2_module


def _make_segment(start: float, end: float, screen: str) -> Segment:
    return Segment(
        start_index=int(start),
        end_index=int(end),
        start_seconds=start,
        end_seconds=end,
        screen_type=screen,
        frame_count=int(end - start) + 1,
        mean_color_score=0.95,
    )


class _FakeProbe:
    def __init__(self, sha: str, duration: float = 60.0) -> None:
        self.sha256 = sha
        self.duration_seconds = duration
        self.width = 1920
        self.height = 1080
        self.avg_fps = 60.0
        self.pts_max_jump_seconds = 0.017


class CLIContractsTests(unittest.TestCase):
    """End-to-end orchestrator behavior with ffprobe, classifier, and ffmpeg
    monkeypatched. Asserts the new skip_pass1 / skip_pass2 contracts."""

    def setUp(self) -> None:
        self.fake_sha = "feedface" * 8
        self.segments_classified = [
            _make_segment(7.0, 16.0, "pre_game_lobby_state_2"),
            _make_segment(17.0, 29.0, "player_loadout_view"),
        ]

        self._classify_video_mock = mock.MagicMock(return_value=[])
        self._build_classifier_mock = mock.MagicMock(return_value=object())

        # _run_pass1 stub: delegates to the classify_video + build_segments
        # mocks so assertions like assert_called_once() on _classify_video_mock
        # still work, while bypassing engine dispatch (viterbi would try to
        # open the fake video file).
        def _fake_run_pass1(video_path, classifier_legacy, p1cfg, version):
            from video_ingest.pass1_classify import SamplingTelemetry
            cls = self._classify_video_mock(video_path, classifier_legacy, p1cfg)
            segs = self.segments_classified
            return cls, segs, "legacy-passthrough-v0-video", SamplingTelemetry()

        self._patchers = [
            mock.patch.object(orch_module, "pts_probe",
                              return_value=_FakeProbe(self.fake_sha)),
            mock.patch.object(orch_module, "_build_classifier",
                              new=self._build_classifier_mock),
            mock.patch.object(orch_module, "classify_video",
                              new=self._classify_video_mock),
            mock.patch.object(orch_module, "build_segments",
                              return_value=self.segments_classified),
            mock.patch.object(orch_module, "_run_pass1",
                              side_effect=_fake_run_pass1),
        ]
        for p in self._patchers:
            p.start()

        def fake_ffmpeg(video_path, out_dir, start_seconds, end_seconds, fps):
            out_dir.mkdir(parents=True, exist_ok=True)
            (out_dir / "00001.png").write_bytes(b"")
            return 1
        self._ffmpeg_patcher = mock.patch.object(
            p2_module, "_ffmpeg_extract", side_effect=fake_ffmpeg,
        )
        self._ffmpeg_patcher.start()

        self._tmp = tempfile.TemporaryDirectory()
        self.output_root = Path(self._tmp.name)
        self.sha_root = self.output_root / self.fake_sha

    def tearDown(self) -> None:
        self._ffmpeg_patcher.stop()
        for p in self._patchers:
            p.stop()
        self._tmp.cleanup()

    def _run(self, **kwargs):
        return orch_module.ingest(
            video_path=Path("/fake/video.mkv"),
            output_root=self.output_root,
            version="nhl26",
            use_gpu=False,
            **kwargs,
        )

    # -------- classify-only --------

    def test_classify_only_does_not_create_pass2_dir(self) -> None:
        res = self._run(skip_pass2=True)
        self.assertEqual(res.pass2_results, [])
        self.assertTrue((self.sha_root / "segments.json").exists())
        self.assertFalse((self.sha_root / "pass2").exists())
        self.assertFalse((self.sha_root / PASS2_MANIFEST_FILENAME).exists())

    def test_classify_only_respects_pass1_cache(self) -> None:
        self._run(skip_pass2=True)
        self._classify_video_mock.reset_mock()
        res2 = self._run(skip_pass2=True)
        # Cache hit: classify_video not called, elapsed_pass1 stays at 0
        self._classify_video_mock.assert_not_called()
        self.assertEqual(res2.elapsed_pass1, 0.0)

    def test_classify_only_force_pass1_reruns_pass1_only(self) -> None:
        # Pre-populate via a full run, then assert force_pass1 + skip_pass2
        # re-runs Pass 1 AND leaves no Pass 2 state.
        self._run()  # full pipeline, creates pass2/
        self.assertTrue((self.sha_root / "pass2").exists())

        self._classify_video_mock.reset_mock()
        res = self._run(skip_pass2=True, force_pass1=True)
        self._classify_video_mock.assert_called_once()  # Pass 1 ran fresh
        self.assertGreater(res.elapsed_pass1, 0.0)
        # Pass 1's cascade clear removed pass2/; skip_pass2 didn't recreate it.
        self.assertFalse((self.sha_root / "pass2").exists())
        self.assertFalse((self.sha_root / PASS2_MANIFEST_FILENAME).exists())

    # -------- extract-only --------

    def test_extract_only_raises_when_segments_json_missing(self) -> None:
        with self.assertRaises(MissingPass1Cache) as ctx:
            self._run(skip_pass1=True)
        self.assertIn("classify-only", str(ctx.exception))

    def test_extract_only_raises_on_legacy_segments_json(self) -> None:
        self._run(skip_pass2=True)
        seg_json = self.sha_root / "segments.json"
        data = json.loads(seg_json.read_text())
        data.pop("version", None)
        data.pop("pass1_cache_key", None)
        seg_json.write_text(json.dumps(data))

        with self.assertRaises(MissingPass1Cache):
            self._run(skip_pass1=True)

    def test_extract_only_raises_on_cache_mismatch(self) -> None:
        self._run(skip_pass2=True)
        seg_json = self.sha_root / "segments.json"
        data = json.loads(seg_json.read_text())
        data["pass1_cache_key"] = "sha256:stale"
        seg_json.write_text(json.dumps(data))

        with self.assertRaises(CacheMismatch):
            self._run(skip_pass1=True)

    def test_extract_only_uses_cached_segments_without_running_classifier(self) -> None:
        self._run(skip_pass2=True)
        self._classify_video_mock.reset_mock()
        self._build_classifier_mock.reset_mock()

        res = self._run(skip_pass1=True)
        self._classify_video_mock.assert_not_called()
        self._build_classifier_mock.assert_not_called()
        self.assertGreater(len(res.pass2_results), 0)
        self.assertTrue((self.sha_root / PASS2_MANIFEST_FILENAME).exists())

    def test_extract_only_force_pass2_reextracts(self) -> None:
        self._run()  # full pipeline populates both passes
        manifest = self.sha_root / PASS2_MANIFEST_FILENAME
        before = manifest.read_bytes()

        # Without force, second extract-only is a cache hit (manifest unchanged).
        self._run(skip_pass1=True)
        self.assertEqual(manifest.read_bytes(), before)

        # With force, manifest is rewritten (timestamps differ even if content
        # is identical because extract_segments writes a fresh file).
        self._run(skip_pass1=True, force_pass2=True)
        # New manifest must still have the cache identifiers
        rewritten = json.loads(manifest.read_text())
        self.assertEqual(rewritten["version"], "nhl26")
        self.assertIn("pass2_cache_key", rewritten)

    # -------- regression: full ingest --------

    def test_ingest_full_pipeline_unchanged(self) -> None:
        """Default flags (no skip_*) still run both passes."""
        res = self._run()
        self.assertEqual(len(res.pass1_segments), 2)
        self.assertEqual(len(res.pass2_results), 2)
        self.assertTrue((self.sha_root / "segments.json").exists())
        self.assertTrue((self.sha_root / PASS2_MANIFEST_FILENAME).exists())

    # -------- argument validation --------

    def test_skip_and_force_are_mutually_exclusive(self) -> None:
        with self.assertRaises(ValueError):
            self._run(skip_pass1=True, force_pass1=True)
        with self.assertRaises(ValueError):
            self._run(skip_pass2=True, force_pass2=True)


if __name__ == "__main__":
    unittest.main()
