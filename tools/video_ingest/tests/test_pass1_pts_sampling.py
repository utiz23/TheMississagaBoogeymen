"""Tests for `iter_sampled_frames` — the PyAV-backed Pass-1 frame sampler
that attaches canonical container PTS to every emitted sample.

Run:
    PYTHONPATH=tools/game_ocr:tools/video_ingest \
        python3 -m pytest tools/video_ingest/tests/test_pass1_pts_sampling.py -v
"""
from __future__ import annotations

import shutil
import subprocess
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


if __name__ == "__main__":
    unittest.main()
