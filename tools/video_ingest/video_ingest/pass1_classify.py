"""Pass 1: segment a video into screen-type windows.

Decodes the input video at a coarse 1 fps via ffmpeg piped to a
raw-BGR stream (no disk hit). For each sampled frame we run the
hybrid classifier; the resulting (sample_idx, screen_type, color_score)
table is then collapsed into segments via an N-consecutive-frame
window with K-frame outlier tolerance.

We trust source video PTS only at segment boundary time: a sample
index N at 1 fps corresponds to source-video time N seconds (start
of that second). Pass 2 takes those boundaries (with a small padding)
back to ffmpeg as `-ss`/`-to` to do the dense extraction.

`Segment.start_seconds` and `end_seconds` are inclusive sample-time
bounds. A 1-frame segment covers `[t, t+1)` in source video time.
"""

from __future__ import annotations

import json
import subprocess
import sys
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Callable, Iterator

import numpy as np

from game_ocr.classifier import (
    UNKNOWN_SCREEN,
    Classifier,
    ClassifyResult,
)


@dataclass
class Pass1Config:
    sample_fps: float = 1.0
    min_run_to_open: int = 3
    max_outliers_within: int = 1
    min_segment_seconds: float = 3.0


@dataclass
class FrameClassification:
    index: int
    seconds: float
    screen_type: str
    color_score: float
    color_class: str
    anchor_text: str


@dataclass
class Segment:
    start_index: int          # inclusive
    end_index: int            # inclusive
    start_seconds: float      # inclusive (start_index / sample_fps)
    end_seconds: float        # inclusive (end_index / sample_fps)
    screen_type: str
    frame_count: int
    mean_color_score: float


def _iter_raw_bgr_frames(
    video_path: Path,
    sample_fps: float,
    width: int = 1920,
    height: int = 1080,
) -> Iterator[np.ndarray]:
    """Stream BGR frames from ffmpeg at `sample_fps`. Each yielded frame
    is a (height, width, 3) np.uint8 array. Caller is responsible for
    not retaining frames across loop iterations beyond what they need."""
    cmd = [
        "ffmpeg", "-v", "error",
        "-i", str(video_path),
        "-vf", f"fps={sample_fps},scale={width}:{height}",
        "-f", "rawvideo",
        "-pix_fmt", "bgr24",
        "pipe:1",
    ]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE)
    assert proc.stdout is not None
    frame_size = width * height * 3
    try:
        while True:
            buf = proc.stdout.read(frame_size)
            if not buf or len(buf) < frame_size:
                break
            yield np.frombuffer(buf, dtype=np.uint8).reshape(height, width, 3)
    finally:
        proc.stdout.close()
        proc.wait()
        if proc.returncode != 0:
            raise RuntimeError(f"ffmpeg exited {proc.returncode} for {video_path}")


def classify_video(
    video_path: Path,
    classifier: Classifier,
    config: Pass1Config,
    *,
    on_frame: Callable[[FrameClassification], None] | None = None,
) -> list[FrameClassification]:
    """Run classifier on every Pass-1-sampled frame. Returns the full
    per-frame table. `on_frame` is a progress hook (called once per frame).
    """
    out: list[FrameClassification] = []
    for idx, frame in enumerate(_iter_raw_bgr_frames(video_path, config.sample_fps)):
        r: ClassifyResult = classifier.classify(frame)
        rec = FrameClassification(
            index=idx,
            seconds=idx / config.sample_fps,
            screen_type=r.screen_type,
            color_score=r.color_score,
            color_class=r.color_class,
            anchor_text=r.anchor_text,
        )
        out.append(rec)
        if on_frame is not None:
            on_frame(rec)
    return out


def build_segments(
    classifications: list[FrameClassification],
    config: Pass1Config,
) -> list[Segment]:
    """Collapse per-frame classifications into segments.

    Algorithm:
      - Sweep frames in index order.
      - "Open" a segment when we see `min_run_to_open` consecutive
        frames of the same non-UNKNOWN screen_type within a small
        window. The opening run includes any prior unknown frames as
        leading-edge slack (they belong to the segment-before).
      - Inside a segment, allow up to `max_outliers_within` frames of
        a different label; the (max_outliers + 1)th outlier closes the
        segment.
      - Drop segments shorter than `min_segment_seconds`.

    Pure function — no I/O — so unit testing it is straightforward.
    """
    if not classifications:
        return []
    n = len(classifications)
    period = 1.0 / config.sample_fps

    segments: list[Segment] = []
    open_type: str | None = None
    open_start: int | None = None
    outliers_in_open = 0
    last_match_idx: int | None = None
    run_color: list[float] = []

    def _finalize(end_idx: int) -> None:
        nonlocal open_type, open_start, outliers_in_open, last_match_idx, run_color
        if open_type is None or open_start is None or last_match_idx is None:
            return
        start = open_start
        end = last_match_idx
        seconds = (end - start + 1) * period
        if seconds + 1e-6 < config.min_segment_seconds:
            open_type = None
            open_start = None
            outliers_in_open = 0
            last_match_idx = None
            run_color = []
            return
        segments.append(Segment(
            start_index=start,
            end_index=end,
            start_seconds=start * period,
            end_seconds=(end + 1) * period,  # exclusive end for downstream slicing
            screen_type=open_type,
            frame_count=end - start + 1,
            mean_color_score=float(np.mean(run_color)) if run_color else 0.0,
        ))
        open_type = None
        open_start = None
        outliers_in_open = 0
        last_match_idx = None
        run_color = []

    for i, c in enumerate(classifications):
        if open_type is None:
            if c.screen_type == UNKNOWN_SCREEN:
                continue
            # Look ahead for a run of `min_run_to_open` same-type frames.
            run = 1
            for j in range(i + 1, min(i + config.min_run_to_open, n)):
                if classifications[j].screen_type == c.screen_type:
                    run += 1
                else:
                    break
            if run >= config.min_run_to_open:
                open_type = c.screen_type
                open_start = i
                outliers_in_open = 0
                last_match_idx = i
                run_color = [c.color_score]
        else:
            if c.screen_type == open_type:
                last_match_idx = i
                outliers_in_open = 0
                run_color.append(c.color_score)
            else:
                outliers_in_open += 1
                if outliers_in_open > config.max_outliers_within:
                    _finalize(end_idx=last_match_idx or i)
                    # The current frame may itself start a new segment;
                    # re-process by decrementing the loop.
                    # (Easier: continue and let the next iteration handle it.)
                    # Since we just closed, re-try this frame as an opener.
                    if c.screen_type != UNKNOWN_SCREEN:
                        run = 1
                        for j in range(i + 1, min(i + config.min_run_to_open, n)):
                            if classifications[j].screen_type == c.screen_type:
                                run += 1
                            else:
                                break
                        if run >= config.min_run_to_open:
                            open_type = c.screen_type
                            open_start = i
                            outliers_in_open = 0
                            last_match_idx = i
                            run_color = [c.color_score]

    _finalize(end_idx=n - 1)
    return segments


def write_segments_json(
    out_path: Path,
    classifications: list[FrameClassification],
    segments: list[Segment],
    video_sha256: str,
    video_path: Path,
    config: Pass1Config,
) -> None:
    payload = {
        "video_path": str(video_path),
        "video_sha256": video_sha256,
        "pass1_config": asdict(config),
        "segments": [asdict(s) for s in segments],
        "frame_classifications": [asdict(c) for c in classifications],
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, indent=2))


def load_segments_json(path: Path) -> tuple[str, list[Segment]]:
    """Load segments.json, return (video_sha256, segments)."""
    data = json.loads(path.read_text())
    segs = [Segment(**s) for s in data["segments"]]
    return data["video_sha256"], segs
