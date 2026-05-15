"""Video PTS health check + sha256 + duration via ffprobe.

ffmpeg pipelines downstream rely on monotonic PTS to map frame indices
back to source-video timestamps. OBS captures occasionally drop or
duplicate packets and produce non-monotonic PTS; that breaks the
`-copyts -fps_mode passthrough` flag combination we use in Pass 2. So
we sniff a prefix of the stream before committing to a long pipeline.

`probe(video_path)` is the single entry point. On failure it raises
`PtsHealthError` with a diagnostic message that names the offending
packet index — easy to point at when debugging an ingest.
"""

from __future__ import annotations

import hashlib
import json
import subprocess
from dataclasses import dataclass
from pathlib import Path


PROBE_PACKET_COUNT = 100  # first N video packets — enough to spot OBS-style drift


class PtsHealthError(RuntimeError):
    """Raised when the video stream's PTS isn't safe to feed to Pass 2."""


@dataclass(frozen=True)
class VideoProbe:
    path: Path
    sha256: str
    duration_seconds: float
    width: int
    height: int
    avg_fps: float
    pts_monotonic: bool
    pts_max_jump_seconds: float


def file_sha256(path: Path, chunk: int = 1 << 20) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        while True:
            buf = f.read(chunk)
            if not buf:
                break
            h.update(buf)
    return h.hexdigest()


def _ffprobe_stream(path: Path) -> dict:
    cmd = [
        "ffprobe", "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=width,height,avg_frame_rate,duration,nb_frames",
        "-show_entries", "format=duration",
        "-of", "json",
        str(path),
    ]
    res = subprocess.run(cmd, check=True, capture_output=True, text=True)
    return json.loads(res.stdout)


def _ffprobe_packets(path: Path, count: int) -> list[dict]:
    cmd = [
        "ffprobe", "-v", "error",
        "-select_streams", "v:0",
        "-read_intervals", "%+#" + str(count),
        "-show_entries", "packet=pts,pts_time,dts_time,duration_time",
        "-of", "json",
        str(path),
    ]
    res = subprocess.run(cmd, check=True, capture_output=True, text=True)
    data = json.loads(res.stdout)
    return data.get("packets", [])


def _parse_fps(s: str | None) -> float:
    if not s or s in ("0/0", "N/A"):
        return 0.0
    if "/" in s:
        num, den = s.split("/", 1)
        try:
            d = float(den)
            return float(num) / d if d != 0 else 0.0
        except ValueError:
            return 0.0
    try:
        return float(s)
    except ValueError:
        return 0.0


def probe(video_path: Path) -> VideoProbe:
    """Compute sha256, fetch stream metadata, sniff PTS health.

    Raises:
      PtsHealthError if the stream has non-monotonic PTS or a packet-to-
      packet PTS jump exceeding 5 × avg_frame_period (a heuristic for
      "this video has a discontinuity that will break extraction").
      Missing PTS metadata is allowed (some containers don't emit
      packet-level pts_time on the first read).
    """
    p = video_path.resolve()
    if not p.exists():
        raise FileNotFoundError(p)

    sha = file_sha256(p)
    info = _ffprobe_stream(p)
    if not info.get("streams"):
        raise PtsHealthError(f"no video stream in {p}")
    stream = info["streams"][0]
    fmt = info.get("format", {})
    duration = float(stream.get("duration") or fmt.get("duration") or 0.0)
    width = int(stream["width"])
    height = int(stream["height"])
    avg_fps = _parse_fps(stream.get("avg_frame_rate"))

    packets = _ffprobe_packets(p, PROBE_PACKET_COUNT)
    # Monotonicity is checked on DTS (decode order), not PTS. With
    # B-frames present, presentation timestamps re-order — that's
    # normal. DTS must be monotonic for any valid stream. PTS jumps
    # are detected separately after sorting.
    monotonic = True
    prev_dts: float | None = None
    pts_values: list[float] = []
    for i, pkt in enumerate(packets):
        dts_s = pkt.get("dts_time")
        if dts_s not in (None, "N/A"):
            try:
                dts = float(dts_s)
                if prev_dts is not None and dts < prev_dts:
                    monotonic = False
                    raise PtsHealthError(
                        f"non-monotonic DTS at packet {i}: {prev_dts} -> {dts} in {p.name}"
                    )
                prev_dts = dts
            except ValueError:
                pass
        pts_s = pkt.get("pts_time")
        if pts_s not in (None, "N/A"):
            try:
                pts_values.append(float(pts_s))
            except ValueError:
                pass

    # Detect frame-drop discontinuities: after sorting PTS, the largest
    # gap should be ~ one frame period. 5× that suggests a drop.
    avg_period = 1.0 / avg_fps if avg_fps > 0 else 1.0 / 30.0
    max_jump = 0.0
    if len(pts_values) > 1:
        pts_values.sort()
        for i in range(1, len(pts_values)):
            jump = pts_values[i] - pts_values[i - 1]
            if jump > max_jump:
                max_jump = jump
    if max_jump > 5.0 * avg_period:
        raise PtsHealthError(
            f"PTS jump {max_jump:.3f}s exceeds 5x avg frame period "
            f"({5 * avg_period:.3f}s) in first {PROBE_PACKET_COUNT} packets of {p.name}"
        )

    return VideoProbe(
        path=p,
        sha256=sha,
        duration_seconds=duration,
        width=width,
        height=height,
        avg_fps=avg_fps,
        pts_monotonic=monotonic,
        pts_max_jump_seconds=max_jump,
    )
