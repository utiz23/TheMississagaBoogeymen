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

import hashlib
import json
import re
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

from video_ingest.pass1_classify import (
    Segment,
    VIDEO_INGEST_CONFIGS_DIR,
    _sha256_of,
)

# Lazy import sentinel — populated on first use when loadout_engine='typed_v1'.
# Exposed at module scope so unit tests can patch it without a live game_ocr
# install: `patch("video_ingest.pass2_extract.extract_loadout_evidence", ...)`
extract_loadout_evidence = None  # type: ignore[assignment]
# Lazy import sentinel for the Phase 3b lobby extractor — same pattern as
# loadout. Populated on first use when lobby_engine='typed_v1'.
extract_lobby_evidence = None  # type: ignore[assignment]


PASS2_MANIFEST_FILENAME = "pass2_manifest.json"


@dataclass
class VisualPrefilterPass2Config:
    """Visual-prefilter Phase 3: per-segment frame selection knobs.

    `enabled=False` (default) keeps the existing Pass-2 behaviour byte-for-byte:
    no provider wrapping, no sidecar write, no cache-key change. When enabled,
    each segment whose `screen_type` is keyed in `frame_budget` runs
    `compute_visual_signals` + `select_frames` over the provider's frames and
    OCRs only the selected subset. Screens absent from `frame_budget` are
    untouched (no cap, no filtering).
    """

    enabled: bool = False
    frame_budget: dict[str, int] = field(default_factory=dict)
    dedup_dhash_distance: dict[str, int] = field(default_factory=dict)


def _prefilter_fingerprint(prefilter: "VisualPrefilterPass2Config | None") -> bytes:
    """Stable hash input for compute_pass2_cache_key.

    Returns ``b"prefilter=off"`` when the prefilter is missing or disabled so
    pre-Phase-3 caches (which never saw a prefilter byte) stay valid. When
    enabled, returns ``b"prefilter:" + sha256(<json>)`` over a sorted-key
    serialization of the config so a tunable change invalidates the cache."""
    if prefilter is None or not prefilter.enabled:
        return b"prefilter=off"
    payload = json.dumps(
        {
            "enabled": True,
            "frame_budget": dict(sorted(prefilter.frame_budget.items())),
            "dedup_dhash_distance": dict(sorted(prefilter.dedup_dhash_distance.items())),
        },
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return b"prefilter:" + hashlib.sha256(payload).hexdigest().encode("ascii")


def compute_pass2_cache_key(
    version: str,
    artifact_mode: bool = False,
    *,
    prefilter: "VisualPrefilterPass2Config | None" = None,
) -> str:
    """Hash of the orchestrator-side version YAML + the artifact_mode flag
    + the visual-prefilter fingerprint.

    Pass 2 doesn't need the classifier YAML — classifier changes propagate
    via segments_hash. The artifact_mode byte is included so a switch
    between PNG-on-disk and in-memory frame providers invalidates the
    cache (running typed_v1 evidence extraction without artifacts when
    the cached run had PNGs would produce a directory the extractors
    can't read). Phase 3c flipped the default to False (in-memory is the
    steady-state hot path); True is retained as the legacy PNG-on-disk
    opt-in for operators who want artifacts on disk for review/debug.

    Visual Prefilter Phase 3 adds the prefilter fingerprint as a third
    hash input. The fingerprint is ``b"prefilter=off"`` when the
    prefilter is disabled or absent, so caches written before Phase 3
    (or with the feature flipped off) stay valid bit-for-bit.
    """
    version_yaml = VIDEO_INGEST_CONFIGS_DIR / f"{version}.yaml"
    parts: list[bytes] = [version_yaml.read_bytes(), b"\x00"]
    parts.append(b"artifact_mode=true" if artifact_mode else b"artifact_mode=false")
    parts.append(b"\x00")
    parts.append(_prefilter_fingerprint(prefilter))
    return _sha256_of(b"".join(parts))


@dataclass
class Pass2Config:
    window_padding_seconds: float = 1.0
    sample_rates: dict[str, float] = None  # type: ignore[assignment]
    extract_screens: set[str] = None  # type: ignore[assignment]
    # loadout_engine: selects the player_loadout_view extraction path.
    # 'legacy' (default) = existing parse_loadout_result() pass-through.
    # 'typed_v1'         = extract_loadout_evidence() → loadout_evidence.json.
    # Task 2B-9 flipped the production default to 'typed_v1'.
    loadout_engine: str = "legacy"
    # lobby_engine: selects the pre_game_lobby_state_2 extraction path.
    # 'legacy' (default) = existing parse_pre_game_result() pass-through
    #                       (still used for pre_game_lobby_state_1 — no
    #                       typed extractor exists for that state per Phase 3a).
    # 'typed_v1'         = extract_lobby_evidence() → lobby_evidence.json.
    # Task 3B-8 flips the production default to 'typed_v1' for state_2 only.
    lobby_engine: str = "legacy"
    # Phase 3a/b/c: artifact mode. False (default since Phase 3c) =
    # process frames in memory and only write evidence JSON — typed_v1
    # segments skip the ffmpeg PNG-extract step entirely. True = write
    # PNGs to disk per segment (the legacy behavior, fed to legacy
    # game_ocr.cli + the typed_v1 extractors that glob the segment dir)
    # — retained as an opt-in for operators who want artifacts on disk
    # for review/debug. Switching this flag invalidates the pass2 cache.
    artifact_mode: bool = False


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
    # Visual Prefilter Phase 3 per-segment telemetry. All None when the
    # prefilter was disabled or this segment had no configured frame_budget
    # (so legacy manifests and disabled runs continue to deserialize cleanly).
    prefilter_frames_scanned: int | None = None
    prefilter_frames_selected: int | None = None
    prefilter_selection_ms: float | None = None


@dataclass
class _PrefilterSelection:
    """Internal return value of `_run_prefilter_selection`."""
    indices: list[int]
    frames_scanned: int
    selection_ms: float


def _run_prefilter_selection(
    records: list,
    *,
    frame_budget: int,
    dhash_max_distance: int,
) -> _PrefilterSelection:
    """Compute visual signals for every materialised FrameRecord and pick
    indices via `select_frames`. Pure given inputs; the only side-effect
    is the wall-clock timer for telemetry."""
    # Late imports keep pass2_extract importable without OpenCV at module-load
    # time and let tests patch these symbols on `pass2_extract` if needed.
    from video_ingest.visual_prefilter.pass2_policy import select_frames
    from video_ingest.visual_prefilter.signals import compute_visual_signals

    t0 = time.perf_counter()
    signals = [compute_visual_signals(r.image) for r in records]
    indices = select_frames(
        signals,
        frame_budget=frame_budget,
        dhash_max_distance=dhash_max_distance,
    )
    elapsed_ms = (time.perf_counter() - t0) * 1000.0
    return _PrefilterSelection(
        indices=indices,
        frames_scanned=len(records),
        selection_ms=elapsed_ms,
    )


_PNG_INDEX_RE = re.compile(r"^(\d+)\.png$")


def _png_basenames_in_provider_order(seg_dir: Path) -> list[str]:
    """Return PNG basenames in the same order `PngFrameProvider._resolve_paths`
    would yield them — so the i-th basename matches the i-th `FrameRecord` from
    `iter_frames()`. Used by the legacy-path sidecar write to map selected
    record indices back to filenames the downstream Extractor will glob.

    Mirrors the `[0-9]*.png` glob + `^\\d+\\.png$` regex filter in
    `frame_provider.PngFrameProvider._resolve_paths`."""
    pairs: list[tuple[int, str]] = []
    for p in sorted(seg_dir.glob("[0-9]*.png")):
        m = _PNG_INDEX_RE.match(p.name)
        if m is None:
            continue
        pairs.append((int(m.group(1)), p.name))
    pairs.sort()
    return [name for _, name in pairs]


def extract_segments(
    video_path: Path,
    segments: list[Segment],
    config: Pass2Config,
    pass2_root: Path,
    video_duration_seconds: float | None = None,
    *,
    version: str,
    segments_hash: str,
    prefilter: VisualPrefilterPass2Config | None = None,
) -> list[Pass2Result]:
    """Extract every segment whose screen_type is in `extract_screens`.
    Skipped segments still get an entry in the returned list (frame_count=0)
    so the orchestrator can log them.

    Writes pass2_manifest.json with the cache identifiers needed for the
    Issue-2 invalidation contract: pass2_cache_key (config-derived) plus
    segments_hash (so Pass 1 invalidation cascades to Pass 2).

    When ``prefilter`` is supplied and enabled, segments whose screen_type
    has a configured `frame_budget` run the visual prefilter:
    - Typed-v1 segments: the provider is wrapped in `FilteredFrameProvider`,
      so the typed extractor's `list(iter_frames())` only sees the selected
      subset.
    - Legacy (PNG-on-disk) segments: the provider is materialised here,
      `select_frames` runs, and `selected_frames.json` is written into
      `seg_dir`. The downstream `Extractor.extract_input()` honours that
      sidecar (Visual Prefilter Phase 2 contract).
    Either way, per-segment prefilter telemetry is recorded on the
    `Pass2Result` for the manifest serializer."""
    if config.sample_rates is None or config.extract_screens is None:
        raise ValueError("Pass2Config.sample_rates and extract_screens must be set")

    # Late import keeps OpenCV / numpy out of pass2_extract's import path
    # when the prefilter is disabled (the common case).
    from video_ingest.frame_provider import FilteredFrameProvider
    from game_ocr.extractor import SELECTED_FRAMES_SIDECAR_NAME

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
        provider, frame_count = _resolve_frame_source(
            video_path=video_path,
            seg_dir=seg_dir,
            start=start,
            end=end,
            fps=fps,
            seg=seg,
            config=config,
        )

        # --- visual prefilter (Phase 3) ---------------------------------------
        # When enabled AND this screen has a configured frame_budget, narrow
        # the provider/PNG set before the typed-v1 extractor consumes the
        # provider (typed-v1) or the downstream worker globs the seg_dir
        # (legacy). Screens absent from `frame_budget` are unaffected.
        prefilter_stats: dict[str, float | int] | None = None
        if (
            prefilter is not None
            and prefilter.enabled
            and seg.screen_type in prefilter.frame_budget
        ):
            budget = int(prefilter.frame_budget[seg.screen_type])
            dhash_dist = int(
                prefilter.dedup_dhash_distance.get(seg.screen_type, 8)
            )
            is_typed_v1 = (
                (seg.screen_type == "player_loadout_view"
                 and config.loadout_engine == "typed_v1")
                or (seg.screen_type == "pre_game_lobby_state_2"
                    and config.lobby_engine == "typed_v1")
            )
            if is_typed_v1:
                # Wrap the provider so the typed extractor only ever sees the
                # selected subset. Telemetry is captured by closure on
                # `prefilter_stats` when the selector fires inside
                # FilteredFrameProvider.iter_frames().
                prefilter_stats = {
                    "frames_scanned": 0,
                    "frames_selected": 0,
                    "selection_ms": 0.0,
                }
                _captured = prefilter_stats  # name the cell for the closure

                def _selector(records, _budget=budget, _dhd=dhash_dist,
                              _stats=_captured):
                    sel = _run_prefilter_selection(
                        records,
                        frame_budget=_budget,
                        dhash_max_distance=_dhd,
                    )
                    _stats["frames_scanned"] = sel.frames_scanned
                    _stats["frames_selected"] = len(sel.indices)
                    _stats["selection_ms"] = sel.selection_ms
                    return sel.indices

                provider = FilteredFrameProvider(provider, selector=_selector)
            else:
                # Legacy/PNG path: PNGs already on disk via _ffmpeg_extract.
                # Materialise the provider once, select, and write the
                # sidecar — the downstream Extractor.extract_input() will
                # restrict its directory walk to the listed basenames.
                records = list(provider.iter_frames())
                sel = _run_prefilter_selection(
                    records,
                    frame_budget=budget,
                    dhash_max_distance=dhash_dist,
                )
                png_basenames = _png_basenames_in_provider_order(seg_dir)
                if len(png_basenames) != len(records):
                    raise RuntimeError(
                        f"prefilter PNG-mode mismatch in {seg_dir}: "
                        f"PngFrameProvider yielded {len(records)} records "
                        f"but seg_dir contains {len(png_basenames)} matching "
                        f"PNGs — selection-index → basename mapping is unsafe"
                    )
                selected_basenames = [png_basenames[idx] for idx in sel.indices]
                (seg_dir / SELECTED_FRAMES_SIDECAR_NAME).write_text(
                    json.dumps(selected_basenames)
                )
                prefilter_stats = {
                    "frames_scanned": sel.frames_scanned,
                    "frames_selected": len(sel.indices),
                    "selection_ms": sel.selection_ms,
                }
                # Reflect the new effective frame count for the manifest:
                # downstream will only OCR the selected subset.
                frame_count = len(sel.indices)

        # --- loadout_engine dispatch (player_loadout_view only) ---------------
        if seg.screen_type == "player_loadout_view":
            loadout_engine = config.loadout_engine
            if loadout_engine == "typed_v1":
                count = _run_typed_v1_loadout(seg_dir, provider, segment_index=i)
                if frame_count is None:
                    frame_count = count
            elif loadout_engine != "legacy":
                raise ValueError(
                    f"Unknown pass2.loadout_engine: {loadout_engine!r}; "
                    f"expected 'legacy' or 'typed_v1'"
                )
            # 'legacy' branch: no action here — downstream ingest-ocr-cli /
            # parse_loadout_result() handles this segment as before.

        # --- lobby_engine dispatch (pre_game_lobby_state_2 only) --------------
        if seg.screen_type == "pre_game_lobby_state_2":
            lobby_engine = config.lobby_engine
            if lobby_engine == "typed_v1":
                count = _run_typed_v1_lobby(seg_dir, provider, segment_index=i)
                if frame_count is None:
                    frame_count = count
            elif lobby_engine != "legacy":
                raise ValueError(
                    f"Unknown pass2.lobby_engine: {lobby_engine!r}; "
                    f"expected 'legacy' or 'typed_v1'"
                )
            # 'legacy' branch: no action here — downstream ingest-ocr-cli /
            # parse_pre_game_result() handles this segment as before.
            # NOTE: pre_game_lobby_state_1 does NOT get a typed-v1 path
            # because Phase 3a confirmed state_1 frames don't appear in
            # operator recordings (see docs/calibration/phase-3a-hmm-
            # disambiguation-2026-05-22.md). state_1 segments continue
            # through the legacy parser.

        out.append(Pass2Result(
            segment_index=i,
            segment=seg,
            directory=seg_dir,
            frame_count=frame_count,
            sample_fps=fps,
            start_seconds=start,
            end_seconds=end,
            prefilter_frames_scanned=(
                int(prefilter_stats["frames_scanned"])
                if prefilter_stats is not None
                else None
            ),
            prefilter_frames_selected=(
                int(prefilter_stats["frames_selected"])
                if prefilter_stats is not None
                else None
            ),
            prefilter_selection_ms=(
                float(prefilter_stats["selection_ms"])
                if prefilter_stats is not None
                else None
            ),
        ))
        print(
            f"  seg {i:03d}  {seg.screen_type:30s}  {start:6.1f}s..{end:6.1f}s  "
            f"@ {fps}fps  →  {frame_count} frames  ({seg_dir.relative_to(pass2_root.parent)})",
            file=sys.stderr,
        )

    write_pass2_manifest(
        pass2_root.parent / PASS2_MANIFEST_FILENAME,
        out,
        version=version,
        cache_key=compute_pass2_cache_key(version, config.artifact_mode),
        segments_hash=segments_hash,
        artifact_mode=config.artifact_mode,
    )
    return out


def _resolve_frame_source(
    *,
    video_path: Path,
    seg_dir: Path,
    start: float,
    end: float,
    fps: float,
    seg: Segment,
    config: "Pass2Config",
) -> tuple["FrameProvider", int | None]:
    """Pick the frame source for one Pass-2 segment.

    Phase 3b C4: when ``config.artifact_mode`` is False AND the segment is a
    typed_v1 loadout or lobby segment, skip ``_ffmpeg_extract`` and stream
    decoded frames straight from the source mkv via ``InMemoryFrameProvider``.
    Otherwise (artifact_mode=True OR a non-typed_v1 segment such as a legacy
    parser screen), ``_ffmpeg_extract`` writes PNGs as before and a
    ``PngFrameProvider`` re-reads them.

    The second return value is the frame count when known eagerly (PNG path),
    or ``None`` when the typed_v1 extractor is the only place that learns the
    count (in-memory path). Callers must populate ``Pass2Result.frame_count``
    from ``_run_typed_v1_*`` in the in-memory case.

    ``seg_dir`` is created either way — ``loadout_evidence.json`` /
    ``lobby_evidence.json`` are still written there.
    """
    from video_ingest.frame_provider import (
        InMemoryFrameProvider,
        PngFrameProvider,
    )

    typed_v1_seg = (
        (seg.screen_type == "player_loadout_view"
         and config.loadout_engine == "typed_v1")
        or (seg.screen_type == "pre_game_lobby_state_2"
            and config.lobby_engine == "typed_v1")
    )
    if config.artifact_mode or not typed_v1_seg:
        n = _ffmpeg_extract(video_path, seg_dir, start, end, fps)
        return PngFrameProvider(seg_dir, fps=fps), n
    seg_dir.mkdir(parents=True, exist_ok=True)
    return (
        InMemoryFrameProvider(
            video_path=video_path,
            start_seconds=start,
            end_seconds=end,
            fps=fps,
        ),
        None,
    )


def _run_typed_v1_loadout(
    seg_dir: Path,
    frame_provider: "FrameProvider",
    *,
    segment_index: int,
) -> int:
    """Run the typed_v1 loadout extractor and write FieldEvidenceRecord[] JSON.

    Lazily imports ``extract_loadout_evidence`` from ``game_ocr.loadout_evidence``
    on first call (keeps Pass-2 startup fast and allows test patching at the
    module-level name ``video_ingest.pass2_extract.extract_loadout_evidence``).

    Phase 3b: takes a ``FrameProvider`` (caller-supplied — Pass-2's main loop
    constructs ``PngFrameProvider`` or ``InMemoryFrameProvider`` based on
    ``artifact_mode``) and returns the observed frame count so the manifest
    can be populated without re-globbing PNGs.

    Writes ``<seg_dir>/loadout_evidence.json``.
    """
    global extract_loadout_evidence  # noqa: PLW0603
    if extract_loadout_evidence is None:
        from game_ocr.loadout_evidence import (  # type: ignore[no-redef]
            extract_loadout_evidence as _extract,
        )
        # Assign to the module-level name so subsequent calls (and tests that
        # patch after the first import) see the same object.
        import video_ingest.pass2_extract as _self
        _self.extract_loadout_evidence = _extract
        extract_loadout_evidence = _extract

    records, frame_count = extract_loadout_evidence(
        frame_provider=frame_provider,
        segment_index=segment_index,
    )
    out_path = seg_dir / "loadout_evidence.json"
    with out_path.open("w") as fp:
        json.dump([r.to_dict() for r in records], fp, indent=2)
    return frame_count


def _run_typed_v1_lobby(
    seg_dir: Path,
    frame_provider: "FrameProvider",
    *,
    segment_index: int,
) -> int:
    """Run the typed_v1 lobby extractor and write FieldEvidenceRecord[] JSON.

    Mirrors `_run_typed_v1_loadout`: lazy import of `extract_lobby_evidence`
    from ``game_ocr.lobby_evidence`` on first call; writes
    ``<seg_dir>/lobby_evidence.json``. Returns the observed frame count.
    """
    global extract_lobby_evidence  # noqa: PLW0603
    if extract_lobby_evidence is None:
        from game_ocr.lobby_evidence import (  # type: ignore[no-redef]
            extract_lobby_evidence as _extract,
        )
        import video_ingest.pass2_extract as _self
        _self.extract_lobby_evidence = _extract
        extract_lobby_evidence = _extract

    records, frame_count = extract_lobby_evidence(
        frame_provider=frame_provider,
        segment_index=segment_index,
    )
    out_path = seg_dir / "lobby_evidence.json"
    with out_path.open("w") as fp:
        json.dump([r.to_dict() for r in records], fp, indent=2)
    return frame_count


@dataclass
class Pass2ManifestLoaded:
    version: str | None
    pass2_cache_key: str | None
    segments_hash: str | None
    # Phase 3a: artifact_mode the cached run wrote with. None on legacy
    # manifests that pre-date the field — treated as a cache miss so the
    # operator's current artifact_mode setting takes effect on re-extract.
    artifact_mode: bool | None
    results: list[Pass2Result]

    @property
    def is_legacy(self) -> bool:
        """True if the manifest lacks any required Issue-2 / Phase-3a
        cache field. Caller treats this as cache miss."""
        return (
            self.version is None
            or self.pass2_cache_key is None
            or self.segments_hash is None
            or self.artifact_mode is None
        )


def write_pass2_manifest(
    path: Path,
    results: list[Pass2Result],
    *,
    version: str,
    cache_key: str,
    segments_hash: str,
    artifact_mode: bool = False,
) -> None:
    """Persist the Pass 2 manifest. Called once per fresh extraction; the
    file is the authoritative record of which (padded) windows ffmpeg saw,
    plus the cache identifiers used to detect config drift on subsequent
    runs."""
    entries = [
        {
            "segment_index": r.segment_index,
            "screen_type": r.segment.screen_type,
            "directory": str(r.directory),
            "frame_count": r.frame_count,
            "sample_fps": r.sample_fps,
            "start_seconds": r.start_seconds,
            "end_seconds": r.end_seconds,
            # Visual Prefilter Phase 3: always serialized; None when the
            # prefilter was off or didn't apply to this screen.
            "prefilter_frames_scanned": r.prefilter_frames_scanned,
            "prefilter_frames_selected": r.prefilter_frames_selected,
            "prefilter_selection_ms": r.prefilter_selection_ms,
        }
        for r in results
    ]
    payload = {
        "version": version,
        "pass2_cache_key": cache_key,
        "segments_hash": segments_hash,
        "artifact_mode": artifact_mode,
        "entries": entries,
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2))


def load_pass2_manifest(path: Path, segments: list[Segment]) -> Pass2ManifestLoaded:
    """Load the Pass 2 manifest. Returns a `Pass2ManifestLoaded` whose
    `version`/`pass2_cache_key`/`segments_hash`/`artifact_mode` are None
    for legacy bare-list manifests (Issue-4 schema) or pre-Phase-3a
    manifests that pre-date the artifact_mode field. Raises
    FileNotFoundError if the manifest is absent."""
    data = json.loads(path.read_text())
    if isinstance(data, list):
        entries = data
        version = None
        cache_key = None
        segments_hash = None
        artifact_mode: bool | None = None
    else:
        entries = data.get("entries", [])
        version = data.get("version")
        cache_key = data.get("pass2_cache_key")
        segments_hash = data.get("segments_hash")
        # `artifact_mode` was introduced in Phase 3a. Pre-existing manifests
        # lack the key; treat that as None (legacy) so the cache mismatch
        # path forces a fresh extract under the operator's current setting.
        artifact_mode = data.get("artifact_mode")
        if artifact_mode is not None and not isinstance(artifact_mode, bool):
            raise ValueError(
                f"pass2_manifest.json `artifact_mode` must be a bool when present, "
                f"got {type(artifact_mode).__name__}: {artifact_mode!r}"
            )
    results: list[Pass2Result] = []
    for entry in entries:
        idx = entry["segment_index"]
        results.append(Pass2Result(
            segment_index=idx,
            segment=segments[idx],
            directory=Path(entry["directory"]),
            frame_count=entry["frame_count"],
            sample_fps=entry["sample_fps"],
            start_seconds=entry["start_seconds"],
            end_seconds=entry["end_seconds"],
            # Visual Prefilter Phase 3: optional fields. Pre-Phase-3
            # manifests lack the keys → default to None (matches the
            # dataclass default, treated as "prefilter didn't apply").
            prefilter_frames_scanned=entry.get("prefilter_frames_scanned"),
            prefilter_frames_selected=entry.get("prefilter_frames_selected"),
            prefilter_selection_ms=entry.get("prefilter_selection_ms"),
        ))
    return Pass2ManifestLoaded(
        version=version,
        pass2_cache_key=cache_key,
        segments_hash=segments_hash,
        artifact_mode=artifact_mode,
        results=results,
    )
