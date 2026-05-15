"""Two-pass video → OCR-frames orchestrator.

Public entry point: `ingest()`. Coordinates:
  1. Video probe (sha256, PTS health)
  2. Pass 1: 1-fps coarse classify → segments.json
  3. Pass 2: per-segment dense PNG extraction
  4. Optional dispatch to the existing ingest-ocr-cli for each segment

Idempotent: skips Pass 1 when segments.json already exists at the
sha-keyed output path; Pass 2 detects existing per-segment output dirs
and re-uses them (controlled by `force_pass2`).
"""

from __future__ import annotations

import json
import sys
import time
from dataclasses import asdict, dataclass
from pathlib import Path

import yaml

from video_ingest import gpu_libs
from video_ingest.dispatch import DispatchResult, dispatch_segments
from video_ingest.pass1_classify import (
    Pass1Config,
    Segment,
    build_segments,
    classify_video,
    load_segments_json,
    write_segments_json,
)
from video_ingest.pass2_extract import (
    Pass2Config,
    Pass2Result,
    extract_segments,
)
from video_ingest.pts import VideoProbe, probe as pts_probe
from video_ingest.version_detect import (
    UNKNOWN_VERSION,
    detect_version,
)


CONFIGS_DIR = Path(__file__).resolve().parent / "configs"


@dataclass
class IngestResult:
    probe: VideoProbe
    sha_root: Path
    pass1_segments: list[Segment]
    pass2_results: list[Pass2Result]
    elapsed_pass1: float
    elapsed_pass2: float
    dispatch_results: list[DispatchResult] | None = None
    elapsed_dispatch: float = 0.0


def _load_version_config(version: str) -> dict:
    path = CONFIGS_DIR / f"{version}.yaml"
    if not path.exists():
        raise FileNotFoundError(f"no version config at {path}")
    return yaml.safe_load(path.read_text())


def _build_classifier(version: str, use_gpu: bool):
    # Lazy import: keeps `--help` fast and lets CPU-only callers skip
    # the GPU lib preload entirely.
    if use_gpu:
        gpu_libs.preload(verbose=False)
    from game_ocr.classifier import Classifier, load_classifier_config
    cfg = load_classifier_config(version)
    return Classifier(cfg, use_gpu=use_gpu)


def ingest(
    video_path: Path,
    output_root: Path,
    *,
    version: str = "nhl26",
    use_gpu: bool = True,
    force_pass1: bool = False,
    force_pass2: bool = False,
    dispatch: bool = False,
    game_title_id: int | None = None,
    match_id: int | None = None,
    dispatch_dry_run: bool = False,
) -> IngestResult:
    """Run the full two-pass pipeline.

    Args:
      video_path: path to a video file (.mkv/.mp4)
      output_root: root directory; per-video subtree lives at output_root/<sha>/
      version: per-game UI config name (matches game_ocr classifier config)
      use_gpu: pass to the classifier
      force_pass1: re-run Pass 1 even if segments.json exists
      force_pass2: re-extract Pass 2 frames even if segment dirs exist
    """
    # 1. probe
    print(f"[ingest] probing {video_path.name}", file=sys.stderr)
    probe = pts_probe(video_path)
    print(
        f"[ingest] sha256={probe.sha256[:16]}…  "
        f"{probe.duration_seconds:.1f}s  {probe.width}x{probe.height}  "
        f"avg_fps={probe.avg_fps:.1f}  max_pts_jump={probe.pts_max_jump_seconds:.3f}s",
        file=sys.stderr,
    )

    sha_root = output_root / probe.sha256
    sha_root.mkdir(parents=True, exist_ok=True)
    segments_json = sha_root / "segments.json"

    # 1b. version detection (when requested). Auto-detects which game-UI
    # config to use; fails closed when no version matches so the user
    # can't accidentally feed an NHL 27 video through the NHL 26 config.
    if version == "auto":
        print(f"[ingest] version=auto → detecting from sampled frames", file=sys.stderr)
        guess = detect_version(
            video_path,
            duration_seconds=probe.duration_seconds,
            sample_count=5,
            use_gpu=use_gpu,
        )
        print(
            f"[ingest] detected version={guess.version}  "
            f"confidence={guess.confidence:.2f}  hits={guess.hit_counts}",
            file=sys.stderr,
        )
        if guess.version == UNKNOWN_VERSION:
            raise RuntimeError(
                "version_detect could not identify the game UI version. "
                "Re-run with an explicit --version (e.g. --version nhl26)."
            )
        version = guess.version

    # 2. load version config
    vcfg = _load_version_config(version)
    p1cfg = Pass1Config(
        sample_fps=float(vcfg["pass1"]["sample_fps"]),
        min_run_to_open=int(vcfg["pass1"]["min_run_to_open"]),
        max_outliers_within=int(vcfg["pass1"]["max_outliers_within"]),
        min_segment_seconds=float(vcfg["pass1"]["min_segment_seconds"]),
    )
    p2cfg = Pass2Config(
        window_padding_seconds=float(vcfg["pass2"]["window_padding_seconds"]),
        sample_rates={str(k): float(v) for k, v in vcfg["pass2"]["sample_rates"].items()},
        extract_screens=set(str(s) for s in vcfg["extract_screens"]),
    )

    # 3. Pass 1 (cached)
    elapsed_pass1 = 0.0
    if segments_json.exists() and not force_pass1:
        print(f"[pass1] cache hit at {segments_json}", file=sys.stderr)
        _, segments = load_segments_json(segments_json)
    else:
        classifier = _build_classifier(version, use_gpu=use_gpu)
        t0 = time.perf_counter()
        cls_list = classify_video(video_path, classifier, p1cfg)
        segments = build_segments(cls_list, p1cfg)
        elapsed_pass1 = time.perf_counter() - t0
        write_segments_json(
            segments_json,
            classifications=cls_list,
            segments=segments,
            video_sha256=probe.sha256,
            video_path=video_path,
            config=p1cfg,
        )
        print(
            f"[pass1] {len(cls_list)} frames classified, "
            f"{len(segments)} segments emitted in {elapsed_pass1:.1f}s",
            file=sys.stderr,
        )
        for s in segments:
            print(
                f"  seg  {s.start_seconds:6.1f}s..{s.end_seconds:6.1f}s  "
                f"{s.screen_type:30s}  ({s.frame_count} fr, color={s.mean_color_score:.2f})",
                file=sys.stderr,
            )

    # 4. Pass 2 (per-segment ffmpeg extraction)
    pass2_root = sha_root / "pass2"
    t0 = time.perf_counter()
    if force_pass2 and pass2_root.exists():
        import shutil
        shutil.rmtree(pass2_root)
    if pass2_root.exists() and any(pass2_root.iterdir()) and not force_pass2:
        print(f"[pass2] cache hit at {pass2_root}", file=sys.stderr)
        # Reconstruct Pass2Result list from what's on disk so the
        # caller still gets a usable summary.
        pass2_results: list[Pass2Result] = []
        for i, seg in enumerate(segments):
            if seg.screen_type not in p2cfg.extract_screens:
                continue
            from video_ingest.pass2_extract import segment_dir_name
            seg_dir = pass2_root / segment_dir_name(i, seg)
            if not seg_dir.exists():
                continue
            n = len(list(seg_dir.glob("*.png")))
            pass2_results.append(Pass2Result(
                segment_index=i,
                segment=seg,
                directory=seg_dir,
                frame_count=n,
                sample_fps=p2cfg.sample_rates.get(seg.screen_type, 1.0),
                start_seconds=seg.start_seconds,
                end_seconds=seg.end_seconds,
            ))
    else:
        pass2_results = extract_segments(
            video_path=video_path,
            segments=segments,
            config=p2cfg,
            pass2_root=pass2_root,
            video_duration_seconds=probe.duration_seconds,
        )
    elapsed_pass2 = time.perf_counter() - t0
    total_frames = sum(r.frame_count for r in pass2_results)
    print(
        f"[pass2] {len(pass2_results)} segments, "
        f"{total_frames} total frames extracted in {elapsed_pass2:.1f}s",
        file=sys.stderr,
    )

    # 5. Pass-2 manifest for downstream dispatch
    manifest_path = sha_root / "pass2_manifest.json"
    manifest_path.write_text(json.dumps([
        {
            "segment_index": r.segment_index,
            "screen_type": r.segment.screen_type,
            "directory": str(r.directory),
            "frame_count": r.frame_count,
            "sample_fps": r.sample_fps,
            "start_seconds": r.start_seconds,
            "end_seconds": r.end_seconds,
        }
        for r in pass2_results
    ], indent=2))

    # 6. Optional: fan out to ingest-ocr-cli per segment dir.
    dispatch_results: list[DispatchResult] | None = None
    elapsed_dispatch = 0.0
    if dispatch:
        if game_title_id is None:
            raise ValueError("dispatch=True requires game_title_id")
        t0 = time.perf_counter()
        dispatch_results = dispatch_segments(
            pass2_results,
            game_title_id=game_title_id,
            match_id=match_id,
            video_sha256=probe.sha256,
            dry_run=dispatch_dry_run,
        )
        elapsed_dispatch = time.perf_counter() - t0
        ok = sum(1 for r in dispatch_results if r.returncode == 0)
        failed = sum(1 for r in dispatch_results if r.returncode != 0)
        print(
            f"[dispatch] {ok} ok, {failed} failed in {elapsed_dispatch:.1f}s",
            file=sys.stderr,
        )

    return IngestResult(
        probe=probe,
        sha_root=sha_root,
        pass1_segments=segments,
        pass2_results=pass2_results,
        elapsed_pass1=elapsed_pass1,
        elapsed_pass2=elapsed_pass2,
        dispatch_results=dispatch_results,
        elapsed_dispatch=elapsed_dispatch,
    )
