"""Pass 1 (LEGACY — run-length engine): segment a video into screen-type windows.

NOTE: As of Phase 1 of the OCR pipeline redesign (2026-05-19), this module is
the legacy fallback path. The default engine is pass1_segment.decode_segments()
(HMM/Viterbi). This module survives only while `pass1.engine=run_length` is a
supported option. Phase 5 deletes this file.

When extending Pass 1 going forward, change the HMM path in
`tools/video_ingest/video_ingest/pass1_segment.py`, not here.

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

import hashlib
import json
import subprocess
import sys
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Callable, Iterator

import numpy as np

from game_ocr.classifier import (
    UNKNOWN_SCREEN,
    Classifier,
    ClassifyResult,
)
from game_ocr.classifier import CONFIGS_DIR as _CLASSIFIER_CONFIGS_DIR
from video_ingest.pts import PtsHealthError


VIDEO_INGEST_CONFIGS_DIR = Path(__file__).resolve().parent / "configs"


class CacheMismatch(RuntimeError):
    """Raised when a cached artifact's stored cache key disagrees with the
    current config. The orchestrator catches this at the top level and emits
    a structured remediation message before exiting."""


class MissingPass1Cache(RuntimeError):
    """Raised by `extract-only` (orchestrator with skip_pass1=True) when no
    valid segments.json exists. Cannot proceed without a Pass 1 output."""


def _sha256_of(data: bytes) -> str:
    return "sha256:" + hashlib.sha256(data).hexdigest()


def compute_pass1_cache_key(
    version: str, engine: str = "viterbi_v2", gate_fingerprint: str | None = None
) -> str:
    """Hash of every input that demonstrably changes Pass-1 output for the
    given engine. Engine-aware as of S5.4: v1 and v2 each read their own
    state-machine YAML + weights artifact (+ regex priors for v2).

    `gate_fingerprint` (WS2): the effective pre-OCR gate state. The gate's
    enabled/threshold state is set at runtime (YAML + env kill switch + CLI
    override), so it does NOT live entirely in the hashed config files — the
    env/CLI overrides would otherwise reuse a stale cached segments.json. When
    not None it is folded into the key so any change to effective gate behavior
    correctly invalidates the cache. None (gate effectively disabled) ⇒
    byte-identical key to a pre-WS2 build."""
    version_yaml = VIDEO_INGEST_CONFIGS_DIR / f"{version}.yaml"
    classifier_yaml = _CLASSIFIER_CONFIGS_DIR / f"{version}.yaml"
    parts: list[bytes] = [version_yaml.read_bytes(), b"\x00", classifier_yaml.read_bytes()]

    from game_ocr.state_machine import CONFIGS_DIR as _SM_DIR

    if engine in ("viterbi", "run_length"):
        sm_yaml = _SM_DIR / f"{version}-v1.yaml"
        weights_json = (
            _CLASSIFIER_CONFIGS_DIR.parent.parent
            / "weights" / f"{version}-screen-classifier-v1.json"
        )
        regex_priors_yaml = None
    elif engine == "viterbi_v2":
        sm_yaml = _SM_DIR / f"{version}.yaml"
        weights_json = (
            _CLASSIFIER_CONFIGS_DIR.parent.parent
            / "weights" / f"{version}-screen-classifier-v2.json"
        )
        regex_priors_yaml = _SM_DIR / f"{version}_regex_priors.yaml"
    else:
        raise ValueError(f"unknown engine for cache key: {engine!r}")

    if sm_yaml.exists():
        parts.append(b"\x00")
        parts.append(sm_yaml.read_bytes())
    if weights_json.exists():
        parts.append(b"\x00")
        parts.append(weights_json.read_bytes())
    if regex_priors_yaml is not None and regex_priors_yaml.exists():
        parts.append(b"\x00")
        parts.append(regex_priors_yaml.read_bytes())
    if gate_fingerprint is not None:
        parts.append(b"\x00")
        parts.append(gate_fingerprint.encode("utf-8"))
    return _sha256_of(b"".join(parts))


def compute_segments_hash(segments_json_path: Path) -> str:
    """sha256 of segments.json on disk. Pass 2's manifest records this so
    Pass 1 invalidation cascades."""
    return _sha256_of(segments_json_path.read_bytes())


@dataclass
class Pass1Config:
    sample_fps: float = 1.0
    min_run_to_open: int = 3
    max_outliers_within: int = 1
    min_segment_seconds: float = 3.0
    # Per-screen overrides for short, briefly-viewed post-game screens. When a
    # screen type appears here, its threshold replaces the global default for
    # that screen only. Mirrors the per-screen Pass-2 sample_rates pattern.
    min_segment_seconds_by_screen: dict[str, float] = field(default_factory=dict)
    min_run_to_open_by_screen: dict[str, int] = field(default_factory=dict)
    # Phase 1: which Pass-1 engine to use. "run_length" = legacy classifier +
    # build_segments() path; "viterbi" = pass1_segment.decode_segments() HMM
    # path. Default stays run_length until weights ship; switch per-version in
    # configs/<version>.yaml.
    engine: str = "run_length"
    # WS2: effective pre-OCR gate (post env/CLI override). None = disabled.
    # Only the viterbi_v2 engine honors it. Typed loosely to avoid importing
    # the policy module here (it pulls in cv2 via signals); the orchestrator
    # sets it to a `GateConfig | None`.
    pass1_gate: object | None = None


@dataclass
class FrameClassification:
    index: int
    seconds: float
    screen_type: str
    color_score: float
    color_class: str
    anchor_text: str
    # Canonical-PTS fields populated by the new PyAV sampler. Optional with
    # None defaults so callers that still construct via the deprecated
    # ffmpeg-subprocess path don't trip until the call-site flip lands.
    # `seconds` and `source_time_seconds` agree once the flip ships; both
    # are kept (the former for back-compat with consumers like annotate.py
    # that read `.seconds`).
    sample_index: int | None = None
    source_pts: int | None = None
    source_time_seconds: float | None = None
    decode_order_index: int | None = None


@dataclass
class Segment:
    start_index: int          # inclusive
    end_index: int            # inclusive
    start_seconds: float      # inclusive — canonical container PTS of the
                              # first sampled frame in the segment, zero-based
                              # against stream start time. Pass-2 feeds this
                              # to ffmpeg `-ss` for seek.
    end_seconds: float        # exclusive — canonical container PTS of the
                              # frame immediately past the segment, or the
                              # last sample's PTS + one sample period if no
                              # such frame exists.
    screen_type: str
    frame_count: int
    mean_color_score: float


@dataclass
class SampledFrame:
    """One sampled frame, with canonical container PTS attached.

    `source_time_seconds` is zero-based against the stream's first PTS so it
    matches what ffmpeg's `-ss` argument expects downstream (Pass 2 seeks by
    container time). `decode_order_index` is the index in PyAV's decode
    iterator — since PyAV emits in presentation order, this is also the
    presentation-order position of the frame in the decoded stream.
    """
    sample_index: int
    source_pts: int
    source_time_seconds: float
    decode_order_index: int
    image: np.ndarray  # (height, width, 3) uint8 BGR


@dataclass
class SamplingTelemetry:
    """Side-channel counters + Phase-4 timing fields captured during Pass-1.
    The orchestrator writes these into the pass-1 metadata block of
    `segments.json` so a later run-quality pass can flag VFR /
    dropped-frame drift AND surface where Pass-1 wall time was spent.

    `max_source_pts_jump_within_sample_interval` is the largest observed gap
    between consecutive emitted samples' `source_time_seconds`. On an ideal
    CFR source sampled at 1 fps it should be ≈ 1.0; values materially above
    `1.0 / sample_fps` indicate dropped frames or VFR bursts.

    Timing fields (Phase 4):
    - `decode_ms`: wall time accumulated inside `iter_sampled_frames` for
       PyAV decode + reformat work, excluding consumer time between yields.
    - `classify_ms`: wall time the orchestrator's per-frame classifier
       loop spent excluding decode (derived: loop_total - decode_ms).
    - `viterbi_ms`: wall time spent in `decode_segments(_v2)` /
       `build_segments`.
    - `elapsed_pass1_ms`: outer wall time of the whole Pass-1 engine
       branch (NOT a sum of sub-phases; uninstrumented overhead lives in
       the residual `elapsed_pass1_ms - (decode + classify + viterbi)`).

    Cache-hit semantics: when the orchestrator returns a cached Pass-1
    result, it constructs a fresh `SamplingTelemetry(pass1_cache_hit=True)`
    with all `*_ms` and `*_count` fields at default 0/0.0 — meaning "this
    run did not measure Pass-1." The stored telemetry block in segments.json
    is NOT read forward onto the in-memory result; it describes the prior
    fresh run, not this one. Aggregations across runs should filter on
    `pass1_cache_hit == False` to compare like-with-like.
    """
    decoded_frame_count: int = 0
    sampled_frame_count: int = 0
    frames_with_missing_pts: int = 0
    max_source_pts_jump_within_sample_interval: float = 0.0
    sample_period_seconds: float = 0.0
    decode_ms: float = 0.0
    classify_ms: float = 0.0
    viterbi_ms: float = 0.0
    elapsed_pass1_ms: float = 0.0
    pass1_cache_hit: bool = False
    # WS2: count of frames the pre-OCR gate skipped OCR on (viterbi_v2 only).
    # Denominator is `sampled_frame_count`. 0 when the gate is disabled.
    frames_gated: int = 0


def iter_sampled_frames(
    video_path: Path,
    sample_fps: float,
    *,
    width: int = 1920,
    height: int = 1080,
    telemetry: "SamplingTelemetry | None" = None,
    start_seconds: float | None = None,
    end_seconds: float | None = None,
) -> Iterator[SampledFrame]:
    """Decode the input video with PyAV and emit one frame per source-time
    tick (`n / sample_fps`), with the frame's canonical container PTS
    attached. Replaces the old `ffmpeg -vf fps=N` pipeline whose synthetic
    resampled PTS dropped the link to the source clock.

    Sampling semantics:
      - For each emission, pick the first decoded frame whose
        `source_time_seconds >= next_tick`, where
        `next_tick = tick_origin + sample_index * (1.0 / sample_fps)`.
      - Frames inside a tick window after one was emitted are dropped.
      - If the source has a hole (no decoded frame at or near a tick) we
        do NOT skip the sample slot — the next available frame past the
        tick gets emitted with the next `sample_index`. The drift metric
        in `telemetry` surfaces the gap so the operator can see it.

    Phase 3a — bounded segment mode: when `start_seconds` / `end_seconds`
    are supplied the iterator seeks to a keyframe before `start_seconds`,
    skips frames whose source time is before the window, and stops once
    the source time exceeds `end_seconds`. Tick origin shifts to
    `start_seconds` so the first emitted sample lands at the segment
    boundary. Pass-1 always passes `None` for both (whole-video decode);
    the new `InMemoryFrameProvider` in `frame_provider.py` passes them
    so segment-bounded decode covers only the labeled time range.

    Fails closed (raises `PtsHealthError`) if any decoded frame has
    `pts is None`. Pass 1 cannot reason about source time without PTS;
    the upstream `pts.probe()` already screens for this on the first
    100 packets, so reaching this fallback should be rare.

    `telemetry`, if passed, is mutated in place as frames are decoded.
    Callers read it after iteration completes.
    """
    import av

    if telemetry is None:
        telemetry = SamplingTelemetry()
    telemetry.sample_period_seconds = 1.0 / sample_fps

    # Phase 4: accumulate decode-side wall time. Python generators are
    # synchronous — the consumer's classifier work runs between yields
    # and does NOT contribute to `decode_accum` because every per-iteration
    # timer ends BEFORE the yield. Container open + stream setup also
    # count as decode time (one-time cost amortized over all frames).
    decode_accum = 0.0
    open_t = time.perf_counter()
    container = av.open(str(video_path))
    decode_accum += time.perf_counter() - open_t
    try:
        setup_t = time.perf_counter()
        stream = container.streams.video[0]
        time_base = stream.time_base
        if time_base is None:
            raise PtsHealthError(
                f"video stream has no time_base in {video_path.name}; "
                f"cannot convert PTS to seconds"
            )
        start_pts = stream.start_time if stream.start_time is not None else 0

        # Bounded segment seek: jump to a keyframe at or before
        # `start_seconds` so we don't decode the whole video. PyAV's
        # `seek` flushes the decoder; we still receive frames whose PTS
        # is before the target, which the `source_time_seconds < start`
        # guard inside the loop drops.
        if start_seconds is not None:
            offset_pts = int(start_seconds / float(time_base)) + start_pts
            container.seek(offset_pts, stream=stream, any_frame=False, backward=True)

        sample_period = 1.0 / sample_fps
        tick_origin = start_seconds if start_seconds is not None else 0.0
        next_tick_seconds = tick_origin
        sample_index = 0
        last_emitted_source_time: float | None = None
        decode_accum += time.perf_counter() - setup_t

        # Phase 4 Part B fix: switch from the implicit `for` loop to an
        # explicit iterator so the decode timer wraps PyAV's `next()` call.
        # Python `for x in iter:` calls `next(iter)` between iterations
        # but BEFORE the body re-enters — meaning the decode work that
        # happens inside `next()` lands in the gap between this iteration's
        # `decode_accum += ...` and the next `iter_t = time.perf_counter()`.
        # The implicit-loop pattern undercounted decode_ms by orders of
        # magnitude (Part A measured 4.3s decode for a 35-minute video,
        # which then fell into classify_ms by subtraction). Explicit
        # iteration moves the next() call inside the timed region.
        iterator = container.decode(stream)
        decoded_idx = -1
        while True:
            next_t = time.perf_counter()
            try:
                frame = next(iterator)
            except StopIteration:
                decode_accum += time.perf_counter() - next_t
                break
            decode_accum += time.perf_counter() - next_t
            decoded_idx += 1
            iter_t = time.perf_counter()
            if frame.pts is None:
                telemetry.frames_with_missing_pts += 1
                raise PtsHealthError(
                    f"frame at decode index {decoded_idx} has no PTS in "
                    f"{video_path.name}; Pass 1 needs canonical container "
                    f"PTS to derive source time"
                )

            source_pts = frame.pts - start_pts
            source_time_seconds = float(source_pts * time_base)

            # Bounded segment: drop pre-window frames the seek surfaced,
            # stop once we're at or past the window's exclusive end.
            # `end_seconds` is exclusive to match `Segment.end_seconds`'s
            # documented convention + ffmpeg's `-to` semantics — the
            # PngFrameProvider parity test would otherwise see N+1 frames
            # in-memory vs N PNGs on disk for the same segment bounds.
            if start_seconds is not None and source_time_seconds + 1e-9 < start_seconds:
                decode_accum += time.perf_counter() - iter_t
                continue
            if end_seconds is not None and source_time_seconds + 1e-9 >= end_seconds:
                decode_accum += time.perf_counter() - iter_t
                break

            if source_time_seconds + 1e-9 < next_tick_seconds:
                # Not yet at the next sample tick; drop this frame.
                decode_accum += time.perf_counter() - iter_t
                continue

            # Reformat-and-convert in one step: swscale resizes + converts
            # pixfmt to bgr24, which numpy then sees as (H, W, 3) uint8.
            if frame.width != width or frame.height != height:
                img = frame.reformat(
                    width=width, height=height, format="bgr24",
                ).to_ndarray()
            else:
                img = frame.to_ndarray(format="bgr24")
            # PyAV's swscale path can produce a non-contiguous ndarray;
            # downstream consumers (cv2, the classifier) want contiguous.
            if not img.flags["C_CONTIGUOUS"]:
                img = np.ascontiguousarray(img)
            # Guard against unexpected shape from reformat (shouldn't fire
            # but cheap to assert before it becomes a confusing IndexError
            # in the classifier).
            assert img.shape == (height, width, 3) and img.dtype == np.uint8, (
                f"reformatted frame shape={img.shape} dtype={img.dtype} "
                f"(expected ({height}, {width}, 3) uint8)"
            )

            # Stop the decode timer BEFORE yield so the consumer's
            # classifier time isn't attributed to decode.
            decode_accum += time.perf_counter() - iter_t
            yield SampledFrame(
                sample_index=sample_index,
                source_pts=source_pts,
                source_time_seconds=source_time_seconds,
                decode_order_index=decoded_idx,
                image=img,
            )
            post_yield_t = time.perf_counter()

            if last_emitted_source_time is not None:
                jump = source_time_seconds - last_emitted_source_time
                if jump > telemetry.max_source_pts_jump_within_sample_interval:
                    telemetry.max_source_pts_jump_within_sample_interval = jump
            last_emitted_source_time = source_time_seconds

            sample_index += 1
            next_tick_seconds = tick_origin + sample_index * sample_period
            decode_accum += time.perf_counter() - post_yield_t

        telemetry.decoded_frame_count = decoded_idx + 1
        telemetry.sampled_frame_count = sample_index
    finally:
        container.close()
        telemetry.decode_ms = decode_accum * 1000.0


def classify_video(
    video_path: Path,
    classifier: Classifier,
    config: Pass1Config,
    *,
    on_frame: Callable[[FrameClassification], None] | None = None,
    telemetry: "SamplingTelemetry | None" = None,
) -> list[FrameClassification]:
    """Run classifier on every Pass-1-sampled frame. Returns the full
    per-frame table. `on_frame` is a progress hook (called once per frame).
    `telemetry`, if passed, is filled in with PTS drift counters during
    sampling (the orchestrator drains it into the `segments.json` pass1
    metadata block).
    """
    out: list[FrameClassification] = []
    for sf in iter_sampled_frames(
        video_path, config.sample_fps, telemetry=telemetry,
    ):
        r: ClassifyResult = classifier.classify(sf.image)
        rec = FrameClassification(
            index=sf.sample_index,
            seconds=sf.source_time_seconds,
            screen_type=r.screen_type,
            color_score=r.color_score,
            color_class=r.color_class,
            anchor_text=r.anchor_text,
            sample_index=sf.sample_index,
            source_pts=sf.source_pts,
            source_time_seconds=sf.source_time_seconds,
            decode_order_index=sf.decode_order_index,
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

    def _source_time_at(idx: int) -> float:
        """Return the canonical-PTS sample time at `idx`, falling back to
        the index-derived value when the field is None (cached pre-PTS
        segments.json or synthetic test fixtures)."""
        c = classifications[idx]
        if c.source_time_seconds is not None:
            return c.source_time_seconds
        return idx * period

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
        start_seconds = _source_time_at(start)
        # Exclusive end: use the next frame's source time if available
        # (matches the legacy "(end + 1) * period" semantics on CFR);
        # otherwise extrapolate by one sample period past the last frame.
        if end + 1 < n:
            end_seconds = _source_time_at(end + 1)
        else:
            end_seconds = _source_time_at(end) + period
        seconds = end_seconds - start_seconds
        min_seconds_for_screen = config.min_segment_seconds_by_screen.get(
            open_type, config.min_segment_seconds
        )
        if seconds + 1e-6 < min_seconds_for_screen:
            open_type = None
            open_start = None
            outliers_in_open = 0
            last_match_idx = None
            run_color = []
            return
        segments.append(Segment(
            start_index=start,
            end_index=end,
            start_seconds=start_seconds,
            end_seconds=end_seconds,  # exclusive end for downstream slicing
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
            min_run = config.min_run_to_open_by_screen.get(
                c.screen_type, config.min_run_to_open
            )
            run = 1
            for j in range(i + 1, min(i + min_run, n)):
                if classifications[j].screen_type == c.screen_type:
                    run += 1
                else:
                    break
            if run >= min_run:
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
                        min_run = config.min_run_to_open_by_screen.get(
                            c.screen_type, config.min_run_to_open
                        )
                        run = 1
                        for j in range(i + 1, min(i + min_run, n)):
                            if classifications[j].screen_type == c.screen_type:
                                run += 1
                            else:
                                break
                        if run >= min_run:
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
    *,
    version: str,
    cache_key: str,
    sampling_telemetry: "SamplingTelemetry | None" = None,
) -> None:
    payload = {
        "version": version,
        "pass1_cache_key": cache_key,
        "video_path": str(video_path),
        "video_sha256": video_sha256,
        "pass1_config": asdict(config),
        "segments": [asdict(s) for s in segments],
        "frame_classifications": [asdict(c) for c in classifications],
    }
    if sampling_telemetry is not None:
        # Additive metadata block; old readers ignore unknown keys. Surfaces
        # the source-PTS drift signal a future run-quality CLI will consume.
        payload["pass1_sampling_telemetry"] = asdict(sampling_telemetry)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, indent=2))


@dataclass
class SegmentsJsonLoaded:
    video_sha256: str
    version: str | None
    pass1_cache_key: str | None
    segments: list[Segment]
    # Phase 4: the on-disk pass1_sampling_telemetry block, surfaced for
    # analytics + future Part-B run-quality plumbing. None for pre-Phase-2
    # files that predate the telemetry block (orthogonal to `is_legacy`
    # which keys only on the cache-key fields). The orchestrator does NOT
    # use this on cache hit — it constructs a fresh
    # SamplingTelemetry(pass1_cache_hit=True) instead — but having the
    # field on the loader keeps reads for Part B and trend analytics
    # straightforward.
    sampling_telemetry: SamplingTelemetry | None = None

    @property
    def is_legacy(self) -> bool:
        """True if the file lacks the Issue-2 cache-key fields. Caller should
        treat this the same as a missing file (cache miss, re-run Pass 1)."""
        return self.version is None or self.pass1_cache_key is None


def load_segments_json(path: Path) -> SegmentsJsonLoaded:
    """Load segments.json. `version` and `pass1_cache_key` are None for
    legacy files (pre-Issue 2) so callers can distinguish.
    `sampling_telemetry` is None for files written before Phase 2 (no
    block) and populated otherwise; pre-Phase-4 files lack the new timing
    fields but `SamplingTelemetry(**raw_tele)` accepts the partial dict
    because the new fields default safely."""
    data = json.loads(path.read_text())
    segs = [Segment(**s) for s in data["segments"]]
    raw_tele = data.get("pass1_sampling_telemetry")
    sampling_telemetry = (
        SamplingTelemetry(**raw_tele) if raw_tele is not None else None
    )
    return SegmentsJsonLoaded(
        video_sha256=data["video_sha256"],
        version=data.get("version"),
        pass1_cache_key=data.get("pass1_cache_key"),
        segments=segs,
        sampling_telemetry=sampling_telemetry,
    )
