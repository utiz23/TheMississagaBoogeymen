"""Tests for `iter_sampled_frames` — the PyAV-backed Pass-1 frame sampler
that attaches canonical container PTS to every emitted sample.

Run:
    PYTHONPATH=tools/game_ocr:tools/video_ingest \
        python3 -m pytest tools/video_ingest/tests/test_pass1_pts_sampling.py -v
"""
from __future__ import annotations

import shutil
import subprocess
import time
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory


def _ffmpeg_available() -> bool:
    return shutil.which("ffmpeg") is not None


def _pyav_available() -> bool:
    try:
        import av  # noqa: F401
        return True
    except ImportError:
        return False


def _synthesize_cfr(out_path: Path, duration_s: int, fps: int) -> None:
    """Synthesize a deterministic CFR video via ffmpeg-lavfi. Black frames
    at 192x108 (small enough to keep the test fast) for `duration_s`
    seconds at `fps` constant-frame-rate."""
    cmd = [
        "ffmpeg", "-y", "-v", "error",
        "-f", "lavfi",
        "-i", f"color=color=black:size=192x108:rate={fps}:duration={duration_s}",
        "-pix_fmt", "yuv420p",
        "-c:v", "libx264",
        "-preset", "ultrafast",
        str(out_path),
    ]
    subprocess.run(cmd, check=True, capture_output=True)


def _synthesize_vfr_with_gap(
    out_path: Path,
    duration_s: int,
    fps: int,
    gap_start_s: int,
    gap_len_s: int,
) -> None:
    """Synthesize a video with a deliberate timing gap mid-stream. ffmpeg's
    `select` filter drops frames in `[gap_start_s, gap_start_s + gap_len_s)`
    while preserving original PTS for the rest, simulating dropped-frame
    VFR behavior. The resulting container has a presentation-time hole
    spanning `gap_len_s` seconds.
    """
    select_expr = f"not(between(t,{gap_start_s},{gap_start_s + gap_len_s}))"
    cmd = [
        "ffmpeg", "-y", "-v", "error",
        "-f", "lavfi",
        "-i", f"color=color=black:size=192x108:rate={fps}:duration={duration_s}",
        "-vf", f"select='{select_expr}'",
        # Don't reset PTS — let the gap propagate to the container.
        "-vsync", "vfr",
        "-pix_fmt", "yuv420p",
        "-c:v", "libx264",
        "-preset", "ultrafast",
        str(out_path),
    ]
    subprocess.run(cmd, check=True, capture_output=True)


@unittest.skipUnless(_ffmpeg_available(), "ffmpeg not on PATH")
@unittest.skipUnless(_pyav_available(), "PyAV not installed")
class TestIterSampledFramesCfr(unittest.TestCase):
    """Golden-path: a CFR source sampled at 1 fps yields exactly one frame
    per source-second, with `source_time_seconds` ≈ `sample_index`. This
    is the regression contract the refactor must preserve — match 250 and
    most existing OBS captures are CFR, so canonical PTS should equal the
    index-derived time the old code produced (within rounding).
    """

    DURATION_S = 5
    SOURCE_FPS = 30
    SAMPLE_FPS = 1.0

    def test_emits_one_sample_per_source_second(self):
        from video_ingest.pass1_classify import (
            SampledFrame,
            SamplingTelemetry,
            iter_sampled_frames,
        )

        with TemporaryDirectory() as tmp:
            video = Path(tmp) / "cfr.mp4"
            _synthesize_cfr(video, self.DURATION_S, self.SOURCE_FPS)

            tele = SamplingTelemetry()
            samples = list(iter_sampled_frames(
                video, self.SAMPLE_FPS,
                width=192, height=108, telemetry=tele,
            ))

        # Sample count: 1 fps × 5 seconds = 5 samples (one per second tick).
        self.assertEqual(len(samples), self.DURATION_S)

        # First sample is at t≈0 (the first decoded frame past the tick at 0.0).
        self.assertAlmostEqual(samples[0].source_time_seconds, 0.0, places=3)

        # Each subsequent sample is ≈ 1.0s after the previous one.
        for i in range(1, len(samples)):
            delta = samples[i].source_time_seconds - samples[i - 1].source_time_seconds
            self.assertAlmostEqual(delta, 1.0, places=2,
                msg=f"sample {i}: expected ~1.0s gap, got {delta}")

        # sample_index is dense and increasing.
        self.assertEqual([s.sample_index for s in samples], list(range(self.DURATION_S)))

        # source_pts strictly increases (presentation order, PyAV reorders B-frames).
        for i in range(1, len(samples)):
            self.assertGreater(samples[i].source_pts, samples[i - 1].source_pts)

        # decode_order_index increments by ≈ SOURCE_FPS / SAMPLE_FPS between samples.
        for i in range(1, len(samples)):
            gap = samples[i].decode_order_index - samples[i - 1].decode_order_index
            self.assertEqual(gap, self.SOURCE_FPS,
                msg=f"sample {i}: decode_order gap {gap}, expected {self.SOURCE_FPS}")

    def test_telemetry_reflects_cfr_source(self):
        from video_ingest.pass1_classify import (
            SamplingTelemetry,
            iter_sampled_frames,
        )

        with TemporaryDirectory() as tmp:
            video = Path(tmp) / "cfr.mp4"
            _synthesize_cfr(video, self.DURATION_S, self.SOURCE_FPS)

            tele = SamplingTelemetry()
            _ = list(iter_sampled_frames(
                video, self.SAMPLE_FPS,
                width=192, height=108, telemetry=tele,
            ))

        # Every input frame was decoded (we don't pre-filter at decode time).
        self.assertEqual(tele.decoded_frame_count, self.DURATION_S * self.SOURCE_FPS)

        # One emitted sample per source second.
        self.assertEqual(tele.sampled_frame_count, self.DURATION_S)

        # No frame had a missing PTS (libx264 CFR output always has PTS).
        self.assertEqual(tele.frames_with_missing_pts, 0)

        # Max observed jump between adjacent samples ≈ sample period.
        # On a clean CFR source we expect ≤ ~1.05s (one period plus a hair
        # of float rounding); anything materially above means the sampler
        # is over-skipping.
        self.assertLess(
            tele.max_source_pts_jump_within_sample_interval,
            1.0 / self.SAMPLE_FPS * 1.1,
            msg=f"unexpected jump on CFR source: {tele.max_source_pts_jump_within_sample_interval}",
        )

        # Sample period field captures the requested rate verbatim.
        self.assertAlmostEqual(tele.sample_period_seconds, 1.0 / self.SAMPLE_FPS)

    def test_image_shape_and_dtype(self):
        from video_ingest.pass1_classify import iter_sampled_frames

        with TemporaryDirectory() as tmp:
            video = Path(tmp) / "cfr.mp4"
            _synthesize_cfr(video, self.DURATION_S, self.SOURCE_FPS)

            samples = list(iter_sampled_frames(
                video, self.SAMPLE_FPS,
                width=192, height=108,
            ))

        # Every frame is the requested resolution + BGR uint8.
        for s in samples:
            self.assertEqual(s.image.shape, (108, 192, 3))
            self.assertEqual(str(s.image.dtype), "uint8")
            self.assertTrue(s.image.flags["C_CONTIGUOUS"])


class TestSamplingTelemetryDefaults(unittest.TestCase):
    """Phase-4 fields default to zero-equivalents so legacy code paths
    constructing SamplingTelemetry() without timing knowledge still get
    safe values (e.g., the cache-hit path returns SamplingTelemetry()
    + pass1_cache_hit=True and the other fields stay at 0.0/False)."""

    def test_phase4_timing_fields_default_zero(self):
        from video_ingest.pass1_classify import SamplingTelemetry

        tele = SamplingTelemetry()
        # Phase-2 fields stay at safe defaults.
        self.assertEqual(tele.decoded_frame_count, 0)
        self.assertEqual(tele.sampled_frame_count, 0)
        self.assertEqual(tele.frames_with_missing_pts, 0)
        self.assertEqual(tele.max_source_pts_jump_within_sample_interval, 0.0)
        self.assertEqual(tele.sample_period_seconds, 0.0)
        # Phase-4 additions.
        self.assertEqual(tele.decode_ms, 0.0)
        self.assertEqual(tele.classify_ms, 0.0)
        self.assertEqual(tele.viterbi_ms, 0.0)
        self.assertEqual(tele.elapsed_pass1_ms, 0.0)
        self.assertFalse(tele.pass1_cache_hit)


@unittest.skipUnless(_ffmpeg_available(), "ffmpeg not on PATH")
@unittest.skipUnless(_pyav_available(), "PyAV not installed")
class TestIterSampledFramesDecodeTimer(unittest.TestCase):
    """Phase 4: `iter_sampled_frames` accumulates wall time spent inside
    its own decode loop into `telemetry.decode_ms`. Python generators are
    synchronous — the consumer's time between yields must NOT be counted.
    """

    DURATION_S = 3
    SOURCE_FPS = 30
    SAMPLE_FPS = 1.0

    def test_decode_ms_positive_and_excludes_consumer_time(self):
        from video_ingest.pass1_classify import (
            SamplingTelemetry,
            iter_sampled_frames,
        )

        with TemporaryDirectory() as tmp:
            video = Path(tmp) / "cfr.mp4"
            _synthesize_cfr(video, self.DURATION_S, self.SOURCE_FPS)

            tele = SamplingTelemetry()
            # Consumer deliberately stalls 50ms between yields. The
            # `accum += ... ; yield` ordering inside iter_sampled_frames
            # means each stall lands during a yield suspension — decode_ms
            # must NOT include it.
            samples = []
            for sf in iter_sampled_frames(
                video, self.SAMPLE_FPS,
                width=192, height=108, telemetry=tele,
            ):
                samples.append(sf)
                time.sleep(0.05)  # 50ms × 3 samples = 150ms of consumer work

        self.assertEqual(len(samples), self.DURATION_S)
        # Decode actually ran, so the field is populated.
        self.assertGreater(tele.decode_ms, 0.0)
        # Decode time on a 3s × 30fps black-frame clip is small (well
        # under 1 second even on a slow runner). Crucially it must be
        # less than the ~150ms of consumer stalls if those were leaking
        # in. We assert decode_ms < 150ms as a coarse upper bound that
        # proves consumer time is excluded.
        self.assertLess(
            tele.decode_ms, 150.0,
            f"decode_ms={tele.decode_ms}ms — looks like consumer stalls are "
            f"leaking into the decode timer (expected <150ms; consumer "
            f"stalled ~150ms total via time.sleep)",
        )


@unittest.skipUnless(_ffmpeg_available(), "ffmpeg not on PATH")
@unittest.skipUnless(_pyav_available(), "PyAV not installed")
class TestIterSampledFramesVfr(unittest.TestCase):
    """A source with a deliberate mid-stream gap should:
      - emit at sample_index without holes (we never skip a slot)
      - surface the gap in `max_source_pts_jump_within_sample_interval`
      - emit canonical PTS that reflects the real source time of each
        kept frame, not the index-derived approximation
    This is the regression test for the architecture review's
    "time drift on non-ideal captures" risk.
    """

    DURATION_S = 6
    SOURCE_FPS = 30
    SAMPLE_FPS = 1.0
    GAP_START_S = 2  # drop seconds [2, 4)
    GAP_LEN_S = 2

    def test_drift_visible_in_telemetry_and_sample_times(self):
        from video_ingest.pass1_classify import (
            SamplingTelemetry,
            iter_sampled_frames,
        )

        with TemporaryDirectory() as tmp:
            video = Path(tmp) / "vfr.mp4"
            _synthesize_vfr_with_gap(
                video, self.DURATION_S, self.SOURCE_FPS,
                self.GAP_START_S, self.GAP_LEN_S,
            )

            tele = SamplingTelemetry()
            samples = list(iter_sampled_frames(
                video, self.SAMPLE_FPS,
                width=192, height=108, telemetry=tele,
            ))

        # sample_index is dense (no holes — we emit the next available
        # frame past each missed tick).
        self.assertEqual(
            [s.sample_index for s in samples],
            list(range(len(samples))),
            "sample_index should never skip slots even when the source has a gap",
        )

        # The drift metric must surface a jump materially larger than
        # one sample period. With a 2-second gap and 1s sampling, the
        # observed max jump should be ≥ ~2s (it could be larger if the
        # sampling tick lines up such that the gap spans more than one
        # interval).
        self.assertGreater(
            tele.max_source_pts_jump_within_sample_interval,
            1.0 / self.SAMPLE_FPS * 1.5,
            f"VFR gap not surfaced in telemetry: "
            f"max_jump={tele.max_source_pts_jump_within_sample_interval}",
        )

        # Source times must be monotonically non-decreasing — the canonical
        # contract holds even across the gap.
        for i in range(1, len(samples)):
            self.assertGreaterEqual(
                samples[i].source_time_seconds,
                samples[i - 1].source_time_seconds,
            )


@unittest.skipUnless(_pyav_available(), "PyAV not installed")
class TestIterSampledFramesMissingPts(unittest.TestCase):
    """If the decoder produces a frame with `pts is None` we must fail
    closed: Pass-1 cannot reason about source time without PTS. This is
    a pure unit test against a stubbed container — no fixture needed.
    """

    def test_missing_pts_raises_pts_health_error(self):
        from unittest.mock import MagicMock, patch

        from video_ingest.pass1_classify import iter_sampled_frames
        from video_ingest.pts import PtsHealthError

        # Fake stream with a valid time_base, then a single frame with
        # pts=None to trigger the fail-closed path on the first decode.
        from fractions import Fraction

        bad_frame = MagicMock()
        bad_frame.pts = None

        fake_stream = MagicMock()
        fake_stream.time_base = Fraction(1, 30)
        fake_stream.start_time = 0

        fake_container = MagicMock()
        fake_container.streams.video = [fake_stream]
        # First decoded frame has pts=None, so the fail-closed check
        # fires before any reformat / image conversion path runs.
        fake_container.decode.return_value = iter([bad_frame])

        with patch("av.open", return_value=fake_container):
            with self.assertRaises(PtsHealthError) as cm:
                list(iter_sampled_frames(Path("/dev/null"), 1.0,
                                         width=192, height=108))

        self.assertIn("PTS", str(cm.exception))


class TestSegmentBuilderUsesSourceTime(unittest.TestCase):
    """build_segments should consume `FrameClassification.source_time_seconds`
    when present, so segment bounds reflect real source-PTS not the
    enumerate index. This is a pure unit test — no real video.
    """

    def test_canonical_pts_overrides_index_derived(self):
        from video_ingest.pass1_classify import (
            FrameClassification,
            Pass1Config,
            build_segments,
        )

        # Construct 5 frames at sample_fps=1.0 but with VFR-shaped source
        # times: [0.0, 1.0, 3.5, 4.5, 5.5] — a 1.5s gap between sample 1
        # and sample 2. Index-derived seconds would say start=1.0 for the
        # second sample; canonical PTS must say start=3.5.
        source_times = [0.0, 1.0, 3.5, 4.5, 5.5]
        cls_list = [
            FrameClassification(
                index=i, seconds=t,
                screen_type="pre_game_lobby_state_2",
                color_score=0.5, color_class="", anchor_text="",
                sample_index=i, source_pts=int(t * 30000),
                source_time_seconds=t, decode_order_index=i,
            )
            for i, t in enumerate(source_times)
        ]

        cfg = Pass1Config(
            sample_fps=1.0,
            min_run_to_open=3,
            min_segment_seconds=0.0,  # disable the duration gate
        )
        segments = build_segments(cls_list, cfg)
        self.assertEqual(len(segments), 1)
        seg = segments[0]
        self.assertEqual(seg.start_index, 0)
        self.assertEqual(seg.end_index, 4)
        # Segment bounds derive from source PTS, not index*period.
        self.assertEqual(seg.start_seconds, 0.0)
        # Exclusive end = last frame's source time + one sample period
        # (no frame past index 4 exists).
        self.assertAlmostEqual(seg.end_seconds, 5.5 + 1.0, places=6)

    def test_fallback_when_source_time_seconds_is_none(self):
        from video_ingest.pass1_classify import (
            FrameClassification,
            Pass1Config,
            build_segments,
        )

        # Legacy-shaped FrameClassification (no canonical fields). The
        # fallback must produce identical results to the pre-refactor
        # `index * period` formula so cached pre-PTS segments.json files
        # keep loading cleanly.
        cls_list = [
            FrameClassification(
                index=i, seconds=float(i),
                screen_type="pre_game_lobby_state_2",
                color_score=0.5, color_class="", anchor_text="",
                # New fields explicitly None.
                sample_index=None, source_pts=None,
                source_time_seconds=None, decode_order_index=None,
            )
            for i in range(5)
        ]
        cfg = Pass1Config(
            sample_fps=1.0,
            min_run_to_open=3,
            min_segment_seconds=0.0,
        )
        segments = build_segments(cls_list, cfg)
        self.assertEqual(len(segments), 1)
        seg = segments[0]
        self.assertEqual(seg.start_seconds, 0.0)
        self.assertEqual(seg.end_seconds, 5.0)  # (end + 1) * period


if __name__ == "__main__":
    unittest.main()
