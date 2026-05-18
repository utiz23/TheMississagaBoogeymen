"""Regression tests for Issue 2 — cache invalidation on config / version drift.

These tests cover:
  - hash helpers (sensitivity to version YAML and classifier YAML edits)
  - schema legacy detection (segments.json and pass2_manifest.json)
  - the orchestrator's cache-check behavior, exercised end-to-end with the
    heavy parts (ffprobe, classifier, ffmpeg) monkeypatched
"""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from video_ingest.pass1_classify import (
    CacheMismatch,
    Pass1Config,
    Segment,
    SegmentsJsonLoaded,
    compute_pass1_cache_key,
    compute_segments_hash,
    load_segments_json,
    write_segments_json,
)
from video_ingest.pass2_extract import (
    PASS2_MANIFEST_FILENAME,
    Pass2Config,
    Pass2Result,
    compute_pass2_cache_key,
    load_pass2_manifest,
    write_pass2_manifest,
)
from video_ingest import orchestrator as orch_module
from video_ingest import pass1_classify as p1_module
from video_ingest import pass2_extract as p2_module


# ---------------------------------------------------------------- helpers


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


# ---------------------------------------------------------------- hash helpers


class CacheKeyHelperTests(unittest.TestCase):
    def test_pass1_cache_key_changes_when_version_yaml_changes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_video = Path(tmp) / "video"
            tmp_classifier = Path(tmp) / "classifier"
            tmp_video.mkdir()
            tmp_classifier.mkdir()
            (tmp_video / "nhl26.yaml").write_text("a: 1\n")
            (tmp_classifier / "nhl26.yaml").write_text("c: 1\n")

            with mock.patch.object(p1_module, "VIDEO_INGEST_CONFIGS_DIR", tmp_video), \
                 mock.patch.object(p1_module, "_CLASSIFIER_CONFIGS_DIR", tmp_classifier):
                k1 = compute_pass1_cache_key("nhl26")
                (tmp_video / "nhl26.yaml").write_text("a: 2\n")
                k2 = compute_pass1_cache_key("nhl26")
        self.assertNotEqual(k1, k2)

    def test_pass1_cache_key_changes_when_classifier_yaml_changes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_video = Path(tmp) / "video"
            tmp_classifier = Path(tmp) / "classifier"
            tmp_video.mkdir()
            tmp_classifier.mkdir()
            (tmp_video / "nhl26.yaml").write_text("a: 1\n")
            (tmp_classifier / "nhl26.yaml").write_text("c: 1\n")

            with mock.patch.object(p1_module, "VIDEO_INGEST_CONFIGS_DIR", tmp_video), \
                 mock.patch.object(p1_module, "_CLASSIFIER_CONFIGS_DIR", tmp_classifier):
                k1 = compute_pass1_cache_key("nhl26")
                (tmp_classifier / "nhl26.yaml").write_text("c: 2\n")
                k2 = compute_pass1_cache_key("nhl26")
        self.assertNotEqual(k1, k2)

    def test_pass2_cache_key_depends_only_on_version_yaml(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp_video = Path(tmp) / "video"
            tmp_classifier = Path(tmp) / "classifier"
            tmp_video.mkdir()
            tmp_classifier.mkdir()
            (tmp_video / "nhl26.yaml").write_text("a: 1\n")
            (tmp_classifier / "nhl26.yaml").write_text("c: 1\n")

            # `compute_pass2_cache_key` is defined in p2_module but reads its
            # own VIDEO_INGEST_CONFIGS_DIR import. Patch both module-level
            # bindings to redirect at the temp dirs.
            with mock.patch.object(p1_module, "VIDEO_INGEST_CONFIGS_DIR", tmp_video), \
                 mock.patch.object(p1_module, "_CLASSIFIER_CONFIGS_DIR", tmp_classifier), \
                 mock.patch.object(p2_module, "VIDEO_INGEST_CONFIGS_DIR", tmp_video):
                k1 = compute_pass2_cache_key("nhl26")
                # Pass 2 key must NOT change when only classifier changes — it
                # cascades via segments_hash instead.
                (tmp_classifier / "nhl26.yaml").write_text("c: 2\n")
                k2 = compute_pass2_cache_key("nhl26")
                self.assertEqual(k1, k2)

                (tmp_video / "nhl26.yaml").write_text("a: 2\n")
                k3 = compute_pass2_cache_key("nhl26")
                self.assertNotEqual(k1, k3)


# ---------------------------------------------------------------- schema legacy detection


class SegmentsJsonSchemaTests(unittest.TestCase):
    def test_round_trip_preserves_version_and_cache_key(self) -> None:
        seg = _make_segment(7.0, 16.0, "pre_game_lobby_state_2")
        cfg = Pass1Config()
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "segments.json"
            write_segments_json(
                path,
                classifications=[],
                segments=[seg],
                video_sha256="abc",
                video_path=Path("/v.mkv"),
                config=cfg,
                version="nhl26",
                cache_key="sha256:test",
            )
            loaded = load_segments_json(path)
        self.assertEqual(loaded.version, "nhl26")
        self.assertEqual(loaded.pass1_cache_key, "sha256:test")
        self.assertEqual(loaded.video_sha256, "abc")
        self.assertFalse(loaded.is_legacy)
        self.assertEqual(len(loaded.segments), 1)

    def test_legacy_segments_json_is_flagged(self) -> None:
        """Files written before Issue 2 lack the cache-key fields."""
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "segments.json"
            # Hand-write a pre-Issue-2 payload (no version, no pass1_cache_key).
            payload = {
                "video_path": "/v.mkv",
                "video_sha256": "abc",
                "pass1_config": {"sample_fps": 1, "min_run_to_open": 2,
                                 "max_outliers_within": 1, "min_segment_seconds": 3.0},
                "segments": [],
                "frame_classifications": [],
            }
            path.write_text(json.dumps(payload))
            loaded = load_segments_json(path)
        self.assertTrue(loaded.is_legacy)
        self.assertIsNone(loaded.version)
        self.assertIsNone(loaded.pass1_cache_key)


class Pass2ManifestSchemaTests(unittest.TestCase):
    def test_legacy_bare_list_manifest_is_flagged(self) -> None:
        """Manifests written under Issue 4's schema (bare list) lack cache keys."""
        seg = _make_segment(7.0, 16.0, "pre_game_lobby_state_2")
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "pass2_manifest.json"
            # Hand-write an Issue-4-era bare list payload.
            payload = [{
                "segment_index": 0,
                "screen_type": "pre_game_lobby_state_2",
                "directory": "/x/seg-000",
                "frame_count": 10,
                "sample_fps": 1.0,
                "start_seconds": 6.0,
                "end_seconds": 17.0,
            }]
            path.write_text(json.dumps(payload))
            loaded = load_pass2_manifest(path, [seg])
        self.assertTrue(loaded.is_legacy)
        self.assertEqual(len(loaded.results), 1)
        self.assertEqual(loaded.results[0].start_seconds, 6.0)


class SegmentsHashTests(unittest.TestCase):
    def test_segments_hash_is_content_addressed(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "segments.json"
            path.write_text("{}")
            h1 = compute_segments_hash(path)
            path.write_text("{ }")
            h2 = compute_segments_hash(path)
        self.assertNotEqual(h1, h2)


# ---------------------------------------------------------------- orchestrator end-to-end


class _FakeProbe:
    def __init__(self, sha: str, duration: float = 60.0) -> None:
        self.sha256 = sha
        self.duration_seconds = duration
        self.width = 1920
        self.height = 1080
        self.avg_fps = 60.0
        self.pts_max_jump_seconds = 0.017


class OrchestratorCacheTests(unittest.TestCase):
    """Run orchestrator.ingest() against a fake video. pts_probe, the
    classifier build, and _ffmpeg_extract are all monkeypatched so the
    tests stay seconds-fast and need no real video/ffmpeg/GPU."""

    def setUp(self) -> None:
        self.fake_sha = "deadbeef" * 8
        self.segments_classified = [
            _make_segment(7.0, 16.0, "pre_game_lobby_state_2"),
            _make_segment(17.0, 29.0, "player_loadout_view"),
        ]
        # Run with the real on-disk nhl26 YAMLs (no monkeypatch needed for
        # paths). The orchestrator computes cache keys against those.

        # 1. ffprobe stub
        self._probe_patcher = mock.patch.object(
            orch_module, "pts_probe",
            return_value=_FakeProbe(self.fake_sha),
        )
        self._probe_patcher.start()

        # 2. classifier build stub — returns a sentinel; classify_video stubbed
        # to ignore it and return canned segments.
        self._classifier_patcher = mock.patch.object(
            orch_module, "_build_classifier", return_value=object(),
        )
        self._classifier_patcher.start()

        # classify_video must produce something that build_segments can consume,
        # but we short-circuit build_segments to return our canned segments.
        self._classify_patcher = mock.patch.object(
            orch_module, "classify_video", return_value=[],
        )
        self._classify_patcher.start()
        self._build_patcher = mock.patch.object(
            orch_module, "build_segments",
            return_value=self.segments_classified,
        )
        self._build_patcher.start()

        # 3. ffmpeg stub
        def fake_ffmpeg(video_path, out_dir, start_seconds, end_seconds, fps):
            out_dir.mkdir(parents=True, exist_ok=True)
            (out_dir / "00001.png").write_bytes(b"")
            return 1
        self._ffmpeg_patcher = mock.patch.object(p2_module, "_ffmpeg_extract", side_effect=fake_ffmpeg)
        self._ffmpeg_patcher.start()

        self._tmp = tempfile.TemporaryDirectory()
        self.output_root = Path(self._tmp.name)

    def tearDown(self) -> None:
        self._probe_patcher.stop()
        self._classifier_patcher.stop()
        self._classify_patcher.stop()
        self._build_patcher.stop()
        self._ffmpeg_patcher.stop()
        self._tmp.cleanup()

    def _run(self, **kwargs):
        return orch_module.ingest(
            video_path=Path("/fake/video.mkv"),
            output_root=self.output_root,
            version="nhl26",
            use_gpu=False,
            **kwargs,
        )

    def test_fresh_then_cached_run_succeeds_silently(self) -> None:
        r1 = self._run()
        r2 = self._run()
        self.assertEqual(r1.probe.sha256, r2.probe.sha256)
        self.assertEqual(len(r1.pass2_results), len(r2.pass2_results))

    def test_pass1_raises_on_cache_key_mismatch(self) -> None:
        self._run()
        # Tamper with the stored cache key to simulate config drift.
        segments_json = self.output_root / self.fake_sha / "segments.json"
        data = json.loads(segments_json.read_text())
        data["pass1_cache_key"] = "sha256:stale"
        segments_json.write_text(json.dumps(data))

        with self.assertRaises(CacheMismatch) as ctx:
            self._run()
        msg = str(ctx.exception)
        self.assertIn("--force-pass1", msg)
        self.assertIn("sha256:stale", msg)

    def test_legacy_segments_json_falls_through_to_fresh_run(self) -> None:
        self._run()
        # Strip the cache-key fields to make it look pre-Issue-2.
        segments_json = self.output_root / self.fake_sha / "segments.json"
        data = json.loads(segments_json.read_text())
        data.pop("version", None)
        data.pop("pass1_cache_key", None)
        segments_json.write_text(json.dumps(data))

        # Should NOT raise — legacy treated as cache miss, fresh run rewrites.
        r = self._run()
        self.assertGreater(r.elapsed_pass1, 0.0)  # actually ran Pass 1
        # New segments.json has the fields again
        data2 = json.loads(segments_json.read_text())
        self.assertEqual(data2["version"], "nhl26")
        self.assertIn("pass1_cache_key", data2)

    def test_pass2_raises_on_segments_hash_mismatch(self) -> None:
        self._run()
        # Mutate segments.json bytes without bumping its cache key — simulates
        # a hand-edit or stale pass2 manifest after a Pass 1 we didn't realize
        # changed segments. (In practice this surfaces when Pass 2 was last
        # written against a different segments.json.)
        segments_json = self.output_root / self.fake_sha / "segments.json"
        data = json.loads(segments_json.read_text())
        data["video_path"] = data["video_path"] + " "  # whitespace flip
        segments_json.write_text(json.dumps(data))

        with self.assertRaises(CacheMismatch) as ctx:
            self._run()
        self.assertIn("segments_hash", str(ctx.exception))

    def test_pass2_legacy_manifest_falls_through_to_fresh_extract(self) -> None:
        self._run()
        manifest = self.output_root / self.fake_sha / PASS2_MANIFEST_FILENAME
        # Replace with Issue-4 bare-list payload.
        new_data = json.loads(manifest.read_text())["entries"]
        manifest.write_text(json.dumps(new_data))

        r = self._run()
        # Manifest is rewritten with the wrapper schema.
        rewritten = json.loads(manifest.read_text())
        self.assertIsInstance(rewritten, dict)
        self.assertIn("pass2_cache_key", rewritten)
        self.assertEqual(len(r.pass2_results), len(new_data))

    def test_force_pass1_cascades_to_pass2_invalidation(self) -> None:
        self._run()
        manifest = self.output_root / self.fake_sha / PASS2_MANIFEST_FILENAME
        manifest_before = manifest.read_bytes()

        # Modify segments_classified so a re-run produces different segments.
        # (We rely on the build_segments mock to return the new list.)
        self.segments_classified = [
            _make_segment(7.0, 16.0, "pre_game_lobby_state_2"),
            # second segment dropped
        ]
        self._build_patcher.stop()
        self._build_patcher = mock.patch.object(
            orch_module, "build_segments",
            return_value=self.segments_classified,
        )
        self._build_patcher.start()

        r = self._run(force_pass1=True)
        self.assertEqual(len(r.pass1_segments), 1)
        # Pass 2 must have re-extracted (cascade), and the manifest changed.
        self.assertNotEqual(manifest.read_bytes(), manifest_before)
        self.assertEqual(len(r.pass2_results), 1)


if __name__ == "__main__":
    unittest.main()
