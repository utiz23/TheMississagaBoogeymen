"""Bulk-extract candidate frames from one or more videos for the screen-
classifier v2 labeling pass.

For each input video, samples one frame every N seconds and writes a PNG to
`tools/game_ocr/calibration/extras/_inbox/<video_stem>/cand-t{seconds}.png`,
plus a per-video manifest JSON listing the candidates. Optionally deduplicates
exact-thumbnail-match frames so the operator doesn't have to re-skip long
static screens (post-game stats, locker-room dwell, etc).

This is the cheap Phase-A path: uniform sampling, no Pass-1 invocation.
For the full S2 design (Pass-1-guided heuristic sampling with strong-color
unknown_or_transition selection), see the plan; that requires more infra
than the minimum-labeling proving phase actually needs.

Usage:
    # Extract from a single video at 30s intervals
    python3 tools/game_ocr/scripts/bulk_extract_label_candidates.py \\
        --video /mnt/k/NHL/NHL26/match\\ 968/2026-05-22_17-21-34.mkv \\
        --interval 30

    # Extract from every video under /mnt/k/NHL/NHL26 recursively
    python3 tools/game_ocr/scripts/bulk_extract_label_candidates.py \\
        --root /mnt/k/NHL/NHL26 \\
        --interval 30

    # Tighter sample (10s) without dedup
    python3 tools/game_ocr/scripts/bulk_extract_label_candidates.py \\
        --root /mnt/k/NHL/NHL26 \\
        --interval 10 --no-dedup

Output: PNGs land in `tools/game_ocr/calibration/extras/_inbox/`; the
labeler picks them up via `label_state_machine_corpus.py --from-inbox`.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
GAME_OCR = REPO_ROOT / "tools" / "game_ocr"
DEFAULT_INBOX = GAME_OCR / "calibration" / "extras" / "_inbox"

VIDEO_SUFFIXES = (".mkv", ".mp4")


def _probe_duration_sec(video: Path) -> float | None:
    """Return the video's duration in seconds via ffprobe, or None on failure."""
    r = subprocess.run(
        [
            "ffprobe", "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            str(video),
        ],
        capture_output=True, text=True,
    )
    if r.returncode != 0:
        return None
    try:
        return float(r.stdout.strip())
    except ValueError:
        return None


def _extract_frame_at(video: Path, seconds: float, out_path: Path) -> bool:
    """Extract one frame at the given timestamp; return True on success.
    Scaled to 1920x1080 so all candidates share the classifier's input shape.
    """
    out_path.parent.mkdir(parents=True, exist_ok=True)
    r = subprocess.run(
        [
            "ffmpeg", "-nostdin", "-v", "error",
            "-ss", f"{seconds:.3f}", "-i", str(video),
            "-frames:v", "1",
            "-vf", "scale=1920:1080",
            "-y", str(out_path),
        ],
        capture_output=True, text=True,
    )
    return r.returncode == 0 and out_path.exists()


def _thumbnail_sha(png: Path, size: int = 32) -> str | None:
    """Compute a sha256 of the PNG resized to size×size grayscale. Cheap
    near-perceptual dedup: identical static screens captured at different
    timestamps collide. Not robust to subtle frame jitter — by design (we
    want to keep visually-distinct frames the operator might want to label
    separately).
    """
    tmp = png.with_suffix(".thumb.tmp.png")
    r = subprocess.run(
        [
            "ffmpeg", "-nostdin", "-v", "error",
            "-i", str(png),
            "-vf", f"scale={size}:{size},format=gray",
            "-y", str(tmp),
        ],
        capture_output=True, text=True,
    )
    if r.returncode != 0 or not tmp.exists():
        return None
    try:
        h = hashlib.sha256(tmp.read_bytes()).hexdigest()
    finally:
        tmp.unlink(missing_ok=True)
    return h


def _iter_videos(root: Path | None, single: Path | None) -> list[Path]:
    """Resolve --root and --video into a deduped list of video paths."""
    out: list[Path] = []
    if single is not None:
        if single.is_file() and single.suffix.lower() in VIDEO_SUFFIXES:
            out.append(single.resolve())
        else:
            print(f"[bulk] --video {single} is not a video file", file=sys.stderr)
    if root is not None:
        if not root.is_dir():
            print(f"[bulk] --root {root} is not a directory", file=sys.stderr)
        else:
            for p in sorted(root.rglob("*")):
                if p.is_file() and p.suffix.lower() in VIDEO_SUFFIXES:
                    out.append(p.resolve())
    # Dedup while preserving order
    seen: set[str] = set()
    uniq: list[Path] = []
    for p in out:
        key = str(p)
        if key not in seen:
            seen.add(key)
            uniq.append(p)
    return uniq


def _slug(s: str) -> str:
    return re.sub(r"[^a-zA-Z0-9._-]+", "_", s).strip("_") or "video"


def extract_one(
    video: Path,
    inbox: Path,
    interval_sec: float,
    dedup: bool,
) -> dict[str, object]:
    """Extract candidate frames from a single video. Returns a manifest dict."""
    duration = _probe_duration_sec(video)
    if duration is None:
        print(f"[bulk] ffprobe failed for {video}; skipping", file=sys.stderr)
        return {"video": str(video), "ok": False, "reason": "ffprobe_failed"}

    out_dir = inbox / _slug(video.stem)
    out_dir.mkdir(parents=True, exist_ok=True)

    thumbs: dict[str, str] = {}  # sha256 → first-seen filename
    written: list[dict[str, object]] = []
    dropped_dupes = 0
    skipped_existing = 0

    t = 0.0
    while t < duration:
        out_name = f"cand-t{int(t):05d}.png"
        out_path = out_dir / out_name
        if out_path.exists():
            skipped_existing += 1
            t += interval_sec
            continue
        if not _extract_frame_at(video, t, out_path):
            print(f"[bulk] ffmpeg failed at t={t:.1f}s of {video.name}", file=sys.stderr)
            t += interval_sec
            continue
        if dedup:
            sig = _thumbnail_sha(out_path)
            if sig is not None and sig in thumbs:
                out_path.unlink(missing_ok=True)
                dropped_dupes += 1
                t += interval_sec
                continue
            if sig is not None:
                thumbs[sig] = out_name
        written.append({"t_sec": round(t, 3), "filename": out_name})
        t += interval_sec

    manifest = {
        "video": str(video),
        "video_duration_sec": round(duration, 3),
        "interval_sec": interval_sec,
        "dedup_enabled": dedup,
        "candidates": written,
        "dropped_dupes": dropped_dupes,
        "skipped_existing": skipped_existing,
    }
    manifest_path = out_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2))
    print(
        f"[bulk] {video.name}: wrote {len(written)} (dupes_dropped={dropped_dupes}, "
        f"existing_skipped={skipped_existing}, dur={duration:.0f}s) → {out_dir}",
        file=sys.stderr,
    )
    return manifest


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument(
        "--video",
        type=Path,
        default=None,
        help="Single video file to extract from.",
    )
    ap.add_argument(
        "--root",
        type=Path,
        default=None,
        help="Walk this directory recursively, extracting from every .mkv/.mp4.",
    )
    ap.add_argument(
        "--inbox",
        type=Path,
        default=DEFAULT_INBOX,
        help=f"Output directory (default: {DEFAULT_INBOX.relative_to(REPO_ROOT)}).",
    )
    ap.add_argument(
        "--interval",
        type=float,
        default=30.0,
        help="Sample interval in seconds (default 30.0).",
    )
    ap.add_argument(
        "--no-dedup",
        action="store_true",
        help="Disable exact-thumbnail dedup (keep every sampled frame).",
    )
    args = ap.parse_args()

    if args.video is None and args.root is None:
        ap.print_usage()
        print("error: must provide --video or --root", file=sys.stderr)
        return 2

    videos = _iter_videos(args.root, args.video)
    if not videos:
        print("[bulk] no videos found", file=sys.stderr)
        return 1

    args.inbox.mkdir(parents=True, exist_ok=True)
    total_written = 0
    for v in videos:
        m = extract_one(v, args.inbox, args.interval, dedup=not args.no_dedup)
        candidates = m.get("candidates", [])
        if isinstance(candidates, list):
            total_written += len(candidates)
    print(f"[bulk] done. {len(videos)} video(s), {total_written} candidate(s) written.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
