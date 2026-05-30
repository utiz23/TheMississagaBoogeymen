"""Phase 3a tests: PngFrameProvider + InMemoryFrameProvider.

Run:
    PYTHONPATH=tools/game_ocr:tools/video_ingest \
        python3 -m pytest tools/video_ingest/tests/test_frame_provider.py -v
"""
from __future__ import annotations

import shutil
import subprocess
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

import numpy as np


def _ffmpeg_available() -> bool:
    return shutil.which("ffmpeg") is not None


def _pyav_available() -> bool:
    try:
        import av  # noqa: F401
        return True
    except ImportError:
        return False


def _cv2_available() -> bool:
    try:
        import cv2  # noqa: F401
        return True
    except ImportError:
        return False


def _synthesize_cfr(out_path: Path, duration_s: int, fps: int) -> None:
    """Generate a CFR mp4 via ffmpeg-lavfi. Same helper shape as
    test_pass1_pts_sampling.py."""
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


def _make_png_dir(out_dir: Path, count: int, *, size: tuple[int, int] = (108, 192, 3)) -> None:
    """Write `count` zero-padded PNGs of solid gray (varying so they're
    distinguishable). Mirrors `_ffmpeg_extract`'s output shape."""
    import cv2

    out_dir.mkdir(parents=True, exist_ok=True)
    for i in range(1, count + 1):
        img = np.full(size, fill_value=i * 7 % 255, dtype=np.uint8)
        path = out_dir / f"{i:05d}.png"
        ok = cv2.imwrite(str(path), img)
        assert ok, f"failed to write {path}"


# ─── PngFrameProvider ─────────────────────────────────────────────────────────


@unittest.skipUnless(_cv2_available(), "cv2 not available")
class TestPngFrameProvider(unittest.TestCase):

    def test_iterates_zero_padded_pngs_in_index_order(self):
        from video_ingest.frame_provider import PngFrameProvider

        with TemporaryDirectory() as tmp:
            d = Path(tmp)
            _make_png_dir(d, count=5)

            provider = PngFrameProvider(d, fps=1.0)
            frames = list(provider.iter_frames())

        self.assertEqual(len(frames), 5)
        for i, fr in enumerate(frames):
            self.assertEqual(fr.frame_index, i)
            # source_time_seconds is (file_index - 1) * sample_period at fps=1
            # so frame 00001.png lands at t=0, 00002.png at t=1, ...
            self.assertAlmostEqual(fr.source_time_seconds, float(i))
            self.assertIsNone(fr.source_pts)
            self.assertEqual(fr.image.shape, (108, 192, 3))

    def test_ignores_non_index_files(self):
        from video_ingest.frame_provider import PngFrameProvider

        with TemporaryDirectory() as tmp:
            d = Path(tmp)
            _make_png_dir(d, count=3)
            # Sibling files that should NOT be enumerated.
            (d / "loadout_evidence.json").write_text("{}")
            (d / "thumbnail.png").write_bytes(b"")  # not NNNNN.png

            frames = list(PngFrameProvider(d, fps=1.0).iter_frames())

        self.assertEqual(len(frames), 3)

    def test_fps_drives_source_time(self):
        from video_ingest.frame_provider import PngFrameProvider

        with TemporaryDirectory() as tmp:
            d = Path(tmp)
            _make_png_dir(d, count=4)

            # At fps=2.0 each frame is a half-second apart.
            frames = list(PngFrameProvider(d, fps=2.0).iter_frames())

        self.assertEqual(
            [round(fr.source_time_seconds, 4) for fr in frames],
            [0.0, 0.5, 1.0, 1.5],
        )

    def test_fps_must_be_positive(self):
        from video_ingest.frame_provider import PngFrameProvider

        with TemporaryDirectory() as tmp:
            with self.assertRaises(ValueError):
                PngFrameProvider(Path(tmp), fps=0.0)
            with self.assertRaises(ValueError):
                PngFrameProvider(Path(tmp), fps=-1.0)

    def test_unreadable_png_fails_closed(self):
        from video_ingest.frame_provider import PngFrameProvider

        with TemporaryDirectory() as tmp:
            d = Path(tmp)
            _make_png_dir(d, count=2)
            # Corrupt one of the PNGs.
            (d / "00002.png").write_bytes(b"not a real png")

            with self.assertRaises(FileNotFoundError):
                list(PngFrameProvider(d, fps=1.0).iter_frames())


# ─── InMemoryFrameProvider ────────────────────────────────────────────────────


@unittest.skipUnless(_ffmpeg_available(), "ffmpeg not on PATH")
@unittest.skipUnless(_pyav_available(), "PyAV not installed")
class TestInMemoryFrameProvider(unittest.TestCase):
    """Bounded-segment decode on a synthesized CFR fixture. The provider
    must emit (a) the same frame count a PngFrameProvider would have
    yielded for the equivalent ffmpeg-extracted PNG dir, (b) canonical
    `source_time_seconds` matching the segment bounds, (c) the requested
    width × height after swscale reformat.
    """

    SOURCE_DURATION_S = 10
    SOURCE_FPS = 30
    SAMPLE_FPS = 1.0

    def test_bounded_segment_yields_expected_count_and_times(self):
        from video_ingest.frame_provider import InMemoryFrameProvider

        with TemporaryDirectory() as tmp:
            video = Path(tmp) / "cfr.mp4"
            _synthesize_cfr(video, self.SOURCE_DURATION_S, self.SOURCE_FPS)

            # Segment covers [3, 7) seconds (end is exclusive, matching
            # `Segment.end_seconds`'s convention and ffmpeg `-to`). At
            # 1 fps that's 4 ticks (t = 3, 4, 5, 6).
            provider = InMemoryFrameProvider(
                video,
                start_seconds=3.0,
                end_seconds=7.0,
                fps=self.SAMPLE_FPS,
                width=192,
                height=108,
            )
            frames = list(provider.iter_frames())

        self.assertEqual(len(frames), 4)
        for i, fr in enumerate(frames):
            self.assertEqual(fr.frame_index, i)
            self.assertAlmostEqual(fr.source_time_seconds, 3.0 + i, places=2)
            self.assertIsNotNone(fr.source_pts)
            self.assertEqual(fr.image.shape, (108, 192, 3))
            self.assertEqual(str(fr.image.dtype), "uint8")

    def test_full_video_when_bounds_cover_entire_duration(self):
        from video_ingest.frame_provider import InMemoryFrameProvider

        with TemporaryDirectory() as tmp:
            video = Path(tmp) / "cfr.mp4"
            _synthesize_cfr(video, self.SOURCE_DURATION_S, self.SOURCE_FPS)

            provider = InMemoryFrameProvider(
                video,
                start_seconds=0.0,
                end_seconds=float(self.SOURCE_DURATION_S),
                fps=self.SAMPLE_FPS,
                width=192,
                height=108,
            )
            frames = list(provider.iter_frames())

        # 10-second source at 1 fps with bounds [0, 10) yields 10 ticks
        # (t = 0, 1, 2, ..., 9). The decoder stops at the exclusive
        # boundary so t=10 itself isn't emitted.
        self.assertEqual(len(frames), self.SOURCE_DURATION_S)
        self.assertAlmostEqual(frames[0].source_time_seconds, 0.0, places=3)
        self.assertAlmostEqual(
            frames[-1].source_time_seconds,
            float(self.SOURCE_DURATION_S - 1),
            places=2,
        )

    def test_invalid_bounds_raise(self):
        from video_ingest.frame_provider import InMemoryFrameProvider

        with TemporaryDirectory() as tmp:
            video = Path(tmp) / "cfr.mp4"
            _synthesize_cfr(video, 3, self.SOURCE_FPS)

            with self.assertRaises(ValueError):
                InMemoryFrameProvider(video, 5.0, 3.0, fps=1.0)  # end < start
            with self.assertRaises(ValueError):
                InMemoryFrameProvider(video, 0.0, 1.0, fps=0.0)  # fps <= 0


@unittest.skipUnless(_ffmpeg_available(), "ffmpeg not on PATH")
@unittest.skipUnless(_pyav_available(), "PyAV not installed")
@unittest.skipUnless(_cv2_available(), "cv2 not available")
class TestPngVsInMemoryParity(unittest.TestCase):
    """The two providers MUST agree on what's structurally equivalent:
    frame count, frame_index sequence, internal sample period. They MUST
    DIFFER on absolute `source_time_seconds` — PNG extraction discards
    the original PTS, so PngFrameProvider can only report time-since-
    segment-start while InMemoryFrameProvider carries canonical source
    time. Both are useful for the typed_v1 extractors (which key off
    `frame_index`, not absolute time) but neither contract should silently
    bleed into the other.
    """

    SOURCE_DURATION_S = 6
    SOURCE_FPS = 30
    SAMPLE_FPS = 1.0

    def test_structural_parity_with_documented_time_divergence(self):
        from video_ingest.frame_provider import (
            InMemoryFrameProvider,
            PngFrameProvider,
        )

        SEGMENT_START = 1.0
        SEGMENT_END = 4.0

        with TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            video = tmp_path / "cfr.mp4"
            _synthesize_cfr(video, self.SOURCE_DURATION_S, self.SOURCE_FPS)

            # Extract PNGs via ffmpeg the same way Pass-2 does (`-ss`,
            # `-to`, `-vf fps=N`, `-fps_mode passthrough`) so the PNG
            # provider sees real Pass-2 output.
            png_dir = tmp_path / "png-seg"
            png_dir.mkdir()
            subprocess.run(
                [
                    "ffmpeg", "-v", "error", "-y",
                    "-ss", f"{SEGMENT_START:.3f}",
                    "-to", f"{SEGMENT_END:.3f}",
                    "-i", str(video),
                    "-vf", f"fps={self.SAMPLE_FPS}",
                    "-fps_mode", "passthrough",
                    str(png_dir / "%05d.png"),
                ],
                check=True,
                capture_output=True,
            )

            png_frames = list(PngFrameProvider(png_dir, fps=self.SAMPLE_FPS).iter_frames())
            mem_frames = list(
                InMemoryFrameProvider(
                    video,
                    start_seconds=SEGMENT_START,
                    end_seconds=SEGMENT_END,
                    fps=self.SAMPLE_FPS,
                    width=192,
                    height=108,
                ).iter_frames()
            )

        # Frame count agrees (exclusive end on both sides).
        self.assertEqual(len(png_frames), len(mem_frames))
        # frame_index is a dense 0..N-1 sequence in both providers.
        self.assertEqual(
            [fr.frame_index for fr in png_frames],
            list(range(len(png_frames))),
        )
        self.assertEqual(
            [fr.frame_index for fr in mem_frames],
            list(range(len(mem_frames))),
        )
        # Internal sample period (delta between consecutive emit times)
        # agrees — both providers tick at sample_period regardless of
        # what their absolute zero point is.
        sample_period = 1.0 / self.SAMPLE_FPS
        for prov_frames in (png_frames, mem_frames):
            for i in range(1, len(prov_frames)):
                delta = prov_frames[i].source_time_seconds - prov_frames[i - 1].source_time_seconds
                self.assertAlmostEqual(delta, sample_period, places=2)
        # Documented divergence: PngFrameProvider starts at t=0 (PTS
        # was lost at PNG extraction); InMemoryFrameProvider starts at
        # the segment's canonical SEGMENT_START.
        self.assertAlmostEqual(png_frames[0].source_time_seconds, 0.0, places=2)
        self.assertAlmostEqual(mem_frames[0].source_time_seconds, SEGMENT_START, places=2)
        # PNG provider's source_pts must be None for every frame
        # (extraction discarded it); in-memory provider's must be set.
        self.assertTrue(all(fr.source_pts is None for fr in png_frames))
        self.assertTrue(all(fr.source_pts is not None for fr in mem_frames))


if __name__ == "__main__":
    unittest.main()
