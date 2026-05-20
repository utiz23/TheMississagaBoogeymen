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

import sys
import time
from dataclasses import dataclass
from pathlib import Path

import yaml

from video_ingest import gpu_libs
from video_ingest.dispatch import DispatchResult, dispatch_segments
from video_ingest.pass1_classify import (
    CacheMismatch,
    MissingPass1Cache,
    Pass1Config,
    Segment,
    VIDEO_INGEST_CONFIGS_DIR,
    build_segments,
    classify_video,
    compute_pass1_cache_key,
    compute_segments_hash,
    load_segments_json,
    write_segments_json,
)
from video_ingest.pass2_extract import (
    PASS2_MANIFEST_FILENAME,
    Pass2Config,
    Pass2Result,
    compute_pass2_cache_key,
    extract_segments,
    load_pass2_manifest,
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


def _run_pass1(
    video_path: Path,
    classifier_legacy,
    p1cfg: Pass1Config,
    version: str,
) -> tuple[list, list[Segment]]:
    """Engine dispatch: returns (frame_classifications, segments).

    `engine="run_length"` (legacy): runs the HSV+anchor classifier per frame,
    then collapses to segments via the N-consecutive-frame rule.

    `engine="viterbi"` (Phase 1): runs the same anchor-text OCR per frame for
    audit, computes multi-signal FrameFeatures, then feeds them through the
    learned LR head + emission combiner + Viterbi decoder.
    """
    if p1cfg.engine == "viterbi":
        from game_ocr.emissions import EmissionWeights
        from game_ocr.frame_features import compute_frame_features
        from game_ocr.screen_classifier import load_screen_classifier
        from game_ocr.state_machine import load_state_machine
        from video_ingest.pass1_classify import (
            FrameClassification,
            _iter_raw_bgr_frames,
        )
        from video_ingest.pass1_segment import decode_segments

        sm = load_state_machine(version)
        if sm.sample_fps != p1cfg.sample_fps:
            raise RuntimeError(
                f"state machine sample_fps={sm.sample_fps} != Pass-1 config sample_fps={p1cfg.sample_fps}"
            )
        weights_path = (
            Path(__file__).resolve().parents[2] / "game_ocr" / "game_ocr" / "weights"
            / f"{version}-screen-classifier.json"
        )
        if not weights_path.exists():
            raise FileNotFoundError(
                f"missing learned screen classifier weights for {version}: {weights_path}\n"
                f"  Fix: run `python3 tools/game_ocr/scripts/train_screen_classifier.py --version {version}`"
            )
        clf = load_screen_classifier(weights_path, sm)
        cls_list: list = []
        feats_list = []
        for idx, frame in enumerate(_iter_raw_bgr_frames(video_path, p1cfg.sample_fps)):
            anchor_text = classifier_legacy._read_anchor(frame)
            feats = compute_frame_features(frame, anchor_text=anchor_text, state_machine=sm)
            feats_list.append(feats)
            # For audit / annotate.py compatibility, emit a FrameClassification
            # carrying the raw signals. screen_type stays unknown_or_transition
            # until the Viterbi pass assigns it below.
            cls_list.append(FrameClassification(
                index=idx,
                seconds=idx / p1cfg.sample_fps,
                screen_type="unknown_or_transition",
                color_score=0.0,
                color_class="",
                anchor_text=anchor_text,
            ))
        segments = decode_segments(
            features=feats_list,
            classifier=clf,
            state_machine=sm,
            weights=EmissionWeights(),
        )
        # Stamp the decoded state back onto the per-frame audit table.
        for seg in segments:
            for i in range(seg.start_index, seg.end_index + 1):
                cls_list[i] = FrameClassification(
                    index=cls_list[i].index,
                    seconds=cls_list[i].seconds,
                    screen_type=seg.screen_type,
                    color_score=cls_list[i].color_score,
                    color_class=cls_list[i].color_class,
                    anchor_text=cls_list[i].anchor_text,
                )
        return cls_list, segments
    elif p1cfg.engine == "run_length":
        cls_list = classify_video(video_path, classifier_legacy, p1cfg)
        segments = build_segments(cls_list, p1cfg)
        return cls_list, segments
    else:
        raise ValueError(
            f"unknown Pass-1 engine {p1cfg.engine!r}; expected 'viterbi' or 'run_length'"
        )


def ingest(
    video_path: Path,
    output_root: Path,
    *,
    version: str = "nhl26",
    use_gpu: bool = True,
    force_pass1: bool = False,
    force_pass2: bool = False,
    skip_pass1: bool = False,
    skip_pass2: bool = False,
    dispatch: bool = False,
    game_title_id: int | None = None,
    match_id: int | None = None,
    dispatch_dry_run: bool = False,
) -> IngestResult:
    """Run the two-pass pipeline.

    Args:
      video_path: path to a video file (.mkv/.mp4)
      output_root: root directory; per-video subtree lives at output_root/<sha>/
      version: per-game UI config name (matches game_ocr classifier config)
      use_gpu: pass to the classifier
      force_pass1: re-run Pass 1 even if segments.json exists
      force_pass2: re-extract Pass 2 frames even if segment dirs exist
      skip_pass1: don't run Pass 1; require valid cached segments.json. Raises
                  MissingPass1Cache if absent/legacy, CacheMismatch on drift.
                  Backs `extract-only`.
      skip_pass2: don't run Pass 2; return empty pass2_results. Backs
                  `classify-only`.
    """
    if skip_pass1 and force_pass1:
        raise ValueError("skip_pass1 and force_pass1 are mutually exclusive")
    if skip_pass2 and force_pass2:
        raise ValueError("skip_pass2 and force_pass2 are mutually exclusive")
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
    p1_raw = vcfg["pass1"]
    p1cfg = Pass1Config(
        sample_fps=float(p1_raw["sample_fps"]),
        min_run_to_open=int(p1_raw["min_run_to_open"]),
        max_outliers_within=int(p1_raw["max_outliers_within"]),
        min_segment_seconds=float(p1_raw["min_segment_seconds"]),
        min_segment_seconds_by_screen={
            str(k): float(v)
            for k, v in (p1_raw.get("min_segment_seconds_by_screen") or {}).items()
        },
        min_run_to_open_by_screen={
            str(k): int(v) for k, v in (p1_raw.get("min_run_to_open_by_screen") or {}).items()
        },
        engine=str(p1_raw.get("engine", "run_length")),
    )
    p2cfg = Pass2Config(
        window_padding_seconds=float(vcfg["pass2"]["window_padding_seconds"]),
        sample_rates={str(k): float(v) for k, v in vcfg["pass2"]["sample_rates"].items()},
        extract_screens=set(str(s) for s in vcfg["extract_screens"]),
    )

    # 3. Pass 1 (cached). Cache key = sha256(version_yaml + classifier_yaml).
    # On mismatch the orchestrator raises CacheMismatch (caught at top level)
    # with a remediation that points at --force-pass1. Force or legacy header
    # = fresh run; in both cases Pass 2 state is also cleared so the cascade
    # invariant holds (segments may change → existing Pass 2 is stale).
    pass2_root = sha_root / "pass2"
    manifest_path = sha_root / PASS2_MANIFEST_FILENAME
    pass1_cache_key = compute_pass1_cache_key(version)
    pass1_was_fresh = False
    elapsed_pass1 = 0.0

    cache_hit_pass1 = False
    if segments_json.exists() and not force_pass1:
        loaded = load_segments_json(segments_json)
        if loaded.is_legacy:
            if skip_pass1:
                raise MissingPass1Cache(
                    f"no valid Pass 1 cache at {segments_json} (legacy format).\n"
                    f"  Fix: run `video-ingest classify-only` (or `ingest`) first."
                )
            print(
                f"[pass1] legacy segments.json (no cache key); treating as cache miss",
                file=sys.stderr,
            )
        elif loaded.version != version or loaded.pass1_cache_key != pass1_cache_key:
            raise CacheMismatch(
                f"cache mismatch at {segments_json}\n"
                f"  stored:  version={loaded.version}  cache_key={loaded.pass1_cache_key}\n"
                f"  current: version={version}  cache_key={pass1_cache_key}\n"
                f"  Cause:   {VIDEO_INGEST_CONFIGS_DIR / f'{version}.yaml'}\n"
                f"           or game_ocr classifier config / state machine YAML / "
                f"screen-classifier weights for {version} has changed.\n"
                f"  Fix:     re-run with --force-pass1 (will also re-extract Pass 2)."
            )
        else:
            print(f"[pass1] cache hit at {segments_json}", file=sys.stderr)
            segments = loaded.segments
            cache_hit_pass1 = True

    if not cache_hit_pass1 and skip_pass1:
        raise MissingPass1Cache(
            f"no Pass 1 cache at {segments_json}.\n"
            f"  Fix: run `video-ingest classify-only` (or `ingest`) first."
        )

    if not cache_hit_pass1:
        # Fresh Pass 1: clear any Pass 2 state so the cascade invariant holds.
        if pass2_root.exists():
            import shutil
            shutil.rmtree(pass2_root)
        manifest_path.unlink(missing_ok=True)

        classifier = _build_classifier(version, use_gpu=use_gpu)
        t0 = time.perf_counter()
        cls_list, segments = _run_pass1(video_path, classifier, p1cfg, version)
        elapsed_pass1 = time.perf_counter() - t0
        write_segments_json(
            segments_json,
            classifications=cls_list,
            segments=segments,
            video_sha256=probe.sha256,
            video_path=video_path,
            config=p1cfg,
            version=version,
            cache_key=pass1_cache_key,
        )
        pass1_was_fresh = True
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

    # 4. Pass 2. Cache identifiers in the manifest:
    #   - pass2_cache_key: hash of version YAML (detects pass2 config drift)
    #   - segments_hash:   hash of segments.json bytes (detects Pass 1 drift)
    # If Pass 1 just ran fresh, segments.json is new → segments_hash differs
    # by definition; skip the compare and re-extract (cascade).
    # Under skip_pass2 (classify-only), this whole block is bypassed and the
    # returned pass2_results is empty.
    pass2_results: list[Pass2Result] = []
    elapsed_pass2 = 0.0
    if skip_pass2:
        print(f"[pass2] skipped (skip_pass2=True)", file=sys.stderr)
    else:
        pass2_cache_key = compute_pass2_cache_key(version)
        segments_hash = compute_segments_hash(segments_json)
        t0 = time.perf_counter()
        if force_pass2 and pass2_root.exists():
            import shutil
            shutil.rmtree(pass2_root)
            manifest_path.unlink(missing_ok=True)

        cache_hit_pass2 = False
        if (
            not force_pass2
            and not pass1_was_fresh
            and pass2_root.exists()
            and any(pass2_root.iterdir())
            and manifest_path.exists()
        ):
            loaded_p2 = load_pass2_manifest(manifest_path, segments)
            if loaded_p2.is_legacy:
                print(
                    f"[pass2] legacy manifest (no cache key); treating as cache miss",
                    file=sys.stderr,
                )
            elif loaded_p2.pass2_cache_key != pass2_cache_key:
                raise CacheMismatch(
                    f"cache mismatch at {manifest_path}\n"
                    f"  stored:  version={loaded_p2.version}  pass2_cache_key={loaded_p2.pass2_cache_key}\n"
                    f"  current: version={version}  pass2_cache_key={pass2_cache_key}\n"
                    f"  Cause:   {VIDEO_INGEST_CONFIGS_DIR / f'{version}.yaml'} pass2 section has changed.\n"
                    f"  Fix:     re-run with --force-pass2."
                )
            elif loaded_p2.segments_hash != segments_hash:
                raise CacheMismatch(
                    f"cache mismatch at {manifest_path}\n"
                    f"  stored:  segments_hash={loaded_p2.segments_hash}\n"
                    f"  current: segments_hash={segments_hash}\n"
                    f"  Cause:   segments.json contents differ from when Pass 2 was extracted.\n"
                    f"  Fix:     re-run with --force-pass2 (or --force-pass1 to re-derive segments)."
                )
            else:
                print(f"[pass2] cache hit at {pass2_root}", file=sys.stderr)
                pass2_results = loaded_p2.results
                cache_hit_pass2 = True

        if not cache_hit_pass2:
            pass2_results = extract_segments(
                video_path=video_path,
                segments=segments,
                config=p2cfg,
                pass2_root=pass2_root,
                video_duration_seconds=probe.duration_seconds,
                version=version,
                segments_hash=segments_hash,
            )
        elapsed_pass2 = time.perf_counter() - t0
        total_frames = sum(r.frame_count for r in pass2_results)
        print(
            f"[pass2] {len(pass2_results)} segments, "
            f"{total_frames} total frames extracted in {elapsed_pass2:.1f}s",
            file=sys.stderr,
        )

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
            ui_version=version,
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
