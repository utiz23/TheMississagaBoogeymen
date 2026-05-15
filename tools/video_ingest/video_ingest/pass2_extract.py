"""Pass 2: dense PNG extraction for each Pass-1 segment.

Per-segment ffmpeg invocation. Each segment becomes its own
sub-directory containing zero-padded PNG frames. The directory name
encodes segment index + screen type so downstream `periodFromPath`
fallbacks and `cutoff_event_recovery` filename regexes can pick up
ordering cheaply.

We use `-ss` BEFORE `-i` for keyframe-aligned fast seek, plus `-to`
for the segment end. Padding around the Pass-1 boundary is configured
in the version YAML (defaults to 1s) to defend against the 1-fps
sample granularity in Pass 1.
"""

from __future__ import annotations

import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

from video_ingest.pass1_classify import Segment


@dataclass
class Pass2Config:
    window_padding_seconds: float = 1.0
    sample_rates: dict[str, float] = None  # type: ignore[assignment]
    extract_screens: set[str] = None  # type: ignore[assignment]


def _ffmpeg_extract(
    video_path: Path,
    out_dir: Path,
    start_seconds: float,
    end_seconds: float,
    fps: float,
) -> int:
    """Run ffmpeg to extract PNGs into out_dir. Returns frame count."""
    out_dir.mkdir(parents=True, exist_ok=True)
    pattern = str(out_dir / "%05d.png")
    cmd = [
        "ffmpeg", "-v", "error", "-y",
        # Seek BEFORE -i for fast keyframe-aligned start.
        "-ss", f"{start_seconds:.3f}",
        "-to", f"{end_seconds:.3f}",
        "-i", str(video_path),
        "-vf", f"fps={fps}",
        "-fps_mode", "passthrough",
        pattern,
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError(
            f"ffmpeg failed (rc={res.returncode}) for {out_dir}\n{res.stderr}"
        )
    return len(list(out_dir.glob("*.png")))


def segment_dir_name(seg_idx: int, seg: Segment) -> str:
    """Standardized per-segment directory name. Encodes segment index
    plus screen_type so listings sort chronologically."""
    return f"seg-{seg_idx:03d}-{seg.screen_type}"


@dataclass
class Pass2Result:
    segment_index: int
    segment: Segment
    directory: Path
    frame_count: int
    sample_fps: float
    start_seconds: float
    end_seconds: float


def extract_segments(
    video_path: Path,
    segments: list[Segment],
    config: Pass2Config,
    pass2_root: Path,
    video_duration_seconds: float | None = None,
) -> list[Pass2Result]:
    """Extract every segment whose screen_type is in `extract_screens`.
    Skipped segments still get an entry in the returned list (frame_count=0)
    so the orchestrator can log them."""
    if config.sample_rates is None or config.extract_screens is None:
        raise ValueError("Pass2Config.sample_rates and extract_screens must be set")

    out: list[Pass2Result] = []
    pass2_root.mkdir(parents=True, exist_ok=True)

    for i, seg in enumerate(segments):
        if seg.screen_type not in config.extract_screens:
            continue
        fps = float(config.sample_rates.get(seg.screen_type, 1.0))
        pad = config.window_padding_seconds
        start = max(0.0, seg.start_seconds - pad)
        end = seg.end_seconds + pad
        if video_duration_seconds is not None:
            end = min(end, video_duration_seconds)
        if end <= start:
            continue

        seg_dir = pass2_root / segment_dir_name(i, seg)
        frame_count = _ffmpeg_extract(video_path, seg_dir, start, end, fps)
        out.append(Pass2Result(
            segment_index=i,
            segment=seg,
            directory=seg_dir,
            frame_count=frame_count,
            sample_fps=fps,
            start_seconds=start,
            end_seconds=end,
        ))
        print(
            f"  seg {i:03d}  {seg.screen_type:30s}  {start:6.1f}s..{end:6.1f}s  "
            f"@ {fps}fps  →  {frame_count} frames  ({seg_dir.relative_to(pass2_root.parent)})",
            file=sys.stderr,
        )

    return out
