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
import os
import sys
import time
from dataclasses import dataclass
from pathlib import Path

import yaml

from video_ingest import gpu_libs
from video_ingest.dispatch import DispatchResult, dispatch_segments
from video_ingest.identity_probe import (
    make_pass2_persona_reader,
    parse_basename_epoch,
    write_reel_identities,
)
from video_ingest.match_split import dispatch_reels
from video_ingest.pass1_classify import (
    CacheMismatch,
    MissingPass1Cache,
    Pass1Config,
    SamplingTelemetry,
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
    VisualPrefilterPass2Config,
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


def compute_pass2_cache_dir(root: Path, sha: str, run_id: int | None) -> Path:
    """Resolve the Pass-2 cache directory for a given video sha.

    When `run_id` is provided, the directory is scoped as
    ``<root>/<sha>/pass2-run-<run_id>`` so concurrent reprocesses against
    the same video don't share extracted PNG output. When `run_id` is
    ``None`` (legacy single-run ingest), the directory name is the
    historical ``pass2``.

    Pass-1 outputs are versioned by ``compute_pass1_cache_key`` (S5.4) and
    therefore don't need analogous scoping; only Pass-2 PNGs lack a cache-
    key-derived path, hence the explicit ``run_id`` suffix here.
    """
    name = f"pass2-run-{run_id}" if run_id is not None else "pass2"
    return root / sha / name


@dataclass
class IngestResult:
    probe: VideoProbe
    sha_root: Path
    pass1_segments: list[Segment]
    pass2_results: list[Pass2Result]
    elapsed_pass1: float
    elapsed_pass2: float
    # Phase 4: sub-phase timings + cache-hit flag for Pass-1. None when the
    # caller skipped Pass-1 entirely (skip_pass1=True without cache); on a
    # cache hit the field is populated but with pass1_cache_hit=True and
    # all *_ms fields at 0.0 to signal "this run did not measure Pass-1."
    sampling_telemetry: SamplingTelemetry | None = None
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
    *,
    use_gpu: bool = True,
) -> tuple[list, list[Segment], str, "SamplingTelemetry"]:
    """Engine dispatch: returns (frame_classifications, segments,
    decoder_version, sampling_telemetry).

    `engine="run_length"` (legacy): runs the HSV+anchor classifier per frame,
    then collapses to segments via the N-consecutive-frame rule.

    `engine="viterbi"` (Phase 1): runs the same anchor-text OCR per frame for
    audit, computes multi-signal FrameFeatures, then feeds them through the
    learned LR head + emission combiner + Viterbi decoder.
    """
    # Imported here so `SamplingTelemetry` is in scope for the return type
    # without forcing a top-level import (the file already lazy-imports
    # pass1_classify inside each engine branch).
    from video_ingest.pass1_classify import SamplingTelemetry
    if p1cfg.engine == "viterbi":
        from game_ocr.emissions import EmissionWeights
        from game_ocr.frame_features import compute_frame_features
        from game_ocr.screen_classifier import load_screen_classifier
        from game_ocr.state_machine import load_state_machine
        from video_ingest.pass1_classify import (
            FrameClassification,
            SamplingTelemetry,
            iter_sampled_frames,
        )
        from video_ingest.pass1_segment import decode_segments

        # Phase 4: outer wall-time timer for this engine branch. Sub-phase
        # timers (decode/classify/viterbi) populate during the work below;
        # the outer timer captures any uninstrumented overhead in the
        # residual `elapsed_pass1_ms - (decode + classify + viterbi)`.
        pass1_branch_start = time.perf_counter()

        # v1 engine loads the v1 state machine + v1 weights. The unversioned
        # `nhl26.yaml` is reserved for v2 once S5.1 bumps it.
        sm = load_state_machine(f"{version}-v1")
        # `sample_fps` now describes the cadence at which Pass-1 emits ticks,
        # not the source of segment timing — actual times come from container
        # PTS via `iter_sampled_frames`. The invariant below still matters so
        # the state machine's expected tick rate matches what we feed it.
        if sm.sample_fps != p1cfg.sample_fps:
            raise RuntimeError(
                f"state machine sample_fps={sm.sample_fps} != Pass-1 config sample_fps={p1cfg.sample_fps}"
            )
        weights_path = (
            Path(__file__).resolve().parents[2] / "game_ocr" / "game_ocr" / "weights"
            / f"{version}-screen-classifier-v1.json"
        )
        if not weights_path.exists():
            raise FileNotFoundError(
                f"missing learned screen classifier weights for {version}: {weights_path}\n"
                f"  Fix: run `python3 tools/game_ocr/scripts/train_screen_classifier.py --version {version} --engine viterbi`"
            )
        clf = load_screen_classifier(weights_path, sm)
        cls_list: list = []
        feats_list = []
        sampling_telemetry = SamplingTelemetry()
        loop_t = time.perf_counter()
        for sf in iter_sampled_frames(
            video_path, p1cfg.sample_fps, telemetry=sampling_telemetry,
        ):
            anchor_text = classifier_legacy._read_anchor(sf.image)
            feats = compute_frame_features(sf.image, anchor_text=anchor_text, state_machine=sm)
            feats_list.append(feats)
            # For audit / annotate.py compatibility, emit a FrameClassification
            # carrying the raw signals. screen_type stays unknown_or_transition
            # until the Viterbi pass assigns it below.
            cls_list.append(FrameClassification(
                index=sf.sample_index,
                seconds=sf.source_time_seconds,
                screen_type="unknown_or_transition",
                color_score=0.0,
                color_class="",
                anchor_text=anchor_text,
                sample_index=sf.sample_index,
                source_pts=sf.source_pts,
                source_time_seconds=sf.source_time_seconds,
                decode_order_index=sf.decode_order_index,
            ))
        loop_total_ms = (time.perf_counter() - loop_t) * 1000.0
        # classify_ms = wall time of the consumer loop minus the decode
        # time iter_sampled_frames accumulated into telemetry.decode_ms.
        sampling_telemetry.classify_ms = max(0.0, loop_total_ms - sampling_telemetry.decode_ms)

        viterbi_t = time.perf_counter()
        segments = decode_segments(
            features=feats_list,
            classifier=clf,
            state_machine=sm,
            weights=EmissionWeights(),
            frame_source_times=[c.source_time_seconds for c in cls_list],
        )
        sampling_telemetry.viterbi_ms = (time.perf_counter() - viterbi_t) * 1000.0
        # Stamp the decoded state back onto the per-frame audit table.
        # Preserve the canonical-PTS fields populated upstream — these
        # encode source time, not classifier output, and must survive the
        # screen-type reassignment.
        for seg in segments:
            for i in range(seg.start_index, seg.end_index + 1):
                prev = cls_list[i]
                cls_list[i] = FrameClassification(
                    index=prev.index,
                    seconds=prev.seconds,
                    screen_type=seg.screen_type,
                    color_score=prev.color_score,
                    color_class=prev.color_class,
                    anchor_text=prev.anchor_text,
                    sample_index=prev.sample_index,
                    source_pts=prev.source_pts,
                    source_time_seconds=prev.source_time_seconds,
                    decode_order_index=prev.decode_order_index,
                )
        sampling_telemetry.elapsed_pass1_ms = (time.perf_counter() - pass1_branch_start) * 1000.0
        return cls_list, segments, sm.decoder_version, sampling_telemetry
    elif p1cfg.engine == "viterbi_v2":
        from game_ocr.emissions import EmissionWeights
        from game_ocr.frame_pipeline_v2 import compute_frame_features_v2_from_image
        from game_ocr.ocr import RapidOCRBackend, _NullOCRBackend
        from game_ocr.regex_priors import load_regex_priors
        from game_ocr.screen_classifier import load_screen_classifier
        from game_ocr.state_machine import load_state_machine
        from video_ingest.pass1_classify import (
            FrameClassification,
            SamplingTelemetry,
            iter_sampled_frames,
        )
        from video_ingest.pass1_segment import decode_segments_v2
        from video_ingest.visual_prefilter.pass1_policy import gate
        from video_ingest.visual_prefilter.signals import compute_visual_signals

        # Phase 4: outer wall-time timer for this engine branch.
        pass1_branch_start = time.perf_counter()

        sm = load_state_machine(version)
        # See v1 path note: `sample_fps` is the tick cadence, not segment
        # timing. PTS comes from the container via `iter_sampled_frames`.
        if sm.sample_fps != p1cfg.sample_fps:
            raise RuntimeError(
                f"state machine sample_fps={sm.sample_fps} != Pass-1 config sample_fps={p1cfg.sample_fps}"
            )
        weights_path = (
            Path(__file__).resolve().parents[2] / "game_ocr" / "game_ocr" / "weights"
            / f"{version}-screen-classifier-v2.json"
        )
        if not weights_path.exists():
            raise FileNotFoundError(
                f"missing v2 learned screen classifier weights for {version}: {weights_path}\n"
                f"  Fix: run `python3 tools/game_ocr/scripts/train_screen_classifier.py --version {version} --engine viterbi_v2`"
            )
        clf = load_screen_classifier(weights_path, sm)
        regex_priors = load_regex_priors(version)
        # v2 OCRs both ROIs (top_bar 1920x200 + side_strip 220x880) per
        # frame via the injected backend. Use the orchestrator-level
        # use_gpu flag — the prior `use_gpu=False` hardcode predated the
        # silent CPU-fallback discovery and assumed the ROIs were "small
        # crops". They're not: microbench shows ~4.5x speedup per OCR
        # call on a 3060 (top_bar 828ms→173ms p50, side_strip 803ms→180ms
        # p50) once RapidOCRBackend.__init__'s nvidia-*-cu12 preload runs
        # successfully. Pass-1 wall on the 187 MB fixture: ~20 min → ~5 min.
        ocr = RapidOCRBackend(use_gpu=use_gpu)
        # WS2 pre-OCR gate: for frames the gate classifies as unambiguously
        # non-text, swap in a no-op OCR backend so the expensive RapidOCR ROI
        # reads are skipped, and record the frame in `gated_mask` so the
        # emissions builder pins it to unknown_or_transition (a no-OCR frame
        # must not be scored on visual features alone).
        null_ocr = _NullOCRBackend()
        gate_cfg = p1cfg.pass1_gate

        cls_list: list = []
        feats_list = []
        gated_mask: list[bool] = []
        sampling_telemetry = SamplingTelemetry()
        loop_t = time.perf_counter()
        for sf in iter_sampled_frames(
            video_path, p1cfg.sample_fps, telemetry=sampling_telemetry,
        ):
            is_gated = False
            if gate_cfg is not None and getattr(gate_cfg, "enabled", False):
                is_gated = gate(compute_visual_signals(sf.image), gate_cfg) == "skip"
            feats = compute_frame_features_v2_from_image(
                sf.image, regex_priors=regex_priors,
                ocr_backend=null_ocr if is_gated else ocr,
            )
            feats_list.append(feats)
            gated_mask.append(is_gated)
            if is_gated:
                sampling_telemetry.frames_gated += 1
            cls_list.append(FrameClassification(
                index=sf.sample_index,
                seconds=sf.source_time_seconds,
                screen_type="unknown_or_transition",
                color_score=0.0,
                color_class="",
                anchor_text=feats.top_bar_text,
                sample_index=sf.sample_index,
                source_pts=sf.source_pts,
                source_time_seconds=sf.source_time_seconds,
                decode_order_index=sf.decode_order_index,
            ))
        loop_total_ms = (time.perf_counter() - loop_t) * 1000.0
        sampling_telemetry.classify_ms = max(0.0, loop_total_ms - sampling_telemetry.decode_ms)

        viterbi_t = time.perf_counter()
        segments = decode_segments_v2(
            features=feats_list,
            classifier=clf,
            state_machine=sm,
            regex_priors=regex_priors,
            weights=EmissionWeights(),
            frame_source_times=[c.source_time_seconds for c in cls_list],
            gated_mask=gated_mask,
        )
        sampling_telemetry.viterbi_ms = (time.perf_counter() - viterbi_t) * 1000.0
        for seg in segments:
            for i in range(seg.start_index, seg.end_index + 1):
                prev = cls_list[i]
                cls_list[i] = FrameClassification(
                    index=prev.index,
                    seconds=prev.seconds,
                    screen_type=seg.screen_type,
                    color_score=prev.color_score,
                    color_class=prev.color_class,
                    anchor_text=prev.anchor_text,
                    sample_index=prev.sample_index,
                    source_pts=prev.source_pts,
                    source_time_seconds=prev.source_time_seconds,
                    decode_order_index=prev.decode_order_index,
                )
        sampling_telemetry.elapsed_pass1_ms = (time.perf_counter() - pass1_branch_start) * 1000.0
        return cls_list, segments, sm.decoder_version, sampling_telemetry
    elif p1cfg.engine == "run_length":
        # Phase 4: outer wall-time timer for this engine branch.
        pass1_branch_start = time.perf_counter()
        sampling_telemetry = SamplingTelemetry()
        loop_t = time.perf_counter()
        cls_list = classify_video(
            video_path, classifier_legacy, p1cfg,
            telemetry=sampling_telemetry,
        )
        loop_total_ms = (time.perf_counter() - loop_t) * 1000.0
        sampling_telemetry.classify_ms = max(0.0, loop_total_ms - sampling_telemetry.decode_ms)

        viterbi_t = time.perf_counter()
        segments = build_segments(cls_list, p1cfg)
        # The legacy run-length builder isn't a Viterbi decoder, but it
        # occupies the same orchestrator slot — keeping the timer name
        # consistent across engines simplifies the analytics query.
        sampling_telemetry.viterbi_ms = (time.perf_counter() - viterbi_t) * 1000.0
        sampling_telemetry.elapsed_pass1_ms = (time.perf_counter() - pass1_branch_start) * 1000.0
        return cls_list, segments, "legacy-passthrough-v0-video", sampling_telemetry
    else:
        raise ValueError(
            f"unknown Pass-1 engine {p1cfg.engine!r}; "
            f"expected 'viterbi_v2' (default), 'viterbi' (v1 rollback), or 'run_length' (legacy)"
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
    run_id: int | None = None,
    artifact_mode: bool | None = None,
    prefilter_enabled: bool | None = None,
    pass1_gate_enabled: bool | None = None,
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
      artifact_mode: Phase 3a override for Pass2Config.artifact_mode. When
                    None (default) the value is taken from the version
                    YAML. When True/False the CLI flag takes precedence
                    over the config — the canonical entry point for
                    `--pass2-artifacts/--no-pass2-artifacts`.
      prefilter_enabled: Visual Prefilter Phase 3 override for
                    `visual_prefilter.pass2_enabled`. None (default) =
                    use the version YAML; True/False = CLI override.
                    Switching the effective state invalidates the Pass-2
                    cache via the prefilter fingerprint in
                    `compute_pass2_cache_key`.
      pass1_gate_enabled: WS2 pre-OCR gate override for
                    `pass1.pre_ocr_gate.enabled`. None (default) = use the
                    version YAML; True/False = CLI override (the OFF/ON A/B
                    switch). The env kill switch `OCR_PASS1_GATE_ENABLED=false`
                    overrides this to disabled. Switching the effective state
                    invalidates the Pass-1 cache via the gate fingerprint in
                    `compute_pass1_cache_key`.
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
        # WS3: surface the per-frame detection evidence so an operator can
        # see WHY a version was chosen or rejected (esp. on an
        # unknown_version bail). One line per sampled frame.
        for ev in guess.frame_evidence:
            ocr_preview = ev.ocr_text[:80] + ("…" if len(ev.ocr_text) > 80 else "")
            print(
                f"[ingest]   t={ev.sampled_seconds:7.1f}s  "
                f"bright={ev.brightness:.2f} blur={ev.log_blur:.2f} "
                f"edge={ev.edge_density:.2f}  ocr={ocr_preview!r}",
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
    # WS2 pre-OCR gate: resolve the effective gate once. Precedence is
    # env-disable > CLI > YAML (the env switch is a disable-only kill switch).
    # `parse_gate_config` is the SINGLE YAML→GateConfig path, shared with the
    # proving-bench acceptance test so thresholds can't drift.
    from video_ingest.visual_prefilter.pass1_policy import (
        parse_gate_config,
        resolve_effective_gate,
    )

    _env_gate = os.environ.get("OCR_PASS1_GATE_ENABLED")
    _env_disabled = _env_gate is not None and _env_gate.strip().lower() in ("false", "0")
    p1cfg.pass1_gate = resolve_effective_gate(
        parse_gate_config(p1_raw),
        cli_enabled=pass1_gate_enabled,
        env_disabled=_env_disabled,
    )
    # artifact_mode resolution: CLI override > version YAML > default False
    # (Phase 3c: in-memory hot path is steady state; legacy PNG-on-disk is
    # opt-in via --pass2-artifacts or `pass2.artifact_mode: true` in the
    # version YAML). The YAML key is optional. CLI takes precedence so an
    # operator can flip mode without editing the config file.
    p2cfg_artifact_mode = (
        artifact_mode
        if artifact_mode is not None
        else bool(vcfg["pass2"].get("artifact_mode", False))
    )
    p2cfg = Pass2Config(
        window_padding_seconds=float(vcfg["pass2"]["window_padding_seconds"]),
        sample_rates={str(k): float(v) for k, v in vcfg["pass2"]["sample_rates"].items()},
        extract_screens=set(str(s) for s in vcfg["extract_screens"]),
        loadout_engine=str(vcfg["pass2"].get("loadout_engine", "legacy")),
        lobby_engine=str(vcfg["pass2"].get("lobby_engine", "legacy")),
        artifact_mode=p2cfg_artifact_mode,
    )
    # Visual Prefilter Phase 3: instantiate VisualPrefilterPass2Config from
    # the YAML `visual_prefilter` block. CLI override > YAML > default False
    # (same precedence as artifact_mode). Pass2 selection only runs when
    # enabled AND the segment's screen_type has a configured frame_budget.
    vp_raw = vcfg.get("visual_prefilter") or {}
    vp_pass2_raw = vp_raw.get("pass2") or {}
    yaml_prefilter_enabled = bool(vp_raw.get("pass2_enabled", False))
    effective_prefilter_enabled = (
        prefilter_enabled
        if prefilter_enabled is not None
        else yaml_prefilter_enabled
    )
    prefilter_cfg = VisualPrefilterPass2Config(
        enabled=effective_prefilter_enabled,
        frame_budget={
            str(k): int(v)
            for k, v in (vp_pass2_raw.get("frame_budget") or {}).items()
        },
        dedup_dhash_distance={
            str(k): int(v)
            for k, v in (vp_pass2_raw.get("dedup_dhash_distance") or {}).items()
        },
    )

    # 3. Pass 1 (cached). Cache key = sha256(version_yaml + classifier_yaml).
    # On mismatch the orchestrator raises CacheMismatch (caught at top level)
    # with a remediation that points at --force-pass1. Force or legacy header
    # = fresh run; in both cases Pass 2 state is also cleared so the cascade
    # invariant holds (segments may change → existing Pass 2 is stale).
    pass2_root = compute_pass2_cache_dir(output_root, probe.sha256, run_id)
    manifest_path = sha_root / PASS2_MANIFEST_FILENAME
    from video_ingest.visual_prefilter.pass1_policy import gate_cache_fingerprint

    pass1_cache_key = compute_pass1_cache_key(
        version, p1cfg.engine, gate_cache_fingerprint(p1cfg.pass1_gate)
    )
    pass1_was_fresh = False
    elapsed_pass1 = 0.0

    decoder_version: str | None = None
    # Phase 4: sampling_telemetry carries the Pass-1 sub-phase timings +
    # cache-hit flag through to IngestResult. On a fresh run, _run_pass1
    # returns a populated instance below. On a cache hit, we construct a
    # fresh SamplingTelemetry(pass1_cache_hit=True) — we deliberately do
    # NOT read forward the stored fresh-run telemetry from segments.json
    # (that would conflate "didn't run this time" with "ran with these
    # numbers"). The stored block stays on disk as a per-video reference.
    sampling_telemetry: SamplingTelemetry | None = None

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
            # Phase 4 cache-hit telemetry: signal "didn't run this time"
            # via the flag; all *_ms fields stay at 0.0.
            sampling_telemetry = SamplingTelemetry(pass1_cache_hit=True)
            # Cache hit: derive decoder_version from current engine config.
            # The legacy run_length engine doesn't ship a state machine YAML,
            # so we default to its tag; the viterbi engine loads sm for the tag.
            if p1cfg.engine == "viterbi":
                from game_ocr.state_machine import load_state_machine
                decoder_version = load_state_machine(version).decoder_version
            else:
                decoder_version = "legacy-passthrough-v0-video"

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
        cls_list, segments, decoder_version, sampling_telemetry = _run_pass1(
            video_path, classifier, p1cfg, version, use_gpu=use_gpu,
        )
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
            sampling_telemetry=sampling_telemetry,
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
        pass2_cache_key = compute_pass2_cache_key(
            version, p2cfg.artifact_mode, prefilter=prefilter_cfg,
        )
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
                # Phase 3c: when the only attribute we can introspect from
                # the manifest (artifact_mode) differs, name it in the
                # message and lead with the reuse-cache remediation. After
                # the Phase-3c default flip, every pre-flip on-disk cache
                # will hit this branch on the first re-run; the tailored
                # wording turns that into a self-service fix instead of a
                # head-scratcher. None-guard is defensive — `is_legacy`
                # already routes pre-3a manifests above.
                if (
                    loaded_p2.artifact_mode is not None
                    and loaded_p2.artifact_mode != p2cfg.artifact_mode
                ):
                    prev_flag = (
                        "--pass2-artifacts"
                        if loaded_p2.artifact_mode
                        else "--no-pass2-artifacts"
                    )
                    raise CacheMismatch(
                        f"cache mismatch at {manifest_path}\n"
                        f"  stored:  artifact_mode={loaded_p2.artifact_mode}  pass2_cache_key={loaded_p2.pass2_cache_key}\n"
                        f"  current: artifact_mode={p2cfg.artifact_mode}  pass2_cache_key={pass2_cache_key}\n"
                        f"  Cause:   the pass2 artifact_mode flag flipped since this cache was written.\n"
                        f"  Fix:     re-run with `{prev_flag}` to reuse the existing cache as-is,\n"
                        f"           or `--force-pass2` to regenerate the cache under the new mode."
                    )
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
                prefilter=prefilter_cfg,
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
        # Milestone ② — for an un-associated multi-reel video, emit one
        # reel-<idx>-identity.json (capture epoch + our-side personas) beside
        # reels.json so `resolve-match propose` can score each reel to a DB
        # match_id. Best-effort: a bad basename or a single reel's read failure
        # must never abort the live ingest run. Personas come from the Pass-2
        # lobby_evidence.json already on disk; score/opponent box-score OCR is a
        # deferred follow-up (ReelOcrReads leaves them absent).
        basename = video_path.stem
        results_by_index = {r.segment_index: r for r in pass2_results}
        persona_reader = make_pass2_persona_reader(results_by_index)

        def _emit_reel_identities(reels: list) -> None:
            try:
                parse_basename_epoch(basename)
            except ValueError:
                print(
                    f"[identity] {basename!r} is not a wall-clock recording stamp; "
                    f"skipping reel-identity emission (reels still need association).",
                    file=sys.stderr,
                )
                return
            try:
                paths = write_reel_identities(
                    reels,
                    basename=basename,
                    sha_root=sha_root,
                    read_reads=persona_reader,
                    log=lambda m: print(m, file=sys.stderr),
                )
                print(
                    f"[identity] wrote {len(paths)} reel-identity file(s) for association.",
                    file=sys.stderr,
                )
            except Exception as exc:  # noqa: BLE001 — never abort the run on emit failure
                print(f"[identity] reel-identity emission failed ({exc}).", file=sys.stderr)

        # Milestone ① — group Pass-1 segments into per-match reels, emit
        # reels.json, and apply the per-reel dispatch decision. A single-match
        # video keeps today's exact behaviour (all results under one match_id);
        # a multi-match video with no association map writes reels.json +
        # per-reel identity files and skips dispatch (no collapse) until
        # Milestone ② supplies reel_match_ids.
        dispatch_results = dispatch_reels(
            segments,
            pass2_results,
            sha_root=sha_root,
            dispatch_fn=dispatch_segments,
            match_id=match_id,
            reel_match_ids=None,  # Milestone ② will supply the reel→match_id map
            emit_reel_identities=_emit_reel_identities,
            game_title_id=game_title_id,
            video_sha256=probe.sha256,
            ui_version=version,
            decoder_version=decoder_version,
            loadout_engine=p2cfg.loadout_engine,
            lobby_engine=p2cfg.lobby_engine,
            dry_run=dispatch_dry_run,
            run_id=run_id,
        )
        elapsed_dispatch = time.perf_counter() - t0
        ok = sum(1 for r in dispatch_results if r.returncode == 0)
        failed = sum(1 for r in dispatch_results if r.returncode != 0)
        print(
            f"[dispatch] {ok} ok, {failed} failed in {elapsed_dispatch:.1f}s",
            file=sys.stderr,
        )

    # Phase 4 Part B: emit run-scoped ingest_timings.json sidecar so
    # reprocess.py can read structured Pass-1 sub-phase telemetry +
    # Pass-2 wall time without parsing CLI stdout. Run-scoped path
    # (when run_id is provided) mirrors compute_pass2_cache_dir's
    # collision-avoidance pattern; concurrent reprocesses against the
    # same source video each write to their own file. Direct CLI use
    # (run_id is None) falls back to the unscoped name — concurrent
    # direct ingests are operator-managed.
    if sampling_telemetry is not None:
        # WS1b: aggregate the per-segment Visual-Prefilter telemetry
        # (Pass2Result.prefilter_*) into run-level totals for the sidecar.
        # Each field stays None when EVERY segment is None (prefilter off or
        # no configured budget), preserving the "null when disabled" contract;
        # otherwise it sums the non-None segments. selection_ms sums to total
        # selection wall across segments.
        def _sum_prefilter(attr: str) -> float | None:
            vals = [
                getattr(r, attr)
                for r in pass2_results
                if getattr(r, attr) is not None
            ]
            return sum(vals) if vals else None

        timings_payload = {
            "pass1_decode_ms": sampling_telemetry.decode_ms,
            "pass1_classify_ms": sampling_telemetry.classify_ms,
            "pass1_viterbi_ms": sampling_telemetry.viterbi_ms,
            "pass1_ms": sampling_telemetry.elapsed_pass1_ms,
            # Pass-2 cache hit: elapsed_pass2 is the genuine wall time
            # the orchestrator spent on Pass-2 in THIS run (including
            # the cache-load path) — small but real. We do NOT zero it
            # or add a pass2_cache_hit flag; pass2_ms always means
            # "wall time this run spent on Pass-2" for a stable
            # analytics contract.
            "pass2_ms": elapsed_pass2 * 1000.0,
            "pass1_cache_hit": sampling_telemetry.pass1_cache_hit,
            # WS1b: run-level Visual-Prefilter Pass-2 selection telemetry.
            # null when the prefilter was disabled for this run.
            "prefilter_frames_scanned": _sum_prefilter("prefilter_frames_scanned"),
            "prefilter_frames_selected": _sum_prefilter("prefilter_frames_selected"),
            "prefilter_selection_ms": _sum_prefilter("prefilter_selection_ms"),
        }
        timings_filename = (
            f"ingest-run-{run_id}-timings.json"
            if run_id is not None
            else "ingest_timings.json"
        )
        (sha_root / timings_filename).write_text(json.dumps(timings_payload, indent=2))

    return IngestResult(
        probe=probe,
        sha_root=sha_root,
        pass1_segments=segments,
        pass2_results=pass2_results,
        elapsed_pass1=elapsed_pass1,
        elapsed_pass2=elapsed_pass2,
        sampling_telemetry=sampling_telemetry,
        dispatch_results=dispatch_results,
        elapsed_dispatch=elapsed_dispatch,
    )
