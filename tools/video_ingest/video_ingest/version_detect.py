"""Game-UI version detection for the video ingest pipeline.

Each EA NHL release moves the UI around — different tab labels,
restructured panels, different shotcharts. The classifier configs in
`tools/game_ocr/game_ocr/configs/classifier/<version>.yaml` are
calibrated per-version. Feeding NHL 27 frames to an NHL 26 classifier
silently misclassifies; we'd rather bail with a clear diagnostic.

This module probes a handful of frames from a video and matches their
top-bar OCR text against per-version anchor sets. The detector is
intentionally narrow: it picks ONE of the configured versions or
returns `unknown_version` so the orchestrator can stop the pipeline
and prompt for `--game-version` instead of guessing.

Adding a new version is a config-only change: add an entry to
`VERSION_ANCHORS` below and a corresponding classifier config YAML.
"""

from __future__ import annotations

import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np


# Per-version anchor strings expected in the top-bar OCR of any NHL
# title's main lobby. Substrings are lowercased; the matcher uses
# `fuzzy_contains` (Levenshtein-1) so single-character OCR noise is
# tolerated. Anchors should be ROBUST: present on the main menu /
# matchmaking screen of MOST captures, not unique to one match.
#
# NHL 27 entries are stubs — the framework picks them up once anchor
# text from real NHL 27 captures is added.
VERSION_ANCHORS: dict[str, tuple[str, ...]] = {
    "nhl26": (
        "world of chel",
        "loadouts",
        "rewards",
        "customize",
        "season pass",
        "eashl",
    ),
    "nhl27": (
        # TODO: populate when NHL 27 launches and we have capture samples
    ),
}


UNKNOWN_VERSION = "unknown_version"


@dataclass(frozen=True)
class FrameEvidence:
    """Per-sampled-frame audit record (WS3). Lets an operator see exactly
    WHY a version was chosen or rejected: the OCR text the anchor matcher
    saw, plus cheap full-frame visual signals (reused from the Visual
    Prefilter). Captured for every successfully-decoded sampled frame."""
    sampled_seconds: float
    ocr_text: str
    brightness: float
    log_blur: float
    edge_density: float


@dataclass(frozen=True)
class VersionGuess:
    version: str
    confidence: float
    hit_counts: dict[str, int]
    sampled_seconds: tuple[float, ...]
    # WS3: per-frame audit evidence. Empty when no frame decoded. Default
    # keeps older constructors/tests that don't pass it working.
    frame_evidence: tuple[FrameEvidence, ...] = ()


def _grab_frames(
    video_path: Path,
    timestamps: tuple[float, ...],
    width: int = 1920,
    height: int = 1080,
) -> list[tuple[float, np.ndarray]]:
    """Decode one frame at each `timestamps` value. Uses ffmpeg with -ss
    seek before -i for fast keyframe-aligned decode. Returns (timestamp,
    BGR ndarray) pairs so the caller can attribute per-frame evidence;
    timestamps whose decode failed are omitted."""
    frames: list[tuple[float, np.ndarray]] = []
    for ts in timestamps:
        cmd = [
            "ffmpeg", "-v", "error", "-y",
            "-ss", f"{ts:.3f}",
            "-i", str(video_path),
            "-vf", f"scale={width}:{height}",
            "-vframes", "1",
            "-f", "rawvideo",
            "-pix_fmt", "bgr24",
            "pipe:1",
        ]
        proc = subprocess.run(cmd, capture_output=True)
        if proc.returncode != 0 or len(proc.stdout) < width * height * 3:
            continue
        frame = np.frombuffer(proc.stdout[: width * height * 3], dtype=np.uint8).reshape(
            height, width, 3
        )
        frames.append((ts, frame))
    return frames


def detect_version(
    video_path: Path,
    *,
    duration_seconds: float,
    sample_count: int = 5,
    use_gpu: bool = True,
    min_hit_fraction: float = 0.20,
) -> VersionGuess:
    """Probe `sample_count` frames spread across the video, OCR a top
    region, count per-version anchor hits, return the best match.

    A version "wins" if its hit fraction (anchors found / anchors
    configured) across all sampled frames clears `min_hit_fraction`.
    Ties go to the version with more configured anchors (a richer
    anchor set is a higher-confidence config).
    """
    # Lazy imports — keeps CPU-only callers off the GPU init path.
    if use_gpu:
        from video_ingest import gpu_libs
        gpu_libs.preload(verbose=False)

    import sys as _sys
    repo_root = Path(__file__).resolve().parents[3]
    _sys.path.insert(0, str(repo_root / "tools" / "game_ocr"))
    from game_ocr.classifier import fuzzy_contains
    from game_ocr.ocr import RapidOCRBackend
    from game_ocr.utils import normalize_text
    from video_ingest.visual_prefilter.signals import compute_visual_signals

    # Sample timestamps: skip the first/last 5% to avoid title cards.
    if sample_count < 1:
        raise ValueError("sample_count must be ≥ 1")
    margin = duration_seconds * 0.05
    span = duration_seconds - 2 * margin
    if span <= 0:
        timestamps = (duration_seconds / 2,)
    else:
        timestamps = tuple(
            margin + (i + 1) * span / (sample_count + 1)
            for i in range(sample_count)
        )

    frames = _grab_frames(video_path, timestamps)
    if not frames:
        return VersionGuess(
            version=UNKNOWN_VERSION,
            confidence=0.0,
            hit_counts={v: 0 for v in VERSION_ANCHORS},
            sampled_seconds=timestamps,
            frame_evidence=(),
        )

    ocr = RapidOCRBackend(use_gpu=use_gpu)

    # Wider ROI than the classifier's anchor — capture the main-menu
    # tab bar which sits at y=0..40 and any subtitle below at y=40..120.
    # x is full-width so off-center version anchors are caught too.
    hit_counts: dict[str, int] = {v: 0 for v in VERSION_ANCHORS}
    seen_anchors: dict[str, set[str]] = {v: set() for v in VERSION_ANCHORS}
    # WS3: capture per-frame audit evidence as we go.
    frame_evidence: list[FrameEvidence] = []
    for ts, frame in frames:
        h, w = frame.shape[:2]
        roi = frame[: max(1, int(h * 0.20)), :]  # top 20% of frame
        lines = ocr.read(roi)
        text = " ".join(normalize_text(l.text) for l in lines if l.text).lower()
        # WS3: cheap full-frame visual signals for the audit trail (reuses
        # the Visual Prefilter). Best-effort — a signal failure must not
        # break detection.
        try:
            sig = compute_visual_signals(frame)
            brightness, log_blur, edge_density = (
                sig.brightness, sig.log_blur, sig.edge_density,
            )
        except Exception:  # noqa: BLE001 — evidence is non-critical
            brightness = log_blur = edge_density = float("nan")
        frame_evidence.append(FrameEvidence(
            sampled_seconds=ts,
            ocr_text=text,
            brightness=brightness,
            log_blur=log_blur,
            edge_density=edge_density,
        ))
        for version, anchors in VERSION_ANCHORS.items():
            for anchor in anchors:
                if fuzzy_contains(text, anchor, max_distance=1):
                    hit_counts[version] += 1
                    seen_anchors[version].add(anchor)
    frame_evidence_t = tuple(frame_evidence)

    # Score: distinct anchors hit / total configured per version.
    scores: dict[str, float] = {}
    for version, anchors in VERSION_ANCHORS.items():
        if not anchors:
            scores[version] = 0.0
            continue
        scores[version] = len(seen_anchors[version]) / len(anchors)

    # Pick best, tie-break by richer anchor set.
    best = sorted(
        scores.items(),
        key=lambda kv: (-kv[1], -len(VERSION_ANCHORS[kv[0]])),
    )[0]
    best_version, best_score = best

    if best_score < min_hit_fraction:
        return VersionGuess(
            version=UNKNOWN_VERSION,
            confidence=best_score,
            hit_counts=hit_counts,
            sampled_seconds=timestamps,
            frame_evidence=frame_evidence_t,
        )
    return VersionGuess(
        version=best_version,
        confidence=best_score,
        hit_counts=hit_counts,
        sampled_seconds=timestamps,
        frame_evidence=frame_evidence_t,
    )


if __name__ == "__main__":  # pragma: no cover
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("video", type=Path)
    parser.add_argument("--samples", type=int, default=5)
    args = parser.parse_args()
    if not args.video.exists():
        print(f"missing: {args.video}", file=sys.stderr)
        raise SystemExit(2)

    # Get duration via ffprobe (avoid importing pts.py to keep this
    # module light when used standalone).
    proc = subprocess.run(
        [
            "ffprobe", "-v", "error", "-show_entries",
            "format=duration", "-of", "default=noprint_wrappers=1:nokey=1",
            str(args.video),
        ],
        capture_output=True, text=True, check=True,
    )
    duration = float(proc.stdout.strip())

    guess = detect_version(args.video, duration_seconds=duration, sample_count=args.samples)
    print(f"version:    {guess.version}")
    print(f"confidence: {guess.confidence:.2f}")
    print(f"hits:       {guess.hit_counts}")
    print(f"sampled_ts: {[round(t, 1) for t in guess.sampled_seconds]}")
    print("evidence:")
    for ev in guess.frame_evidence:
        ocr_preview = ev.ocr_text[:100] + ("…" if len(ev.ocr_text) > 100 else "")
        print(
            f"  t={ev.sampled_seconds:7.1f}s  bright={ev.brightness:.2f} "
            f"blur={ev.log_blur:.2f} edge={ev.edge_density:.2f}  ocr={ocr_preview!r}"
        )
