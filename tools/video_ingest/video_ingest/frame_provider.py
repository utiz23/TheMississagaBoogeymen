"""Frame provider abstraction — Phase 3a scaffolding.

The architecture review at `docs/research/video-extraction-architecture-review-2026-05-28.md`
§"Phase 3" wants Pass-2's frame feed to be modal:

  - `artifact_mode=true`  — write PNGs to disk for review/debug.
  - `artifact_mode=false` — process frames in memory; only evidence
                            JSON is persisted.

This file is the seam where typed_v1 extractors will eventually read
frames from. Two implementations land in Phase 3a:

  - `PngFrameProvider(directory, fps)` — wraps the current glob+imread
    behavior. Used in `artifact_mode=true` (and as the back-compat path
    when a cached PNG-mode segment dir gets re-consumed).
  - `InMemoryFrameProvider(video_path, start_seconds, end_seconds, fps)`
    — uses PyAV's bounded-segment decode (see `iter_sampled_frames` in
    `pass1_classify.py`) to yield frames without touching disk.

Phase 3a ships the abstraction + tests + cache/config wiring; Phase 3b
will rewire `LoadoutSubjectBundle` + extractors to consume a
`FrameProvider` instead of a `bundle_dir: Path`. Until 3b lands, this
file is reachable but not yet on the hot path.
"""

from __future__ import annotations

import re
from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

import numpy as np


@dataclass
class FrameRecord:
    """One frame as seen by a `FrameProvider` consumer.

    `source_time_seconds` is the frame's canonical position in source-video
    time. For `PngFrameProvider` it's derived from the filename index
    (`index / fps`) — same approximation Pass-2's legacy code used. For
    `InMemoryFrameProvider` it's the actual container PTS in seconds, the
    canonical Phase-2 contract.

    `source_pts` is the raw PTS in the stream's `time_base` units when the
    provider has it (in-memory mode); `None` for PNG-on-disk providers
    where the original PTS was lost at extraction time.

    `frame_index` is the 0-based emit ordinal within this provider — what
    the legacy extractors call the "frame index" (matches `support_frame_ids`
    in evidence records).
    """
    image: np.ndarray  # (height, width, 3) uint8 BGR
    source_time_seconds: float
    source_pts: int | None
    frame_index: int


class FrameProvider(ABC):
    """Abstract source of `FrameRecord`s for one Pass-2 segment.

    Implementations must be safe to iterate exactly once; callers that
    need a second pass should materialise the iterator themselves.
    """

    @abstractmethod
    def iter_frames(self) -> Iterator[FrameRecord]:
        """Yield each frame for this segment in emit order."""
        raise NotImplementedError


# ─── PngFrameProvider ─────────────────────────────────────────────────────────


_PNG_INDEX_RE = re.compile(r"^(\d+)\.png$")


class PngFrameProvider(FrameProvider):
    """Reads pre-extracted PNG frames from a directory.

    Matches the existing `bundle_dir.glob("[0-9]*.png")` + `cv2.imread()`
    pattern in `loadout_evidence.py` and `lobby_evidence.py`. `frame_index`
    is the integer from the filename (5-digit zero-padded by Pass-2's
    `_ffmpeg_extract` → `00001.png`, `00002.png`, ...).

    `source_time_seconds` is derived from the filename index, NOT from
    container PTS — the PNG-extraction step in Pass-2's ffmpeg call
    discards source PTS. This matches the pre-Phase-3 semantics.

    Files that don't match the `NNNNN.png` shape are ignored (consistent
    with the existing glob pattern). Files that fail `cv2.imread` raise
    a `FileNotFoundError` — fail-closed so silent skips don't lie about
    the emitted frame count.
    """

    def __init__(
        self,
        directory: Path,
        fps: float,
        *,
        pattern: str = "[0-9]*.png",
    ) -> None:
        if fps <= 0:
            raise ValueError(f"fps must be > 0, got {fps}")
        self.directory = directory
        self.fps = fps
        self.pattern = pattern

    def _resolve_paths(self) -> list[tuple[int, Path]]:
        """Return (index, path) pairs sorted by index. Filenames that
        don't match `^\\d+\\.png$` are skipped — same selectivity as the
        legacy `[0-9]*.png` glob the loadout/lobby extractors use."""
        out: list[tuple[int, Path]] = []
        for p in sorted(self.directory.glob(self.pattern)):
            m = _PNG_INDEX_RE.match(p.name)
            if m is None:
                continue
            out.append((int(m.group(1)), p))
        out.sort()
        return out

    def iter_frames(self) -> Iterator[FrameRecord]:
        import cv2

        sample_period = 1.0 / self.fps
        for emit_index, (file_index, png_path) in enumerate(self._resolve_paths()):
            img = cv2.imread(str(png_path))
            if img is None:
                raise FileNotFoundError(
                    f"cv2.imread returned None for {png_path}; "
                    f"PngFrameProvider fails closed rather than silently "
                    f"skipping a frame the consumer expects"
                )
            yield FrameRecord(
                image=img,
                # `source_time_seconds` is filename-index-derived in PNG
                # mode — the original PTS is lost by `_ffmpeg_extract`'s
                # `-vf fps=N` resample.  Matches pre-Phase-3 semantics.
                source_time_seconds=(file_index - 1) * sample_period,
                source_pts=None,
                frame_index=emit_index,
            )


# ─── InMemoryFrameProvider ────────────────────────────────────────────────────


class InMemoryFrameProvider(FrameProvider):
    """PyAV-backed bounded-segment decode. Skips disk entirely.

    Wraps `iter_sampled_frames(video_path, fps, start_seconds, end_seconds)`
    in `pass1_classify.py` (extended in Phase 3a with bounded mode). The
    same fail-closed PtsHealthError behaviour applies — a non-monotonic
    or PTS-missing video would have been caught by `pts.probe()` at
    pipeline entry, but if anything slips through the iterator raises.

    The width/height kwargs control the swscale reformat target; default
    (1920, 1080) matches Pass-2's PNG-extraction resolution so the
    in-memory mode's frame is bit-comparable to the on-disk mode's
    frame at the same source-time tick.
    """

    def __init__(
        self,
        video_path: Path,
        start_seconds: float,
        end_seconds: float,
        fps: float,
        *,
        width: int = 1920,
        height: int = 1080,
    ) -> None:
        if fps <= 0:
            raise ValueError(f"fps must be > 0, got {fps}")
        if end_seconds < start_seconds:
            raise ValueError(
                f"end_seconds ({end_seconds}) must be >= start_seconds "
                f"({start_seconds})"
            )
        self.video_path = video_path
        self.start_seconds = start_seconds
        self.end_seconds = end_seconds
        self.fps = fps
        self.width = width
        self.height = height

    def iter_frames(self) -> Iterator[FrameRecord]:
        # Late import: keeps `frame_provider.py` importable without PyAV
        # installed at module-load time (matters for tests that pin
        # PngFrameProvider behaviour without an `av` wheel available).
        from video_ingest.pass1_classify import iter_sampled_frames

        for emit_index, sf in enumerate(
            iter_sampled_frames(
                self.video_path,
                self.fps,
                width=self.width,
                height=self.height,
                start_seconds=self.start_seconds,
                end_seconds=self.end_seconds,
            )
        ):
            yield FrameRecord(
                image=sf.image,
                source_time_seconds=sf.source_time_seconds,
                source_pts=sf.source_pts,
                frame_index=emit_index,
            )
