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

    def test_pass2_cache_key_flips_when_artifact_mode_changes(self) -> None:
        """Phase 3a: switching artifact_mode must invalidate the pass2
        cache. A cached PNG-on-disk run is structurally incompatible with
        a fresh in-memory run (the directory layout the typed_v1
        extractors expect differs) — silent reuse would yield wrong
        output. The cache key change is what triggers CacheMismatch."""
        with tempfile.TemporaryDirectory() as tmp:
            tmp_video = Path(tmp) / "video"
            tmp_video.mkdir()
            (tmp_video / "nhl26.yaml").write_text("a: 1\n")
            with mock.patch.object(p2_module, "VIDEO_INGEST_CONFIGS_DIR", tmp_video):
                k_artifacts = compute_pass2_cache_key("nhl26", artifact_mode=True)
                k_no_artifacts = compute_pass2_cache_key("nhl26", artifact_mode=False)
        self.assertNotEqual(k_artifacts, k_no_artifacts)
        # Phase 3c: default arg must equal explicit False (in-memory hot
        # path is the steady state since Phase 3c).
        with tempfile.TemporaryDirectory() as tmp:
            tmp_video = Path(tmp) / "video"
            tmp_video.mkdir()
            (tmp_video / "nhl26.yaml").write_text("a: 1\n")
            with mock.patch.object(p2_module, "VIDEO_INGEST_CONFIGS_DIR", tmp_video):
                k_default = compute_pass2_cache_key("nhl26")
                k_explicit_false = compute_pass2_cache_key("nhl26", artifact_mode=False)
        self.assertEqual(k_default, k_explicit_false)

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
        # Phase 4: pre-Phase-2 files lack the telemetry block entirely.
        self.assertIsNone(loaded.sampling_telemetry)

    def test_pre_phase4_segments_json_loads_with_default_timing_fields(self) -> None:
        """Phase 4: files written by Phase-2/3 ingests have a
        pass1_sampling_telemetry block with only the Phase-2 fields
        (decoded_frame_count / sampled_frame_count / etc.) — no
        decode_ms / classify_ms / viterbi_ms / elapsed_pass1_ms /
        pass1_cache_hit. The loader's `SamplingTelemetry(**raw_tele)`
        call must accept the partial dict and default the new fields
        to safe zero-equivalents."""
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "segments.json"
            # Pre-Phase-4 telemetry block: Phase-2 fields only.
            payload = {
                "version": "nhl26",
                "pass1_cache_key": "sha256:test",
                "video_path": "/v.mkv",
                "video_sha256": "abc",
                "pass1_config": {"sample_fps": 1, "min_run_to_open": 2,
                                 "max_outliers_within": 1, "min_segment_seconds": 3.0},
                "segments": [],
                "frame_classifications": [],
                "pass1_sampling_telemetry": {
                    "decoded_frame_count": 1800,
                    "sampled_frame_count": 60,
                    "frames_with_missing_pts": 0,
                    "max_source_pts_jump_within_sample_interval": 1.02,
                    "sample_period_seconds": 1.0,
                },
            }
            path.write_text(json.dumps(payload))
            loaded = load_segments_json(path)
        # Phase-2 fields round-trip.
        self.assertIsNotNone(loaded.sampling_telemetry)
        self.assertEqual(loaded.sampling_telemetry.decoded_frame_count, 1800)
        self.assertEqual(loaded.sampling_telemetry.sampled_frame_count, 60)
        # Phase-4 fields default cleanly.
        self.assertEqual(loaded.sampling_telemetry.decode_ms, 0.0)
        self.assertEqual(loaded.sampling_telemetry.classify_ms, 0.0)
        self.assertEqual(loaded.sampling_telemetry.viterbi_ms, 0.0)
        self.assertEqual(loaded.sampling_telemetry.elapsed_pass1_ms, 0.0)
        self.assertFalse(loaded.sampling_telemetry.pass1_cache_hit)


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

        # 2. classifier build stub — returns a sentinel; _run_pass1 stubbed
        # to bypass engine dispatch entirely and return canned segments.
        self._classifier_patcher = mock.patch.object(
            orch_module, "_build_classifier", return_value=object(),
        )
        self._classifier_patcher.start()

        # classify_video / build_segments stubs kept for completeness; the
        # real dispatch is short-circuited via _run_pass1 below so engine
        # selection (viterbi vs run_length) never runs against fake input.
        self._classify_patcher = mock.patch.object(
            orch_module, "classify_video", return_value=[],
        )
        self._classify_patcher.start()
        self._build_patcher = mock.patch.object(
            orch_module, "build_segments",
            return_value=self.segments_classified,
        )
        self._build_patcher.start()

        # _run_pass1 is the engine dispatch point; patch it so the tests
        # stay seconds-fast regardless of which engine nhl26.yaml selects.
        # side_effect reads self.segments_classified at call time so
        # test_force_pass1_cascades_to_pass2_invalidation can mutate it.
        def _fake_run_pass1(video_path, classifier_legacy, p1cfg, version):
            from video_ingest.pass1_classify import SamplingTelemetry
            return [], self.segments_classified, "legacy-passthrough-v0-video", SamplingTelemetry()

        self._run_pass1_patcher = mock.patch.object(
            orch_module, "_run_pass1", side_effect=_fake_run_pass1,
        )
        self._run_pass1_patcher.start()

        # 3. ffmpeg stub
        def fake_ffmpeg(video_path, out_dir, start_seconds, end_seconds, fps):
            out_dir.mkdir(parents=True, exist_ok=True)
            (out_dir / "00001.png").write_bytes(_VALID_PNG_BYTES)
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
        self._run_pass1_patcher.stop()
        self._ffmpeg_patcher.stop()
        self._tmp.cleanup()

    def _run(self, **kwargs):
        # Default to artifact_mode=True so the mocked `_ffmpeg_extract`
        # path runs. The in-memory provider (the Phase-3c default) calls
        # av.open() on the source video, which doesn't exist in this
        # fixture. Tests that specifically exercise mode-flip semantics
        # pass artifact_mode= explicitly.
        kwargs.setdefault("artifact_mode", True)
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

    def test_phase4_sampling_telemetry_fresh_vs_cache_hit(self) -> None:
        """Phase 4: IngestResult.sampling_telemetry follows the cache-hit
        truth model — fresh runs expose populated *_ms fields with
        pass1_cache_hit=False; cache hits expose zeroed fields with
        pass1_cache_hit=True (never the stored fresh-run values).

        Part B extension: also assert the ingest_timings.json sidecar
        is emitted with the expected six-field shape on both passes."""
        r1 = self._run()  # fresh
        self.assertIsNotNone(r1.sampling_telemetry)
        self.assertFalse(r1.sampling_telemetry.pass1_cache_hit)
        # _run_pass1 is mocked via _fake_run_pass1 → returns a default
        # SamplingTelemetry() with all timing fields at 0.0 (no real work
        # ran). We can only assert "the orchestrator populated the field
        # at all"; the real timing assertions happen in the live ingest
        # measurement in Commit 5.
        self.assertEqual(r1.sampling_telemetry.elapsed_pass1_ms, 0.0)

        # Part B: sidecar present, six expected keys, pass1_cache_hit=False
        # on the fresh pass. Direct CLI usage (run_id is None in this
        # test harness) writes the unscoped path.
        sidecar = self.output_root / self.fake_sha / "ingest_timings.json"
        self.assertTrue(sidecar.exists(), f"ingest_timings.json missing at {sidecar}")
        payload1 = json.loads(sidecar.read_text())
        self.assertEqual(
            set(payload1.keys()),
            {
                "pass1_decode_ms",
                "pass1_classify_ms",
                "pass1_viterbi_ms",
                "pass1_ms",
                "pass2_ms",
                "pass1_cache_hit",
            },
        )
        self.assertFalse(payload1["pass1_cache_hit"])

        r2 = self._run()  # cache hit
        self.assertIsNotNone(r2.sampling_telemetry)
        self.assertTrue(r2.sampling_telemetry.pass1_cache_hit)
        # Cache-hit run MUST zero the timing fields — even though the
        # on-disk segments.json carries the fresh-run telemetry block,
        # the in-memory result must NOT surface those stale values.
        self.assertEqual(r2.sampling_telemetry.elapsed_pass1_ms, 0.0)
        self.assertEqual(r2.sampling_telemetry.decode_ms, 0.0)
        self.assertEqual(r2.sampling_telemetry.classify_ms, 0.0)
        self.assertEqual(r2.sampling_telemetry.viterbi_ms, 0.0)

        # Part B: sidecar overwritten with cache-hit values. All
        # pass1_*_ms fields == 0; pass1_cache_hit=True. pass2_ms may
        # also be ~0 here because Pass-2 hits cache too in the mocked
        # harness (no zeroing applied; analytics filter heuristically).
        payload2 = json.loads(sidecar.read_text())
        self.assertTrue(payload2["pass1_cache_hit"])
        self.assertEqual(payload2["pass1_ms"], 0.0)
        self.assertEqual(payload2["pass1_decode_ms"], 0.0)
        self.assertEqual(payload2["pass1_classify_ms"], 0.0)
        self.assertEqual(payload2["pass1_viterbi_ms"], 0.0)

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

    def test_pass2_artifact_mode_flip_emits_tailored_cache_mismatch(self) -> None:
        """Phase 3c: when the only manifest-introspectable attribute that
        differs is ``artifact_mode``, the raised CacheMismatch must name
        the field by name and lead with the reuse-cache remediation
        (re-pass the previous flag), with `--force-pass2` as a secondary
        option. Exercises both flip directions.

        The cache-key check runs before extract_segments, so the second
        invocation in each direction never reaches the InMemoryFrameProvider
        path that would `av.open` the (non-existent) fake video."""
        # Direction 1: stored=True → run with False. Primary fix: --pass2-artifacts.
        self._run(artifact_mode=True)  # writes manifest with True (mocked)
        with self.assertRaises(CacheMismatch) as ctx:
            self._run(artifact_mode=False)
        msg = str(ctx.exception)
        self.assertIn("artifact_mode", msg)
        self.assertIn("--pass2-artifacts", msg)
        self.assertIn("--force-pass2", msg)
        # Reuse-cache hint must come BEFORE force-regenerate.
        self.assertLess(msg.index("--pass2-artifacts"), msg.index("--force-pass2"))

        # Direction 2: stored=False → run with True. Primary fix: --no-pass2-artifacts.
        # Manually rewrite the manifest's artifact_mode + recompute the
        # pass2_cache_key to simulate a cache that was written under
        # artifact_mode=False, without actually running InMemoryFrameProvider
        # against the fake video.
        manifest = self.output_root / self.fake_sha / PASS2_MANIFEST_FILENAME
        data = json.loads(manifest.read_text())
        data["artifact_mode"] = False
        data["pass2_cache_key"] = compute_pass2_cache_key("nhl26", artifact_mode=False)
        manifest.write_text(json.dumps(data))

        with self.assertRaises(CacheMismatch) as ctx:
            self._run(artifact_mode=True)
        msg = str(ctx.exception)
        self.assertIn("artifact_mode", msg)
        self.assertIn("--no-pass2-artifacts", msg)
        self.assertIn("--force-pass2", msg)
        self.assertLess(msg.index("--no-pass2-artifacts"), msg.index("--force-pass2"))

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


def test_state_machine_drift_invalidates_pass1():
    """Phase 1: editing state machine YAML cascades to a Pass-1 cache mismatch."""
    from video_ingest.pass1_classify import compute_pass1_cache_key
    from game_ocr.state_machine import CONFIGS_DIR as SM_DIR
    # Engine-aware (S5.4): explicit viterbi exercises the v1 path; viterbi_v2 reads
    # the unversioned YAML. Test the v1 path here — v2 has its own coverage below.
    base = compute_pass1_cache_key("nhl26", "viterbi")
    sm_path = SM_DIR / "nhl26-v1.yaml"
    original = sm_path.read_bytes()
    try:
        sm_path.write_bytes(original + b"\n# touched\n")
        after = compute_pass1_cache_key("nhl26", "viterbi")
        assert after != base
    finally:
        sm_path.write_bytes(original)


def test_state_machine_drift_invalidates_pass1_v2():
    """v2 engine cache key reads nhl26.yaml directly (no -v1 suffix)."""
    from video_ingest.pass1_classify import compute_pass1_cache_key
    from game_ocr.state_machine import CONFIGS_DIR as SM_DIR
    base = compute_pass1_cache_key("nhl26", "viterbi_v2")
    sm_path = SM_DIR / "nhl26.yaml"
    original = sm_path.read_bytes()
    try:
        sm_path.write_bytes(original + b"\n# touched\n")
        after = compute_pass1_cache_key("nhl26", "viterbi_v2")
        assert after != base
    finally:
        sm_path.write_bytes(original)


def test_regex_priors_drift_invalidates_pass1_v2():
    """v2 cache key includes regex_priors YAML — editing it invalidates."""
    from video_ingest.pass1_classify import compute_pass1_cache_key
    from game_ocr.state_machine import CONFIGS_DIR as SM_DIR
    base = compute_pass1_cache_key("nhl26", "viterbi_v2")
    yaml_path = SM_DIR / "nhl26_regex_priors.yaml"
    original = yaml_path.read_bytes()
    try:
        yaml_path.write_bytes(original + b"\n# touched\n")
        after = compute_pass1_cache_key("nhl26", "viterbi_v2")
        assert after != base
    finally:
        yaml_path.write_bytes(original)


def test_weights_drift_invalidates_pass1():
    """Phase 1: editing the v1 weights JSON cascades to a Pass-1 cache mismatch."""
    import pytest
    from video_ingest.pass1_classify import compute_pass1_cache_key
    base = compute_pass1_cache_key("nhl26", "viterbi")
    weights = Path(__file__).resolve().parents[2] / "game_ocr" / "game_ocr" / "weights" / "nhl26-screen-classifier-v1.json"
    if not weights.exists():
        pytest.skip("weights not installed")
    original = weights.read_bytes()
    try:
        weights.write_bytes(original + b"\n")
        after = compute_pass1_cache_key("nhl26", "viterbi")
        assert after != base
    finally:
        weights.write_bytes(original)


def test_run_pass1_rejects_unknown_engine():
    """Phase 1: an unknown engine value must raise ValueError, not silently fall through."""
    import pytest
    from unittest.mock import MagicMock
    from video_ingest.orchestrator import _run_pass1
    from video_ingest.pass1_classify import Pass1Config

    cfg = Pass1Config(engine="vittirbi")  # typo'd value
    with pytest.raises(ValueError) as excinfo:
        _run_pass1(Path("/nonexistent.mkv"), MagicMock(), cfg, "nhl26")
    assert "vittirbi" in str(excinfo.value)


if __name__ == "__main__":
    unittest.main()
